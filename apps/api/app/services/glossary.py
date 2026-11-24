"""Terminology memory: keep acronyms, product names and technical terms identical across pages.

Workers are synchronous (Celery) and talk to Redis synchronously; the API's async client is
unaffected because Pub/Sub and keys are shared.
"""
from __future__ import annotations

import json
import re
from collections import Counter

ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,7}\b")
CAMEL_RE = re.compile(r"\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b")
STOPWORDS = {
    "The", "This", "That", "These", "Those", "However", "Therefore", "Because", "Although",
    "Introduction", "Conclusion", "Abstract", "Results", "Discussion", "Methods", "References",
    "Figure", "Table", "Chapter", "Section", "Appendix", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March", "April",
    "May", "June", "July", "August", "September", "October", "November", "December",
}


def extract_terms(texts: list[str], limit: int = 60) -> dict[str, str]:
    counter: Counter[str] = Counter()
    for text in texts:
        for acronym in ACRONYM_RE.findall(text):
            if len(acronym) >= 2:
                counter[acronym] += 2
        for camel in CAMEL_RE.findall(text):
            counter[camel] += 2
        for noun in re.findall(r"\b[A-Z][a-z]{2,}(?:[- ][A-Z][a-z]{2,})+\b", text):
            counter[noun] += 1
    terms: dict[str, str] = {}
    for term, _freq in counter.most_common(limit * 2):
        if term in STOPWORDS or term.lower() in {w.lower() for w in STOPWORDS}:
            continue
        terms[term] = term
        if len(terms) >= limit:
            break
    return terms


class TerminologyMemory:
    """Redis-backed, per-job glossary. Workers merge LLM-suggested canonical forms."""

    def __init__(self, client, job_id: str, initial: dict[str, str] | None = None):
        self.client = client
        self.key = f"glossary:{job_id}"
        self.initial = initial or {}

    def load(self) -> dict[str, str]:
        raw = self.client.get(self.key)
        if raw:
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return dict(self.initial)
        return dict(self.initial)

    def merge(self, terms: dict[str, str] | None) -> None:
        if not terms:
            return
        current = self.load()
        for k, v in terms.items():
            if isinstance(k, str) and isinstance(v, str) and 0 < len(k) <= 60 and len(v) <= 80:
                current.setdefault(k.strip(), v.strip())
        self.client.set(self.key, json.dumps(current), ex=7 * 86400)
