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
    "rfp_response": "RFP Response",
    "rfp_mirror": "Contract",
}


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
            "description": "Emit one complete, coherent draft response Contract/Offer.",
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
        Collect every Not-Covered/Partial requirement's full traceability chain
        (real clause/risk/mitigation/LD text, not bare IDs) plus a count of
        already-covered requirements, so the draft prompt has real material to
        cite and real gaps to keep visible rather than paper over. One
        get_traceability call per gap requirement — no batch Neo4j method
        exists today; acceptable for the typically-small gap count in v1.
        """
        coverage = gs.get_coverage_results()
        addressable: List[dict] = []
        gaps: List[dict] = []
        covered_count = 0

        for r in coverage:
            if r.status == CoverageStatus.COVERED:
                covered_count += 1
                continue
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
            addressable.append(entry)
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
            "addressable": addressable,
            "gaps": gaps,
            "summary": {
                "requirements_total": len(coverage),
                "requirements_covered": covered_count,
                "requirements_needing_attention": len(addressable),
                "gaps_count": len(gaps),
            },
        }

    def _structure_block(self, gs: GraphService, template: str) -> Tuple[str, str]:
        """Returns (structure_instruction_block, contract_type_label)."""
        if template in FIXED_TEMPLATES:
            headings = "\n".join(f"{i + 1}. {h}" for i, h in enumerate(FIXED_TEMPLATES[template]))
            return (
                f"STRUCTURE TO FOLLOW — use exactly this section order:\n{headings}",
                TEMPLATE_LABELS[template],
            )
        # Default ('rfp_mirror'): ground structure in the ingested RFP's own text.
        try:
            docs = gs.store.get_document_contents(gs.workspace_id)
        except Exception as exc:
            logger.warning("Could not load RFP for structure grounding: %s", exc)
            docs = []
        rfp = next((d for d in docs if d.get("type") == "RFP"), None)
        if rfp is None:
            return ("", TEMPLATE_LABELS["rfp_mirror"])
        full_text = "\n\n".join(
            (pc.get("native_text") or pc.get("ocr_text") or "") for pc in rfp.get("page_contents", [])
        ).strip()
        if not full_text:
            return ("", TEMPLATE_LABELS["rfp_mirror"])
        return (
            f"STRUCTURE TO FOLLOW — mirror this RFP's own section order and level of detail "
            f"('{rfp.get('name', 'RFP')}'), given in full below. Respond to it as a real contract "
            f"offer in your own words — do not copy its text verbatim:\n\n{full_text[:MAX_RFP_TEXT_CHARS]}",
            TEMPLATE_LABELS["rfp_mirror"],
        )

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    def generate_draft(self, gs: GraphService, template: str, bundle: dict) -> Tuple[str, List[dict], List[dict]]:
        structure_block, contract_type = self._structure_block(gs, template)

        def _fmt(items: List[dict]) -> str:
            return "; ".join(str(i.get("text", "")) for i in items) or "(none)"

        addressable_text = "\n\n".join(
            f"Requirement {e['requirement_id']} ({e['status']}): {e['requirement_text']}\n"
            f"  Covering clause(s): {_fmt(e['full_coverage'] + e['partial_coverage'])}\n"
            f"  Risk(s): {_fmt(e['risks'])}\n"
            f"  Mitigation(s): {_fmt(e['mitigations'])}\n"
            f"  LD(s): {_fmt(e['lds'])}"
            for e in bundle["addressable"]
        ) or "(no outstanding requirements — coverage is already complete)"

        gaps_text = "\n".join(
            f"- {g['requirement_text']} — {g['reason']}" for g in bundle["gaps"]
        ) or "(none)"

        system = (
            f"You are a senior contract drafter producing a real response {contract_type} for an actual "
            "counterparty — not training data. Every claim must be grounded in the real requirement/clause/"
            "risk/mitigation text provided below; never invent facts, figures, or obligations that aren't "
            "given.\n\n"
            "For EVERY requirement listed below that isn't already fully covered:\n"
            "1. PROPOSE NEW CONTRACT LANGUAGE for it in an appropriate section, citing its requirement_id in "
            "'addressed_requirement_ids' — this is the actual point of drafting a response: a requirement "
            "having 'no existing clause' (see FLAGGED GAPS below) means you should draft one now, not skip "
            "it. Only leave a requirement genuinely unaddressed if there is truly no reasonable basis to "
            "propose language for it — do not skip requirements just because they were previously uncovered.\n"
            "2. If it has an associated risk, EXPLICITLY acknowledge that risk in the section body and "
            "state a concrete mitigation approach — do not rely on clause language alone to imply the risk "
            "is handled. This is standard, expected practice; an absent risk discussion reads as a red flag "
            "to a reviewer, not a sign of confidence.\n"
            "3. Reference an LD only if one is explicitly listed for it below — never invent one.\n"
            "4. Never fabricate a resolution with vague, non-committal language just to appear complete — if "
            "you cannot propose concrete language for something, leave it out of 'addressed_requirement_ids' "
            "entirely so it's flagged for human attention instead of falsely appearing resolved.\n\n"
            "For each section, 'citations' evidence is not optional: a non-empty verbatim quote copied from "
            "THIS SECTION'S OWN 'body' (the text you are writing, not the source material above) is "
            "REQUIRED whenever verdict is 'strong' or 'partial'. Use an empty quote only for verdict='weak'."
        )
        user = (
            f"{structure_block}\n\nOUTSTANDING REQUIREMENTS TO ADDRESS:\n{addressable_text}\n\n"
            f"FLAGGED GAPS — these have no existing covering clause today; propose new language for as many "
            f"as you reasonably can (per instruction 1 above):\n{gaps_text}"
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
