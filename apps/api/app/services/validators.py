"""Deterministic output validation. Every rewrite must pass before it can replace a block."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from app.services.blocks import Block
from app.services.prompts import BANNED_PHRASES_LOWER

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s]+", re.I)
DATE_RE = re.compile(
    r"\b(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}"
    r"|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4})\b",
    re.I,
)
ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,7}\b")
PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b")
EM_DASH = "—"


@dataclass
class ValidationResult:
    ok: bool
    reasons: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)

    @classmethod
    def pass_(cls, **metrics: float) -> ValidationResult:
        return cls(True, [], {k: float(v) for k, v in metrics.items()})

    @classmethod
    def fail(cls, *reasons: str, **metrics: float) -> ValidationResult:
        return cls(False, list(reasons), {k: float(v) for k, v in metrics.items()})


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _length_ratio(original: str, rewritten: str) -> float:
    o, n = max(len(original), 1), max(len(rewritten), 1)
    return n / o


def _tolerance(block: Block) -> float:
    if block.word_count < 10:
        return 0.85
    if block.word_count < 25:
        return 0.50
    return 0.25


def _numbers(text: str) -> list[str]:
    return [n.replace(",", "") for n in NUMBER_RE.findall(text)]


def _missing_numbers(original: str, rewritten: str) -> list[str]:
    from collections import Counter

    orig, new = Counter(_numbers(original)), Counter(_numbers(rewritten))
    return [n for n, c in orig.items() if new[n] < c]


def _missing_entities(original: str, rewritten: str) -> list[str]:
    missing: list[str] = []
    n_norm = _norm(rewritten)
    for pattern in (EMAIL_RE, URL_RE, DOI_RE, DATE_RE):
        for match in pattern.findall(original):
            value = match if isinstance(match, str) else match[0]
            if _norm(value) not in n_norm:
                missing.append(value)
    for acronym in set(ACRONYM_RE.findall(original)):
        if len(acronym) >= 2 and acronym not in rewritten:
            missing.append(acronym)
    return missing


COMMON_CAPITALIZED = {
    "product", "requirements", "document", "section", "overview", "features", "phase",
    "version", "draft", "date", "status", "review", "summary", "architecture", "scope",
    "background", "objective", "objectives", "goals", "timeline", "milestone", "milestones",
    "table", "figure", "appendix", "introduction", "conclusion", "results", "analysis",
    "delivery", "marketplace", "platform", "system", "service", "services", "user", "users",
    "customer", "customers", "vendor", "vendors", "order", "orders", "payment", "payments",
    "shipping", "hyperlocal", "inventory", "catalog", "checkout", "mobile", "application",
    "frontend", "backend", "database", "security", "testing", "deployment", "monitoring",
    "note", "notes", "important", "warning", "details", "description", "specification", "guide",
    "seller", "sellers", "shopkeeper", "shopkeepers", "merchant", "merchants", "partner", "partners",
    "rider", "riders", "courier", "couriers", "admin", "admins", "super", "administrator", "administrators",
    "buyer", "buyers", "shopper", "shoppers", "client", "clients", "consumer", "consumers",
    "return", "returns", "refund", "refunds", "cancellation", "cancellations", "acceptance",
    "settlement", "settlements", "payout", "payouts", "commission", "commissions", "incentive", "incentives",
    "bonus", "bonuses", "rating", "ratings", "repeat", "purchase", "purchases", "category", "categories",
    "taxonomy", "banner", "banners", "radius", "location", "pincode", "area", "session", "token", "tokens",
    "device", "devices", "address", "addresses", "coupon", "coupons", "store", "stores", "shop", "shops",
    "profile", "profiles", "account", "accounts", "saree", "sarees", "fabric", "fabrics", "apparel",
    "step", "steps", "item", "items", "task", "tasks", "flow", "flows", "process", "processes",
    "average", "typical", "total", "ratio", "rate", "rates", "count", "counts", "time", "times", "duration",
    "first", "second", "third", "fourth", "fifth", "final", "initial", "last", "give", "gives", "offer", "offers",
    "provide", "provides", "grant", "grants", "show", "shows", "display", "displays", "reward", "rewards",
    "manage", "manages", "control", "controls", "view", "views", "track", "tracks", "problem", "statement",
    "non-goals", "success", "metrics", "assumptions", "criteria", "standard", "standards", "rule", "rules",
    "policy", "policies", "quality", "performance", "speed", "pacing", "window", "windows", "target", "targets"
}


def _missing_proper_nouns(original: str, rewritten: str) -> list[str]:
    n_norm = _norm(rewritten)
    missing = []
    # Identify sentence starters or list starters to avoid treating them as proper nouns
    starters = {m.group(1).lower() for m in re.finditer(r"(?:^|[.!?]\s+|\d+\.\s+)([A-Z][a-z]{2,})", original)}
    for noun in set(PROPER_NOUN_RE.findall(original)):
        low_noun = _norm(noun)
        if low_noun in starters or low_noun in COMMON_CAPITALIZED or any(w in COMMON_CAPITALIZED for w in low_noun.split()):
            continue
        if len(noun) > 3 and low_noun not in n_norm:
            missing.append(noun)
    return missing


def banned_phrases(text: str) -> list[str]:
    low = _norm(text)
    return [p for p in BANNED_PHRASES_LOWER if p in low]


def script_signature(text: str) -> str:
    counts: dict[str, int] = {}
    for ch in text:
        if ch.isspace():
            continue
        counts[unicodedata.name(ch, "?").split()[0]] = counts.get(unicodedata.name(ch, "?").split()[0], 0) + 1
    return max(counts, key=counts.get) if counts else ""


def validate_rewrite(block: Block, rewritten: str, *, strict_numbers: bool = True) -> ValidationResult:
    original = block.text
    rewritten = (rewritten or "").strip()
    if not rewritten:
        return ValidationResult.fail("empty output")
    if rewritten == original.strip():
        return ValidationResult.pass_(unchanged=1)

    ratio = _length_ratio(original, rewritten)
    tol = _tolerance(block)
    if abs(ratio - 1.0) > tol:
        return ValidationResult.fail(
            f"length ratio {ratio:.2f} outside ±{tol:.0%}", length_ratio=ratio
        )

    reasons: list[str] = []
    missing_numbers = _missing_numbers(original, rewritten) if strict_numbers else []
    if missing_numbers:
        reasons.append(f"numbers dropped: {', '.join(missing_numbers[:6])}")
    missing_entities = _missing_entities(original, rewritten)
    if missing_entities:
        reasons.append(f"entities dropped: {', '.join(missing_entities[:4])}")
    missing_nouns = _missing_proper_nouns(original, rewritten)
    if len(missing_nouns) > 1:
        reasons.append(f"names dropped: {', '.join(missing_nouns[:4])}")
    banned = banned_phrases(rewritten)
    if banned:
        reasons.append(f"stock AI phrases: {', '.join(banned[:4])}")
    if EM_DASH * 2 in rewritten:
        reasons.append("em-dash overuse")
    if script_signature(original) and script_signature(rewritten) != script_signature(original):
        reasons.append("script changed (language drift)")

    if reasons:
        return ValidationResult.fail(*reasons, length_ratio=ratio)
    return ValidationResult.pass_(length_ratio=ratio)


def validate_document_level(original_words: int, rewritten_words: int, tolerance: float = 0.10) -> bool:
    if original_words == 0:
        return rewritten_words == 0
    return abs(rewritten_words / original_words - 1) <= tolerance


def validate_json_payload(payload: object, block: Block) -> tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "response is not a JSON object"
    if "rewritten" not in payload:
        return False, "missing 'rewritten' key"
    if not isinstance(payload["rewritten"], str):
        return False, "'rewritten' is not a string"
    if str(payload.get("block_id", block.id)) != block.id:
        return False, "block_id mismatch"
    return True, ""
