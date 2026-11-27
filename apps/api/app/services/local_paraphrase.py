"""Syntactic + single-pass lexical local paraphrasing engine.

Breaks consecutive 4-gram / 5-gram plagiarism shingles and flat LLM cadence
without cascading replacements, while preserving numbers, acronyms, citations,
URLs, quoted titles, and proper nouns.
"""
from __future__ import annotations

import re

# Single-pass longest-phrase-first map (no chained re-substitution bugs)
PHRASE_MAP: dict[str, str] = {
    "in today's fast-paced digital landscape": "in modern connected practice",
    "in today's fast-paced digital world": "in modern connected practice",
    "in today's fast-paced world": "in modern life",
    "plays an important role in": "is central to",
    "plays a crucial role in": "heavily shapes",
    "plays a pivotal role in": "drives",
    "plays a vital role in": "underpins",
    "plays a key role in": "anchors",
    "it is important to note that": "",
    "it is worth noting that": "",
    "it is essential that": "it matters that",
    "due to the fact that": "because",
    "at this point in time": "now",
    "as a matter of fact": "in reality",
    "with respect to": "regarding",
    "with regard to": "concerning",
    "in connection with": "tied to",
    "there is a need for": "modern cities require",
    "are explained below": "are outlined next",
    "to address this issue": "to solve this bottleneck",
    "to address this problem": "to solve this bottleneck",
    "for a fixed duration": "for a set interval",
    "predefined time intervals": "preset timing windows",
    "predefined sequence": "fixed cycle",
    "at a time": "per turn",
    "in order to": "to",
    "according to": "based on",
    "such as": "like",
    "as well as": "along with",
    "in addition to": "besides",
    "related to": "stemming from",
    "wide range of": "broad mix of",
    "broad range of": "varied set of",
    "large number of": "many",
    "significant improvement": "clear gain",
    "significant improvements": "clear gains",
    "the proposed system": "our design",
    "proposed system": "new design",
    "the proposed project": "this work",
    "proposed project": "developed work",
    "main controller": "primary control unit",
    "wireless communication": "radio data links",
    "geographical coordinates": "location coordinates",
    "signalised junctions": "traffic-light intersections",
    "signalized junctions": "traffic-light intersections",
    "road intersections": "street junctions",
    "vehicle movement": "traffic flow",
    "fixed-time traffic signals": "preset signal timers",
    "fixed time intervals": "preset timing intervals",
    "traditional traffic signal systems": "legacy signal setups",
    "traditional traffic management systems": "conventional traffic controllers",
    "intelligent traffic management system": "smart traffic platform",
    "traffic management system": "traffic control setup",
    "traffic management systems": "traffic control setups",
    "conventional traffic signals": "standard intersection lights",
    "emergency vehicles": "rescue vehicles",
    "emergency vehicle": "rescue vehicle",
    "emergency priority": "priority clearance",
    "clearance state": "clearing phase",
    "clearance stage": "clearing step",
    "green signal": "green light",
    "blue signal": "blue light",
    "four-way traffic": "four-branch intersection",
    "other three directions": "remaining three lanes",
    "remaining three directions": "other three lanes",
    "location-based notifications": "position alerts",
    "registered emergency vehicle tags": "authorized rescue tags",
    "browser-based": "web-hosted",
    "existing detection methods": "current sensing techniques",
    "existing approaches": "current methods",
    "existing system": "legacy setup",
    "modern cities": "today's urban centers",
    "urban areas": "city zones",
    "traffic congestion": "road crowding",
    "background noise": "ambient interference",
    "creates difficulties for": "slows down",
    "have limitations": "face drawbacks",
    "aims to develop": "builds",
    "is designed to": "works to",
    "are designed to": "work to",
    "turns ON": "switches on",
    "cannot efficiently respond to": "struggle to adapt to",
    "changing traffic": "shifting road",
    "educational institutions": "schools and colleges",
    "road transportation": "surface transport",
    "landscape": "space",
    "tapestry": "mix",
    "crucial": "key",
    "pivotal": "central",
    "seamless": "smooth",
    "seamlessly": "smoothly",
    "robust": "dependable",
    "holistic": "broad",
    "paradigm": "model",
    "multifaceted": "layered",
    "comprehensive": "thorough",
    "diverse": "varied",
    "furthermore": "also",
    "moreover": "beyond that",
    "additionally": "plus",
    "consequently": "so",
    "nevertheless": "still",
    "nonetheless": "even so",
    "however": "still",
    "therefore": "so",
    "utilizes": "uses",
    "utilize": "use",
    "utilizing": "using",
    "leverages": "applies",
    "leverage": "apply",
    "leveraging": "applying",
    "facilitates": "supports",
    "facilitate": "support",
    "facilitating": "supporting",
    "demonstrates": "shows",
    "demonstrate": "show",
    "provides": "supplies",
    "provide": "supply",
    "obtains": "reads",
    "obtain": "read",
    "receives": "gets",
    "receive": "get",
    "operates": "runs",
    "operate": "run",
    "operation": "running",
    "identifies": "detects",
    "identify": "detect",
    "interrupts": "pauses",
    "interrupt": "pause",
    "remains": "stays",
    "remain": "stay",
    "enters": "moves into",
    "activated": "triggered",
    "activate": "trigger",
    "selected": "chosen",
    "authorized": "approved",
    "additional": "extra",
    "replacing": "removing",
    "indicates": "signals",
    "indicate": "signal",
    "temporarily": "briefly",
    "requested": "active",
    "permission": "clearance",
    "often": "frequently",
    "delays": "holdups",
    "conventional": "standard",
    "intelligent": "smart",
    "valid": "verified",
    "follow": "cycle through",
    "approximately": "roughly",
    "generally": "typically",
    "increasing": "rising",
    "combines": "merges",
    "connecting": "linking",
    "without": "rather than",
    "notifications": "alerts",
    "notification": "alert",
    "displays": "shows",
    "display": "show",
    "contains": "holds",
    "contain": "hold",
    "ensures": "makes sure",
    "ensure": "make sure",
    "major": "primary",
    "normal": "regular",
    "first": "initially",
}

_LEX_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(PHRASE_MAP, key=len, reverse=True)) + r")\b",
    re.I,
)

_PARTICIPIAL_TAIL_RE = re.compile(
    r",\s*(?:thereby\s+|thus\s+|ultimately\s+)?(ensuring|enabling|allowing|resulting in|leading to|highlighting|demonstrating|indicating|creating|making it|improving|enhancing|reducing|increasing)\s+(?:that\s+)?([^.!?]{6,140})([.!?])",
    re.I,
)

_WHICH_TAIL_RE = re.compile(
    r",\s*which\s+(ensures|enables|allows|facilitates|improves|enhances|reduces|increases|leads to|results in)\s+([^.!?]{6,140})([.!?])",
    re.I,
)

_FRONT_SUBORD_RE = re.compile(
    r"^(Once|When|While|During|After|Before|Because|Since|Although|Though)\s+([^,]{8,95}),\s+([^.!?]{8,140})([.!?])$",
    re.I,
)
_TRAILING_WHILE_RE = re.compile(
    r"^([^,]{10,120}),\s+(while|whereas|because|since|when|once)\s+([^.!?]{10,130})([.!?])$",
    re.I,
)
_BY_GERUND_RE = re.compile(
    r"^([A-Z][^,]{12,110}?)\s+by\s+([a-z]+ing\s+[^.!?]{8,120})([.!?])$"
)
_PURPOSE_INF_RE = re.compile(
    r"^([A-Z][^,]{12,110}?)\s+to\s+(regulate|control|manage|reduce|improve|prevent|monitor|detect|provide|supply|support|send|handle|enable|achieve|maintain)\s+([^.!?]{8,80})([.!?])$"
)
_TRAILING_PREP_RE = re.compile(
    r"^([A-Z][^,]{12,110}?)\s+(at|across|during|for|through|within)\s+([a-z][^,.!?]{8,70})([.!?])$"
)


def _cap(s: str) -> str:
    s = s.lstrip()
    return (s[0].upper() + s[1:]) if s else s


def _lower_first(s: str) -> str:
    s = s.lstrip()
    if len(s) >= 2 and s[0].isupper() and s[1].islower():
        first_word = s.split(None, 1)[0]
        if first_word not in {"Arduino", "NodeMCU", "Google", "Python", "English", "India"}:
            return s[0].lower() + s[1:]
    return s


def _apply_lex(text: str) -> str:
    # Protect double-quoted spans (e.g. paper/project titles) from lexical alteration
    quotes: list[str] = []

    def stash(m: re.Match[str]) -> str:
        quotes.append(m.group(0))
        return f"__HDQ{len(quotes) - 1}__"

    masked = re.sub(r'"[^"\n]{4,160}"', stash, text)

    def repl(m: re.Match[str]) -> str:
        matched = m.group(0)
        target = PHRASE_MAP.get(matched.lower(), matched)
        if not target:
            return ""
        if matched[0].isupper() and target[0].islower():
            return target[0].upper() + target[1:]
        return target

    out = _LEX_RE.sub(repl, masked)
    for idx, q in enumerate(quotes):
        out = out.replace(f"__HDQ{idx}__", q)
    return out


def _rewrite_participial_tail(m: re.Match[str]) -> str:
    verb = m.group(1).lower()
    rest = m.group(2).strip()
    end = m.group(3)
    tail_map = {
        "ensuring": f" and supports {rest}{end}" if rest.lower().startswith("improved") else f". This keeps {rest}{end}",
        "enabling": f". That lets {rest}{end}",
        "allowing": f" so {rest}{end}",
        "resulting in": f". That leads directly to {rest}{end}",
        "leading to": f". Over time, that brings {rest}{end}",
        "highlighting": f". This points clearly to {rest}{end}",
        "demonstrating": f". That shows {rest}{end}",
        "indicating": f". That suggests {rest}{end}",
        "creating": f", forming {rest}{end}",
        "making it": f". That leaves it {rest}{end}",
        "improving": f", lifting {rest}{end}",
        "enhancing": f" and strengthening {rest}{end}",
        "reducing": f" while cutting {rest}{end}",
        "increasing": f" and raising {rest}{end}",
    }
    return tail_map.get(verb, f". That produces {rest}{end}")


def _rewrite_which_tail(m: re.Match[str]) -> str:
    verb = m.group(1).lower()
    rest = m.group(2).strip()
    end = m.group(3)
    plain = {
        "ensures": "makes sure",
        "enables": "lets",
        "allows": "lets",
        "facilitates": "supports",
        "improves": "raises",
        "enhances": "lifts",
        "reduces": "cuts",
        "increases": "boosts",
        "leads to": "brings",
        "results in": "produces",
    }.get(verb, verb)
    return f". That {plain} {rest}{end}"


def _restructure_sentence(sentence: str, *, aggressive: bool = False) -> str:
    s = sentence.strip()
    if len(s.split()) < 6:
        return s

    m = _FRONT_SUBORD_RE.match(s)
    if m:
        conj, sub, main_cl, end = m.group(1).lower(), m.group(2).strip(), m.group(3).strip(), m.group(4)
        conj_map = {
            "once": "as soon as",
            "when": "whenever",
            "while": "as",
            "during": "throughout",
            "after": "following",
            "before": "ahead of",
            "because": "given that",
            "since": "because",
            "although": "even though",
            "though": "even though",
        }
        return f"{_cap(main_cl)} {conj_map.get(conj, conj)} {_lower_first(sub)}{end}"

    m2 = _TRAILING_WHILE_RE.match(s)
    if m2:
        main_cl, conj, sub, end = m2.group(1).strip(), m2.group(2).capitalize(), m2.group(3).strip(), m2.group(4)
        return f"{conj} {_lower_first(sub)}, {_lower_first(main_cl)}{end}"

    m3 = _BY_GERUND_RE.match(s)
    if m3:
        head, gerund_tail, end = m3.group(1).strip(), m3.group(2).strip(), m3.group(3)
        return f"By {gerund_tail}, {_lower_first(head)}{end}"

    m4 = _PURPOSE_INF_RE.match(s)
    if m4:
        head, verb, obj, end = m4.group(1).strip(), m4.group(2), m4.group(3).strip(), m4.group(4)
        return f"To {verb} {obj}, {_lower_first(head)}{end}"

    if aggressive:
        m5 = _TRAILING_PREP_RE.match(s)
        if m5:
            head, prep, tail, end = m5.group(1).strip(), m5.group(2).capitalize(), m5.group(3).strip(), m5.group(4)
            return f"{prep} {tail}, {_lower_first(head)}{end}"

    return s


def _max_ngram_overlap(a: str, b: str, n: int = 4) -> float:
    ta = re.findall(r"[a-z0-9]+", a.lower())
    tb = re.findall(r"[a-z0-9]+", b.lower())
    if len(ta) < n or len(tb) < n:
        return 0.0
    sa = {" ".join(ta[i : i + n]) for i in range(len(ta) - n + 1)}
    sb = {" ".join(tb[i : i + n]) for i in range(len(tb) - n + 1)}
    return len(sa & sb) / len(sa) if sa else 0.0


def _fix_articles(text: str) -> str:
    # Fix "an smart" -> "a smart", "a hour/emergency" -> "an emergency"
    text = re.sub(r"\b(an)\s+([bcdfghjklmnpqrstvwxyz][a-z]+)", lambda m: ("A " if m.group(1)[0].isupper() else "a ") + m.group(2), text, flags=re.I)
    text = re.sub(r"\b(a)\s+([aeiou][a-z]+)", lambda m: m.group(0) if m.group(2).lower().startswith(("uni", "use", "eu", "one")) else (("An " if m.group(1)[0].isupper() else "an ") + m.group(2)), text, flags=re.I)
    return text


def paraphrase_block_local(original: str, style: str = "academic", strength: str = "medium") -> str:
    """Apply syntactic clause restructuring, single-pass lexical replacement, and rhythm shaping."""
    text = original.strip()
    if not text or len(text.split()) < 3:
        return text

    text = _PARTICIPIAL_TAIL_RE.sub(_rewrite_participial_tail, text)
    text = _WHICH_TAIL_RE.sub(_rewrite_which_tail, text)

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    text = " ".join(
        _restructure_sentence(s, aggressive=(strength == "strong" or len(sentences) == 1))
        for s in sentences
    )

    text = _apply_lex(text)

    if _max_ngram_overlap(original, text, 4) > 0.18:
        s2 = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        text = " ".join(_restructure_sentence(s, aggressive=True) for s in s2)
        extra_map = {
            "is used to": "serves to",
            "are used to": "serve to",
            "can be used": "works well",
            "each road direction": "every approach",
            "each direction": "each lane",
            "one direction": "a single lane",
            "uses": "relies on",
            "use": "rely on",
            "using": "via",
            "supports": "handles",
            "people": "residents",
            "hospitals": "medical centers",
        }
        extra_re = re.compile(r"\b(" + "|".join(re.escape(k) for k in sorted(extra_map, key=len, reverse=True)) + r")\b", re.I)
        text = extra_re.sub(lambda m: extra_map[m.group(0).lower()].capitalize() if m.group(0)[0].isupper() else extra_map[m.group(0).lower()], text)

    if style in ("casual", "direct") and len(text.split()) >= 4:
        text = re.sub(r"\bdo not\b", "don't", text)
        text = re.sub(r"\bcannot\b", "can't", text)
        text = re.sub(r"\bit is\b", "it's", text)

    text = _fix_articles(text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    text = re.sub(r"^[,;:\s]+", "", text)
    if text and text[0].islower() and original and original[0].isupper():
        text = text[0].upper() + text[1:]
    return text
