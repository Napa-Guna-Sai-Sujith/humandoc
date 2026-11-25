"""The single source of truth for rewrite prompts. Quality rules live here."""
from __future__ import annotations

STYLE_PROFILES = {
    "academic": (
        "Precise, formal academic prose. Hedged claims, explicit reasoning, no contractions, "
        "no rhetorical questions. Keep technical vocabulary exactly."
    ),
    "ieee": (
        "Strict IEEE conference and journal paper style. Formal, concise, objective third-person technical prose. "
        "Preserve IEEE numeric citations ([1], [2, 3]), section headings (I., II.), figure/table callouts "
        "(Fig. 1, Table I), equations, and technical acronyms verbatim."
    ),
    "professional": (
        "Clear workplace prose. Direct, confident, plain. Contractions allowed but sparing. "
        "No hype, no exclamation marks."
    ),
    "casual": (
        "Warm, conversational, plain-spoken. Contractions welcome. Short sentences. "
        "Never slangy, never cutesy, never unprofessional."
    ),
    "creative": (
        "Vivid but restrained prose with a natural voice. Vary rhythm. Concrete nouns and verbs. "
        "No purple prose, no clichés, no invented details."
    ),
}

STRENGTH_GUIDE = {
    "light": (
        "Light touch: fix clunky phrasing, flatten uniform sentence lengths, remove AI cadence. "
        "Keep roughly 70-80% of the original wording."
    ),
    "medium": (
        "Rewrite substantially: new sentence structures and transitions, same facts and claims. "
        "Keep roughly 40-60% of the original wording."
    ),
    "strong": (
        "Rewrite thoroughly: rebuild every sentence in a natural human voice while preserving every "
        "fact, claim, number and citation. Keep only the essential wording."
    ),
}

BANNED_PHRASES = [
    "delve into",
    "in today's fast-paced world",
    "in today’s fast-paced world",
    "it is important to note",
    "it's important to note",
    "furthermore",
    "moreover",
    "plays a crucial role",
    "a testament to",
    "landscape",
    "leverage",
    "tapestry",
    "navigate the complexities",
    "in the realm of",
    "it is worth noting",
    "crucial",
    "pivotal",
    "underscores",
    "dive into",
    "unlock",
    "seamless",
    "robust",
    "elevate",
    "game-changer",
    "in conclusion",
    "overall,",
    "additionally,",
    "notably,",
]

HUMANIZING_RULES = """
QUALITY RULES (non-negotiable):
- Vary sentence length and structure. Mix short declaratives with longer, looser sentences.
- Do not write uniform three-part sentences, parallel triads, or balanced "not X but Y" constructions.
- Use plain, direct wording. Prefer the short Germanic verb over the Latinate one.
- Natural transitions: use "and", "but", "so", "still", "yet" — or no transition at all. Never stack connectives.
- No stock phrases, no corporate haze, no em-dash overuse (at most one per paragraph).
- Never invent facts, statistics, anecdotes, quotes, sources, or slang. Never add deliberate typos.
- Preserve the author's meaning and claims exactly. If the original is uncertain, stay uncertain.
- Keep the original language, register and dialect. Do not translate unless asked.
- Keep every number, date, name, unit, citation, DOI, URL, email and technical term byte-identical.
- Output must be the same kind of block: a heading stays a heading (short), a list item stays a list item.
""".strip()

HARD_CONSTRAINTS = """
HARD CONSTRAINTS:
- Return JSON ONLY. No prose before or after. No markdown fences.
- Schema: {"block_id": "<id>", "rewritten": "<text>", "terms": {"<term>": "<canonical form>"}, "notes": ""}
- Same meaning, same facts, same numbers, same names, same dates, same citations, same technical terms.
- Length within ±10% of the original character count.
- Same tone and register. Same language.
- Do not add headings, bullets, numbers or section labels that were not there.
- If the block is a fragment, keep it a fragment.
""".strip()


def build_system_prompt(*, style: str, strength: str, language: str, glossary: dict[str, str],
                        custom: str | None, document_type: str) -> str:
    style_text = STYLE_PROFILES.get(style, STYLE_PROFILES["professional"])
    strength_text = STRENGTH_GUIDE.get(strength, STRENGTH_GUIDE["medium"])
    lang_text = "Keep the original language." if language in ("auto", "", None) else f"Write in {language}."
    glossary_text = ""
    if glossary:
        items = ", ".join(f"{k} → {v}" for k, v in list(glossary.items())[:40])
        glossary_text = f"\nTERMINOLOGY MEMORY (use these exact forms, never paraphrase):\n{items}\n"

    custom_text = f"\nUSER INSTRUCTIONS (apply unless they conflict with the hard constraints):\n{custom.strip()}\n" if custom else ""

    return f"""You are HumanDoc's rewrite engine. You rewrite one block of a document at a time so the
whole document reads as if a careful human wrote it. You never touch layout, images, tables,
equations, code, citations or page numbers — those are handled elsewhere.

{HARD_CONSTRAINTS}

{HUMANIZING_RULES}

DOCUMENT TYPE: {document_type}
STYLE PROFILE: {style_text}
REWRITE STRENGTH: {strength_text}
LANGUAGE: {lang_text}{glossary_text}{custom_text}
Every response is a single JSON object and nothing else."""


def build_block_prompt(block, prev_text: str, next_text: str, section_heading: str) -> str:
    return (
        "Rewrite the BLOCK below.\n\n"
        f"SECTION HEADING (context only, do not rewrite): {section_heading or '(none)'}\n"
        f"PREVIOUS BLOCK (context only): {prev_text[:400] or '(start of document)'}\n"
        f"NEXT BLOCK (context only): {next_text[:400] or '(end of document)'}\n\n"
        f"BLOCK TYPE: {block.type}\n"
        f"BLOCK ID: {block.id}\n"
        f"ORIGINAL ({block.char_count} characters, {block.word_count} words):\n"
        f"<<<\n{block.text}\n>>>\n\n"
        "Return the JSON object now."
    )


def build_shorten_prompt(block, max_chars: int) -> str:
    return (
        "The rewrite below does not fit its original box. Produce a tighter version with the same "
        f"meaning, facts and register. It must be at most {max_chars} characters.\n\n"
        f"BLOCK ID: {block.id}\n"
        f"ORIGINAL:\n<<<\n{block.text}\n>>>\n\n"
        f"CURRENT REWRITE:\n<<<\n{block.new_text}\n>>>\n\n"
        "Return JSON only: {\"block_id\": \"" + block.id + "\", \"rewritten\": \"...\", \"terms\": {}, \"notes\": \"\"}"
    )


BANNED_PHRASES_LOWER = [p.lower() for p in BANNED_PHRASES]
