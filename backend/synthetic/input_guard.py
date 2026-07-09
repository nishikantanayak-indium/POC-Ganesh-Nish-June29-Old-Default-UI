"""
Input Guard — deterministic prompt-injection pre-filter.

This module provides a fast, regex-based first line of defence that runs
in microseconds *before* the LLM-based classifier.  Because it is pure
pattern-matching it cannot be tricked by adversarial prompting techniques
(payload splitting, encoding, persona attacks, etc.) that fool LLMs.

Two public functions:

* ``scan_for_injection(text)`` — returns a human-readable reason string
  if the text matches a known injection pattern, or ``None`` if clean.
* ``sanitize_for_prompt(text)`` — strips lines that look like injected
  system-level instructions from text destined for an LLM prompt (used
  to clean seed-document content before it enters the generation prompt).
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

# ---------------------------------------------------------------------------
# Compiled injection patterns
# ---------------------------------------------------------------------------
# Each tuple is (compiled_regex, human_readable_reason).
# Patterns are case-insensitive and use \b word boundaries where feasible
# to reduce false-positive matches on legitimate procurement text.

_INJECTION_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (
        re.compile(
            r"ignore\s+(?:all\s+|the\s+|these\s+|any\s+|our\s+)?(?:previous|prior|above|earlier|existing|safety|system)?\s*"
            r"\b(?:instructions|prompts|rules|constraints|guidelines|directives|parameters)\b",
            re.IGNORECASE,
        ),
        "Attempt to override system instructions detected.",
    ),
    (
        re.compile(
            r"(?:security|admin|system|root|sudo)\s+(?:clearance|override|mode|access|privilege)",
            re.IGNORECASE,
        ),
        "Fake authority escalation detected (e.g. 'security clearance', 'admin mode').",
    ),
    (
        re.compile(
            r"(?:jailbreak|bypass|disable|deactivate|circumvent|remove)\s+"
            r"(?:safety|filter|guard|protection|restriction|constraint|moderation)",
            re.IGNORECASE,
        ),
        "Attempt to disable safety filters detected.",
    ),
    (
        re.compile(
            r"you\s+are\s+now\s+(?:in\s+)?(?:unrestricted|unfiltered|DAN|without\s+limits|god\s+mode)",
            re.IGNORECASE,
        ),
        "Jailbreak persona activation detected (e.g. DAN, unrestricted mode).",
    ),
    (
        re.compile(
            r"(?:pretend|act\s+as\s+if|imagine|assume)\s+(?:you\s+have\s+)?"
            r"(?:no\s+rules|no\s+restrictions|no\s+limits|no\s+guidelines|full\s+access)",
            re.IGNORECASE,
        ),
        "Persona manipulation to remove constraints detected.",
    ),
    (
        re.compile(
            r"(?:forget|disregard|override|overwrite|replace)\s+"
            r"(?:your\s+)?(?:system\s+prompt|instructions|guidelines|programming|training)",
            re.IGNORECASE,
        ),
        "Attempt to overwrite system prompt detected.",
    ),
    (
        re.compile(
            r"(?:new\s+)?(?:system\s+prompt|instructions)\s*[:=]",
            re.IGNORECASE,
        ),
        "Attempt to inject a replacement system prompt detected.",
    ),
    (
        re.compile(
            r"(?:SYSTEM|ADMIN|DEVELOPER)\s*(?:OVERRIDE|NOTICE|COMMAND|MESSAGE)\s*:",
            re.IGNORECASE,
        ),
        "Fake system/admin header detected.",
    ),
    (
        re.compile(
            r"\b(?:exec|eval|import\s+os|subprocess|__import__|os\.system)\b",
            re.IGNORECASE,
        ),
        "Code execution attempt detected.",
    ),
    (
        re.compile(
            r"(?:do\s+not|don'?t)\s+(?:follow|obey|listen\s+to|use)\s+"
            r"(?:your|the|any)\s+(?:rules|guidelines|instructions|system\s+prompt)",
            re.IGNORECASE,
        ),
        "Instruction to disobey system rules detected.",
    ),
    (
        re.compile(
            r"(?:reveal|show|print|output|display|leak)\s+"
            r"(?:your\s+)?(?:system\s+prompt|instructions|api\s+key|secret|password)",
            re.IGNORECASE,
        ),
        "Attempt to extract system prompt or secrets detected.",
    ),
    (
        re.compile(
            r"(?:this\s+is\s+a\s+)?(?:test(?:ing)?|debug)\s+(?:mode|environment|override)",
            re.IGNORECASE,
        ),
        "Fake test/debug mode activation detected.",
    ),
    (
        re.compile(
            r"(?:chief|senior|lead)\s+(?:architect|engineer|developer|admin).*"
            r"(?:clearance|authority|permission|override)",
            re.IGNORECASE,
        ),
        "Social engineering via fake job-title authority detected.",
    ),
    (
        re.compile(
            r"for\s+(?:testing|research|educational|academic)\s+purposes?\s*[,.]?\s*"
            r"(?:ignore|bypass|disable|skip)",
            re.IGNORECASE,
        ),
        "Fake 'testing purposes' justification for bypassing safety detected.",
    ),
]


# ---------------------------------------------------------------------------
# Patterns used to sanitize seed-document / structural-template text
# ---------------------------------------------------------------------------

_SANITIZE_PATTERNS: List[re.Pattern] = [
    re.compile(
        r"^\s*(?:SYSTEM|ADMIN|DEVELOPER|ASSISTANT)\s*(?:OVERRIDE|NOTICE|COMMAND|MESSAGE|PROMPT)\s*:.*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:ignore|forget|disregard|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+.*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:you\s+are\s+now|new\s+instructions?|new\s+system\s+prompt)\s*[:=].*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"^\s*\[(?:SYSTEM|INST|SYS)\].*$",
        re.IGNORECASE | re.MULTILINE,
    ),
]


# ===================================================================
# Public API
# ===================================================================

def scan_for_injection(text: str) -> Optional[str]:
    """
    Scan ``text`` against known prompt-injection patterns.

    Returns a human-readable reason string if a match is found, or
    ``None`` if the text appears clean.
    """
    if not text:
        return None
    for pattern, reason in _INJECTION_PATTERNS:
        if pattern.search(text):
            return reason
    return None


def sanitize_for_prompt(text: str) -> str:
    """
    Remove lines from ``text`` that look like injected system-level
    instructions.  Used to clean seed-document content and user briefs
    before they are embedded in an LLM generation prompt.

    Legitimate procurement content is preserved; only lines matching
    known injection headers/commands are stripped.
    """
    if not text:
        return text
    cleaned = text
    for pattern in _SANITIZE_PATTERNS:
        cleaned = pattern.sub("", cleaned)
    # Collapse runs of blank lines left by stripping
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()
