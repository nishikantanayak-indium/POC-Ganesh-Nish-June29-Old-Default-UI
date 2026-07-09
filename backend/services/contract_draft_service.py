"""
Contract Draft Generation Service.

The Analysis-side counterpart to the Synthetic Data Studio's document
generation, with a much higher correctness bar: this document is meant to
plausibly be sent to a real counterparty, so every section must cite real
requirement/clause/risk/mitigation text already sitting in the workspace's
graph — never fabricated — and every citation is verified as an actual
substring of the drafted text before it's trusted, mirroring the
Studio Validation tab's anti-hallucination pattern.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Dict, List, Optional, Tuple

from openai import OpenAI

from config.settings import settings
from core.exceptions import ExtractionError
from core.models import CoverageStatus
from services.graph_service import GraphService

logger = logging.getLogger(__name__)

MAX_RFP_TEXT_CHARS = 12000

FIXED_TEMPLATES: Dict[str, List[str]] = {
    "services_agreement": [
        "Scope of Work", "Compensation and Payment Schedule", "Term and Termination",
        "Confidentiality", "Intellectual Property", "Independent Contractor Status",
        "Liability and Indemnification", "Governing Law and Dispute Resolution",
        "General Provisions",
    ],
    "rfp_response": [
        "Executive Summary", "Response to Requirements", "Pricing",
        "Implementation and Delivery Plan", "Risk and Mitigation", "Company Background",
    ],
}

TEMPLATE_LABELS: Dict[str, str] = {
    "services_agreement": "Services Agreement",
    "rfp_response": "Offer / Proposal",
}

# Heuristic heading-line detector for real, arbitrary uploaded RFPs (not the
# "## heading" markdown convention synthetic documents use) — mirrors the
# same style of pattern extractors/llm_extractor.py's _SECTION_RE already
# uses for real contract text: numbered sections, SECTION/ARTICLE/PART
# labels, roman numerals, or a short ALL-CAPS line.
_HEADING_LINE_RE = re.compile(
    r'^(?:'
    r'(?:\d+\.){1,3}\d*\s+\S|'
    r'(?:SECTION|ARTICLE|PART)\s+[\dIVXLC]+|'
    r'[IVXLC]+\.\s+[A-Z]|'
    r'[A-Z][A-Z \-]{4,70}$'
    r')',
)

# An RFP and a signed Contract are different stages of a deal — the RFP is the
# buyer's blueprint of needs, a Contract is the final negotiated agreement. An
# Offer/Proposal (what this service actually drafts) sits between them: it
# responds point-by-point to the RFP's requirements, it doesn't adopt the
# RFP's own document shape (which includes sections like "Evaluation Criteria"
# and "Submission Instructions" that are instructions TO the vendor, not
# content a vendor would ever put in their own response). So detected RFP
# headings are only used to inform how "Response to Requirements" is organized
# internally, never as the whole offer's structure — and administrative
# sections are filtered out here rather than treated as response content.
_ADMINISTRATIVE_HEADING_RE = re.compile(
    r'(evaluation\s+criteria|submission|instructions?\s+to|cover\s+letter|'
    r'introduction|background|table\s+of\s+contents|definitions|glossary)',
    re.IGNORECASE,
)


def _quote_appears_in(quote: str, text: str) -> bool:
    q = " ".join(quote.split()).strip().lower()
    if not q:
        return False
    return q in " ".join(text.split()).lower()


def _draft_tool() -> dict:
    section_schema = {
        "type": "object",
        "properties": {
            "heading": {"type": "string"},
            "body": {"type": "string"},
            "addressed_requirement_ids": {"type": "array", "items": {"type": "string"}},
            "citations": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "requirement_id": {"type": "string"},
                        "aspect": {"type": "string"},
                        "quote": {
                            "type": "string",
                            "description": "Verbatim substring copied from THIS section's own 'body' text "
                                            "(not the source material) — required (non-empty) whenever "
                                            "verdict is 'strong' or 'partial'. Empty only for 'weak'.",
                        },
                        "verdict": {"type": "string", "enum": ["strong", "partial", "weak"]},
                    },
                    "required": ["requirement_id", "aspect", "quote", "verdict"],
                },
            },
        },
        "required": ["heading", "body", "addressed_requirement_ids", "citations"],
    }
    return {
        "type": "function",
        "function": {
            "name": "emit_draft",
            "description": "Emit one complete, coherent draft response Offer/Proposal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "sections": {"type": "array", "items": section_schema},
                },
                "required": ["title", "sections"],
            },
        },
    }


def _revise_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_revision",
            "description": "Return ONLY the replacement text for the selected portion of a document section.",
            "parameters": {
                "type": "object",
                "properties": {
                    "revised_text": {
                        "type": "string",
                        "description": "The replacement for the selected text only — not the whole section.",
                    },
                },
                "required": ["revised_text"],
            },
        },
    }


class ContractDraftService:
    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.llm_model

    def _call(self, system: str, user: str, tool: dict, tool_name: str, max_tokens: int = 6000) -> dict:
        try:
            resp = self.client.chat.completions.create(
                model=self.model, temperature=0.4,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                tools=[tool], tool_choice={"type": "function", "function": {"name": tool_name}},
                max_tokens=max_tokens,
            )
            tc = resp.choices[0].message.tool_calls
            if not tc:
                return {}
            return json.loads(tc[0].function.arguments)
        except Exception as exc:
            raise ExtractionError(f"Draft generation call '{tool_name}' failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Grounding
    # ------------------------------------------------------------------

    def build_grounding_bundle(self, gs: GraphService) -> dict:
        """
        Collect EVERY requirement's full traceability chain (real clause/risk/
        mitigation/LD text, not bare IDs) — a real offer/proposal comprehensively
        restates how every requirement is met, not just the ones currently
        missing coverage. Requirements that are already fully covered still go
        into 'requirements' (tagged 'Covered') so the draft can restate the
        existing clause's substance instead of silently omitting them; 'gaps'
        remains the subset with no covering clause and/or an unmitigated risk,
        for the flagged-gaps banner. One get_traceability call per requirement —
        no batch Neo4j method exists today; fine for typical RFP sizes, but a
        genuinely large RFP (hundreds of requirements) will need batching/
        chunked generation rather than one prompt with everything, which this
        v1 does not yet do.
        """
        coverage = gs.get_coverage_results()
        requirements: List[dict] = []
        gaps: List[dict] = []
        covered_count = 0

        for r in coverage:
            chain = gs.get_traceability(r.requirement_id)
            if not chain:
                continue
            entry = {
                "requirement_id": r.requirement_id,
                "requirement_text": r.requirement_text,
                "status": r.status.value,
                "full_coverage": chain.get("full_coverage", []),
                "partial_coverage": chain.get("partial_coverage", []),
                "risks": chain.get("risks", []),
                "mitigations": chain.get("mitigations", []),
                "lds": chain.get("lds", []),
            }
            requirements.append(entry)
            if r.status == CoverageStatus.COVERED:
                covered_count += 1
                continue
            if not entry["full_coverage"] and not entry["partial_coverage"]:
                gaps.append({
                    "requirement_id": r.requirement_id, "requirement_text": r.requirement_text,
                    "reason": "No contract clause covers this requirement",
                })
            if entry["risks"] and not entry["mitigations"]:
                gaps.append({
                    "requirement_id": r.requirement_id, "requirement_text": r.requirement_text,
                    "reason": "Risk(s) associated with this requirement have no mitigation",
                })

        return {
            "requirements": requirements,
            "gaps": gaps,
            "summary": {
                "requirements_total": len(coverage),
                "requirements_covered": covered_count,
                "requirements_needing_attention": len(coverage) - covered_count,
                "gaps_count": len(gaps),
            },
        }

    def _get_rfp_text(self, gs: GraphService) -> Optional[Tuple[str, str]]:
        """Returns (rfp_name, full_text) for the ingested RFP, or None if there isn't one."""
        try:
            docs = gs.store.get_document_contents(gs.workspace_id)
        except Exception as exc:
            logger.warning("Could not load RFP: %s", exc)
            return None
        rfp = next((d for d in docs if d.get("type") == "RFP"), None)
        if rfp is None:
            return None
        full_text = "\n\n".join(
            (pc.get("native_text") or pc.get("ocr_text") or "") for pc in rfp.get("page_contents", [])
        ).strip()
        if not full_text:
            return None
        return rfp.get("name", "RFP"), full_text

    def _filtered_rfp_requirement_headings(self, gs: GraphService, limit: int = 6) -> List[str]:
        """Heading-like lines from the ingested RFP, EXCLUDING administrative
        sections (Evaluation Criteria, Submission Instructions, etc.) — those
        are instructions to the vendor, never content the vendor's own offer
        should contain. Used only to inform how 'Response to Requirements' is
        organized internally, never as the whole offer's structure."""
        rfp_text = self._get_rfp_text(gs)
        if rfp_text is None:
            return []
        _, full_text = rfp_text
        headings: List[str] = []
        for line in full_text.split("\n"):
            line = line.strip()
            if not line or len(line) > 90 or _ADMINISTRATIVE_HEADING_RE.search(line):
                continue
            if _HEADING_LINE_RE.match(line):
                headings.append(line)
            if len(headings) >= limit:
                break
        return headings

    def _structure_block(self, gs: GraphService, template: str) -> Tuple[str, str]:
        """Returns (structure_instruction_block, offer_type_label)."""
        headings = "\n".join(f"{i + 1}. {h}" for i, h in enumerate(FIXED_TEMPLATES[template]))
        block = f"STRUCTURE TO FOLLOW — use exactly this section order:\n{headings}"
        if template == "rfp_response":
            req_headings = self._filtered_rfp_requirement_headings(gs)
            if req_headings:
                block += (
                    "\n\nFor the 'Response to Requirements' section specifically, organize your "
                    "point-by-point response using the RFP's own requirement categories where evident "
                    "below (do NOT pull in the RFP's administrative sections like Evaluation Criteria or "
                    "Submission Instructions — those are instructions to you, not content for your own "
                    "offer):\n" + "\n".join(f"- {h}" for h in req_headings)
                )
        return block, TEMPLATE_LABELS[template]

    def preview_template_sections(self, gs: GraphService, template: str) -> List[str]:
        """A lightweight, no-LLM preview of what a template's structure looks like,
        so the picker can show real structure instead of just a text description."""
        sections = list(FIXED_TEMPLATES.get(template, []))
        if template == "rfp_response" and "Response to Requirements" in sections:
            req_headings = self._filtered_rfp_requirement_headings(gs, limit=4)
            if req_headings:
                idx = sections.index("Response to Requirements")
                sections = sections[:idx + 1] + [f"↳ {h}" for h in req_headings] + sections[idx + 1:]
        return sections

    # ------------------------------------------------------------------
    # AI-assisted inline revision — the user selects a span of text inside a
    # drafted section and asks for a targeted rewrite, distinct from a full
    # manual edit. Only the selected span is sent for rewriting, and only the
    # returned replacement is spliced back in client-side — the model never
    # sees or touches the rest of the document.
    # ------------------------------------------------------------------

    def revise_selection(self, section_body: str, selected_text: str, instruction: str) -> str:
        system = (
            "You are revising ONE specific portion of an offer/proposal section per the user's instruction. "
            "Return ONLY the replacement text for the selected portion — it must read naturally in "
            "place of the original, matching the surrounding section's tone, grammar, and formatting. "
            "Do not return the whole section, only the replacement for the selected text. Do not add "
            "commentary, quotation marks, or markdown fences around it."
        )
        user = (
            f"FULL SECTION (context only — do not repeat it back):\n{section_body}\n\n"
            f"SELECTED TEXT TO REPLACE:\n{selected_text}\n\n"
            f"INSTRUCTION:\n{instruction}"
        )
        try:
            data = self._call(system, user, _revise_tool(), "emit_revision", max_tokens=1000)
        except Exception as exc:
            logger.warning("Section revision failed: %s", exc)
            return selected_text
        revised = str(data.get("revised_text", "")).strip()
        return revised or selected_text

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    def generate_draft(self, gs: GraphService, template: str, bundle: dict) -> Tuple[str, List[dict], List[dict]]:
        structure_block, contract_type = self._structure_block(gs, template)

        def _fmt(items: List[dict]) -> str:
            return "; ".join(str(i.get("text", "")) for i in items) or "(none)"

        def _status_note(status: str) -> str:
            return (
                "ALREADY COVERED by an existing clause — restate/adapt its substance into this offer's own "
                "language (matching figures/terms, not inventing different ones); do not skip it just "
                "because coverage already exists"
                if status == "Covered" else
                "NEEDS NEW LANGUAGE — propose it now, that is the actual point of drafting a response"
            )

        requirements_text = "\n\n".join(
            f"Requirement {e['requirement_id']} — {_status_note(e['status'])}\n"
            f"  Requirement text: {e['requirement_text']}\n"
            f"  Existing covering clause(s): {_fmt(e['full_coverage'] + e['partial_coverage'])}\n"
            f"  Risk(s): {_fmt(e['risks'])}\n"
            f"  Mitigation(s): {_fmt(e['mitigations'])}\n"
            f"  LD(s): {_fmt(e['lds'])}"
            for e in bundle["requirements"]
        ) or "(no requirements found in this workspace's graph)"

        gaps_text = "\n".join(
            f"- {g['requirement_text']} — {g['reason']}" for g in bundle["gaps"]
        ) or "(none)"

        system = (
            f"You are drafting a real {contract_type} responding to an RFP for an actual counterparty — not "
            "training data. A real offer/proposal is COMPREHENSIVE: it addresses every requirement below, "
            "not just the ones currently missing coverage — restating how an already-covered requirement is "
            "met is just as much a part of a response as proposing language for a gap. Every claim must be "
            "grounded in the real requirement/clause/risk/mitigation text provided below; never invent "
            "facts, figures, or obligations that aren't given.\n\n"
            "For EVERY requirement listed below:\n"
            "1. Address it in an appropriate section per the note next to it (restate existing coverage, or "
            "propose new language for a gap) and cite its requirement_id in 'addressed_requirement_ids'. "
            "Only leave a requirement genuinely unaddressed if there is truly no reasonable basis to say "
            "anything about it.\n"
            "2. If it has an associated risk, EXPLICITLY acknowledge that risk in the section body and "
            "state a concrete mitigation approach — do not rely on clause language alone to imply the risk "
            "is handled. This is standard, expected practice; an absent risk discussion reads as a red flag "
            "to a reviewer, not a sign of confidence.\n"
            "3. Reference an LD only if one is explicitly listed for it below — never invent one.\n"
            "4. Never fabricate a resolution with vague, non-committal language just to appear complete — if "
            "you cannot say anything concrete about a requirement, leave it out of 'addressed_requirement_ids' "
            "entirely so it's flagged for human attention instead of falsely appearing resolved.\n\n"
            "For each section, 'citations' evidence is not optional: a non-empty verbatim quote copied from "
            "THIS SECTION'S OWN 'body' (the text you are writing, not the source material above) is "
            "REQUIRED whenever verdict is 'strong' or 'partial'. Use an empty quote only for verdict='weak'."
        )
        user = (
            f"{structure_block}\n\nALL REQUIREMENTS TO ADDRESS ({len(bundle['requirements'])} total):\n"
            f"{requirements_text}\n\n"
            f"FLAGGED GAPS — no existing covering clause and/or an unmitigated risk; propose new language "
            f"for as many as you reasonably can (per instruction 1 above):\n{gaps_text}"
        )

        data = self._call(system, user, _draft_tool(), "emit_draft", max_tokens=6000)
        title = str(data.get("title") or f"Draft {contract_type}").strip()
        sections: List[dict] = []
        for s in data.get("sections", []):
            body = str(s.get("body", "")).strip()
            if not body:
                continue
            citations = []
            for c in s.get("citations", []):
                quote = str(c.get("quote", "")).strip()
                verdict = c.get("verdict") if c.get("verdict") in ("strong", "partial", "weak") else "weak"
                if quote and not _quote_appears_in(quote, body):
                    quote, verdict = "", "weak"
                citations.append({
                    "requirement_id": str(c.get("requirement_id", "")),
                    "aspect": str(c.get("aspect", "")).strip(),
                    "quote": quote, "verdict": verdict,
                })
            sections.append({
                "heading": str(s.get("heading", "Section")).strip(),
                "body": body,
                "addressed_requirement_ids": [str(i) for i in s.get("addressed_requirement_ids", [])],
                "citations": citations,
                "status": "pending",
            })

        # A "flagged gap" only means "no existing clause covered this" — the draft may well have
        # just proposed new language for it (that's the point). Only surface it as an unresolved
        # gap to the reviewer if it genuinely never got addressed by any section.
        addressed_ids = {rid for s in sections for rid in s["addressed_requirement_ids"]}
        unresolved_gaps = [g for g in bundle["gaps"] if g["requirement_id"] not in addressed_ids]

        logger.info(
            "Generated contract draft '%s' (%s, %d sections, %d/%d flagged gaps left unresolved)",
            title, template, len(sections), len(unresolved_gaps), len(bundle["gaps"]),
        )
        return title, sections, unresolved_gaps
