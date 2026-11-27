"""Syntactic + single-pass lexical + n-gram-breaking local paraphrasing engine.

Breaks consecutive 4-gram / 5-gram plagiarism shingles and flat LLM cadence
without cascading replacements, while preserving numbers, acronyms, citations,
URLs, quoted titles, code snippets, and proper nouns.
"""
from __future__ import annotations

import hashlib
import re

# Single-pass longest-phrase-first map (no chained re-substitution bugs)
PHRASE_MAP: dict[str, str] = {
    # AI boilerplate & common academic openers
    "in today's fast-paced digital landscape": "in modern connected practice",
    "in today's fast-paced digital world": "in modern connected practice",
    "in todays fast-paced digital landscape": "in modern connected practice",
    "in todays fast-paced digital world": "in modern connected practice",
    "in today's fast-paced world": "in modern life",
    "in todays fast-paced world": "in modern life",
    "the main aim of this project is to design and develop": "this work focuses on building",
    "the main aim of this project is to": "this work sets out to",
    "the main objective of this project is to": "this work seeks to",
    "the main purpose of this project is to": "this work aims to",
    "the primary objective of this study is to": "this study focuses on",
    "the main aim of this study is to": "this study sets out to",
    "plays an important role in": "is central to",
    "plays a crucial role in": "heavily shapes",
    "plays a pivotal role in": "drives",
    "plays a vital role in": "underpins",
    "plays a key role in": "anchors",
    "it is important to note that": "",
    "it is worth noting that": "",
    "it is worth mentioning that": "",
    "it should be noted that": "",
    "it is essential that": "it matters that",
    "due to the fact that": "because",
    "at this point in time": "now",
    "at the present moment": "now",
    "as a matter of fact": "in reality",
    "in the event that": "if",
    "for the purpose of": "for",
    "in accordance with": "under",
    "in close proximity to": "near",
    "on a daily basis": "daily",
    "with respect to": "regarding",
    "with regard to": "concerning",
    "in connection with": "tied to",
    "there is a need for": "modern environments require",
    "are explained below": "are outlined next",
    "is explained below": "is outlined next",
    "are discussed below": "follow next",
    "as illustrated in": "as shown in",
    "as shown in": "depicted in",
    "during execution": "at runtime",
    "literature survey": "prior studies",
    "literature review": "prior work review",
    "related work": "prior studies",
    "system architecture": "platform layout",
    "module description": "component overview",
    "experimental setup": "test bench",
    "conclusion and future scope": "summary and next steps",
    "future enhancement": "upcoming upgrades",
    "functional requirements": "core capabilities",
    "non-functional requirements": "quality constraints",
    "limitations of the existing": "drawbacks in the current",
    "provides an efficient solution": "delivers a practical fix",
    "in recent years": "lately",
    "the results indicate that": "test outputs show that",
    "the experimental results show that": "our trials confirm that",
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
    "wide variety of": "broad mix of",
    "large number of": "many",
    "significant number of": "many",
    "substantial amount of": "large share of",
    "significant improvement": "clear gain",
    "significant improvements": "clear gains",
    "the use of": "employing",
    "an additional feature of": "another capability in",
    "additional feature of": "extra capability in",
    "is designed and developed": "is built",
    "design and develop": "build",
    "designed and developed": "built",
    # Technical / Academic / IoT / Systems phrases
    "the proposed system": "our design",
    "proposed system": "new design",
    "the proposed project": "this work",
    "proposed project": "developed work",
    "the existing system": "the legacy setup",
    "existing system": "legacy setup",
    "existing detection methods": "current sensing techniques",
    "existing approaches": "current methods",
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
    "four-way junction": "four-branch intersection",
    "other three directions": "remaining three lanes",
    "remaining three directions": "other three lanes",
    "location-based notifications": "position alerts",
    "registered emergency vehicle tags": "authorized rescue tags",
    "browser-based": "web-hosted",
    "modern cities": "today's urban centers",
    "modern healthcare systems": "current healthcare platforms",
    "urban areas": "city zones",
    "traffic congestion": "road crowding",
    "background noise": "ambient interference",
    "background traffic noise": "ambient street noise",
    "environmental conditions": "surrounding factors",
    "detection accuracy": "sensing precision",
    "network connectivity": "link availability",
    "creates difficulties for": "slows down",
    "have limitations": "face drawbacks",
    "has limitations": "faces drawbacks",
    "aims to develop": "builds",
    "is designed to": "works to",
    "are designed to": "work to",
    "is used to": "serves to",
    "are used to": "serve to",
    "can be used to": "helps",
    "turns on": "switches on",
    "cannot efficiently respond to": "struggle to adapt to",
    "changing traffic": "shifting road",
    "educational institutions": "schools and colleges",
    "road transportation": "surface transport",
    "exchange information": "share data",
    "direction information": "heading details",
    "relevant information": "key details",
    "operating mode": "active state",
    "may not provide": "often fails to give",
    "may cause": "can trigger",
    "may affect": "can impact",
    "may change": "can shift",
    "may depend on": "often relies on",
    # Single-word high-frequency formal/AI terms
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
    "utilization": "usage",
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
    "incorrect": "erroneous",
    "reliable": "dependable",
    "dependable": "consistent",
    "accurate": "precise",
    "accuracy": "precision",
    "efficient": "effective",
    "efficiently": "effectively",
    "multiple": "several",
    "various": "several",
    "different": "distinct",
    "specific": "particular",
    "particular": "certain",
    "required": "needed",
    "necessary": "needed",
    "essential": "vital",
    "significant": "notable",
    "significantly": "notably",
    "subsequently": "later",
    "currently": "presently",
    "primarily": "mainly",
    "especially": "notably",
    "specifically": "in particular",
    "automatically": "on its own",
    "continuously": "constantly",
    "immediately": "right away",
    "monitoring": "tracking",
    "monitor": "track",
    "transmits": "sends",
    "transmit": "send",
    "transmitting": "sending",
    "determines": "finds",
    "determine": "find",
    "calculates": "computes",
    "calculate": "compute",
    "establishes": "sets up",
    "establish": "set up",
    "maintains": "keeps",
    "maintain": "keep",
    "implements": "applies",
    "implement": "apply",
    "implementation": "rollout",
    "components": "parts",
    "component": "part",
    "devices": "units",
    "device": "unit",
    "sensors": "detectors",
    "sensor": "detector",
    "conditions": "factors",
    "environment": "setting",
    "distance": "range",
    "sounds": "noises",
    "alone": "by itself",
}

_LEX_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(PHRASE_MAP, key=len, reverse=True)) + r")\b",
    re.I,
)

# Multi-option context-safe swaps for breaking surviving 4-grams
_NGRAM_BREAK_SWAPS: dict[str, tuple[str, ...]] = {
    "system": ("platform", "setup", "framework"),
    "systems": ("platforms", "setups", "frameworks"),
    "vehicle": ("unit", "transport", "carrier"),
    "vehicles": ("units", "transports", "carriers"),
    "traffic": ("road", "street", "flow"),
    "signal": ("light", "beacon", "indicator"),
    "signals": ("lights", "beacons", "indicators"),
    "detection": ("sensing", "recognition", "spotting"),
    "detect": ("sense", "spot", "pick up"),
    "detects": ("senses", "spots", "picks up"),
    "information": ("data", "details", "records"),
    "data": ("details", "readings", "records"),
    "network": ("link", "mesh", "channel"),
    "networks": ("links", "channels", "grids"),
    "communication": ("messaging", "data exchange", "signaling"),
    "hardware": ("circuitry", "equipment", "board"),
    "software": ("firmware", "code", "program"),
    "module": ("unit", "board", "chip"),
    "modules": ("units", "boards", "chips"),
    "controller": ("processor", "control unit", "board"),
    "power": ("voltage", "supply", "energy"),
    "status": ("state", "condition", "mode"),
    "location": ("position", "spot", "coordinates"),
    "direction": ("heading", "lane", "path"),
    "directions": ("headings", "lanes", "paths"),
    "junction": ("crossing", "intersection", "node"),
    "junctions": ("crossings", "intersections", "nodes"),
    "approach": ("method", "technique", "way"),
    "approaches": ("methods", "techniques", "ways"),
    "method": ("technique", "way", "route"),
    "methods": ("techniques", "ways", "routes"),
    "process": ("workflow", "procedure", "cycle"),
    "result": ("outcome", "output", "effect"),
    "results": ("outcomes", "outputs", "findings"),
    "problem": ("issue", "challenge", "bottleneck"),
    "problems": ("issues", "challenges", "gaps"),
    "issue": ("problem", "concern", "gap"),
    "issues": ("problems", "concerns", "gaps"),
    "feature": ("capability", "option", "function"),
    "features": ("capabilities", "options", "functions"),
    "function": ("role", "task", "duty"),
    "functions": ("roles", "tasks", "duties"),
    "design": ("layout", "structure", "blueprint"),
    "project": ("work", "effort", "build"),
    "study": ("work", "analysis", "review"),
    "research": ("investigation", "study", "work"),
    "performance": ("efficiency", "output", "speed"),
    "accuracy": ("precision", "exactness", "correctness"),
    "delay": ("lag", "wait", "holdup"),
    "time": ("period", "interval", "duration"),
    "times": ("periods", "intervals", "cycles"),
    "level": ("tier", "degree", "stage"),
    "levels": ("tiers", "degrees", "stages"),
    "value": ("reading", "figure", "metric"),
    "values": ("readings", "figures", "metrics"),
    "message": ("alert", "notice", "packet"),
    "messages": ("alerts", "notices", "packets"),
    "user": ("operator", "person", "driver"),
    "users": ("operators", "people", "drivers"),
    "driver": ("motorist", "operator", "person"),
    "drivers": ("motorists", "operators", "people"),
    "patient": ("person", "individual", "case"),
    "patients": ("people", "individuals", "cases"),
    "modern": ("current", "present-day", "today's"),
    "important": ("vital", "key", "central"),
    "effective": ("workable", "practical", "solid"),
    "simple": ("basic", "straightforward", "plain"),
    "complex": ("intricate", "involved", "layered"),
    "manual": ("hand-operated", "human-run", "unautomated"),
    "fast": ("quick", "rapid", "swift"),
    "slow": ("sluggish", "gradual", "delayed"),
    "high": ("elevated", "strong", "tall"),
    "low": ("minimal", "reduced", "light"),
    "large": ("big", "wide", "broad"),
    "small": ("compact", "tiny", "minor"),
    "new": ("fresh", "updated", "novel"),
    "old": ("legacy", "earlier", "prior"),
    "other": ("remaining", "extra", "alternate"),
    "different": ("distinct", "separate", "varied"),
    "same": ("identical", "matching", "unchanged"),
    "available": ("ready", "accessible", "present"),
    "possible": ("feasible", "likely", "viable"),
    "real-time": ("live", "instant", "immediate"),
    "based": ("built", "grounded", "centered"),
    "using": ("via", "through", "with"),
    "helps": ("aids", "supports", "assists"),
    "help": ("aid", "support", "assist"),
    "shows": ("presents", "reveals", "outputs"),
    "show": ("present", "reveal", "output"),
    "allows": ("lets", "permits", "enables"),
    "allow": ("let", "permit", "enable"),
    "makes": ("creates", "produces", "turns"),
    "make": ("create", "produce", "turn"),
    "sends": ("forwards", "delivers", "routes"),
    "send": ("forward", "deliver", "route"),
    "gets": ("obtains", "picks up", "captures"),
    "get": ("obtain", "pick up", "capture"),
    "keeps": ("holds", "preserves", "retains"),
    "keep": ("hold", "preserve", "retain"),
    "reduces": ("cuts", "lowers", "shrinks"),
    "reduce": ("cut", "lower", "shrink"),
    "increases": ("raises", "lifts", "grows"),
    "increase": ("raise", "lift", "grow"),
    "improves": ("boosts", "upgrades", "refines"),
    "improve": ("boost", "upgrade", "refine"),
    "requires": ("needs", "calls for", "demands"),
    "require": ("need", "call for", "demand"),
    "includes": ("holds", "packs", "contains"),
    "include": ("hold", "pack", "contain"),
    "provides": ("offers", "gives", "supplies"),
    "provide": ("offer", "give", "supply"),
    "creates": ("forms", "builds", "generates"),
    "create": ("form", "build", "generate"),
    "controls": ("manages", "guides", "directs"),
    "control": ("manage", "guide", "direct"),
    "connects": ("links", "joins", "ties"),
    "connect": ("link", "join", "tie"),
    "works": ("runs", "acts", "functions"),
    "work": ("run", "act", "function"),
    "changes": ("shifts", "alters", "varies"),
    "change": ("shift", "alter", "vary"),
    "handles": ("manages", "processes", "covers"),
    "handle": ("manage", "process", "cover"),
    "checks": ("verifies", "scans", "tests"),
    "check": ("verify", "scan", "test"),
    "stores": ("saves", "logs", "records"),
    "store": ("save", "log", "record"),
    "reads": ("captures", "pulls", "fetches"),
    "read": ("capture", "pull", "fetch"),
    "between": ("among", "across", "linking"),
    "during": ("throughout", "amid", "in"),
    "through": ("via", "across", "by way of"),
    "within": ("inside", "throughout", "in"),
    "without": ("lacking", "free of", "minus"),
    "around": ("near", "about", "roughly"),
    "before": ("ahead of", "prior to", "until"),
    "after": ("following", "once", "past"),
    "because": ("since", "given that", "as"),
    "although": ("even though", "while", "though"),
    "often": ("frequently", "regularly", "commonly"),
    "usually": ("typically", "normally", "mostly"),
    "always": ("consistently", "constantly", "every time"),
    "only": ("solely", "merely", "just"),
    "also": ("too", "as well", "further"),
    "mainly": ("chiefly", "mostly", "largely"),
    "emergency": ("urgent", "rescue", "critical"),
    "priority": ("precedence", "right-of-way", "preemptive"),
    "should": ("must", "needs to", "ought to"),
    "may": ("might", "can", "could"),
    "will": ("shall", "tends to", "is set to"),
    "must": ("needs to", "has to", "ought to"),
    "proposed": ("presented", "designed", "new"),
    "test": ("trial", "check", "verification"),
    "case": ("scenario", "condition", "run"),
    "cases": ("scenarios", "conditions", "runs"),
    "cloud": ("remote", "online", "server"),
    "integration": ("linking", "combining", "coupling"),
    "reader": ("scanner", "detector", "receiver"),
    "readers": ("scanners", "detectors", "receivers"),
    "card": ("tag", "badge", "token"),
    "cards": ("tags", "badges", "tokens"),
    "programmed": ("configured", "coded", "set up"),
    "fixed": ("static", "preset", "constant"),
    "timing": ("schedule", "interval", "pacing"),
    "identification": ("recognition", "verification", "lookup"),
    "registered": ("enrolled", "listed", "approved"),
    "connected": ("linked", "wired", "joined"),
    "sending": ("transmitting", "pushing", "delivering"),
    "receiving": ("getting", "capturing", "reading"),
    "activated": ("triggered", "engaged", "switched on"),
    "cleared": ("completed", "finished", "passed"),
    "normal": ("regular", "standard", "routine"),
    "expected": ("anticipated", "intended", "target"),
    "actual": ("observed", "measured", "real"),
    "passed": ("succeeded", "cleared", "verified"),
    "successfully": ("cleanly", "properly", "as intended"),
    "illustrated": ("shown", "depicted", "presented"),
    "verified": ("confirmed", "checked", "validated"),
    "execution": ("runtime", "operation", "testing"),
    "clearance": ("clearing", "release", "transition"),
}

_PARTICIPIAL_TAIL_RE = re.compile(
    r",\s*(?:thereby\s+|thus\s+|ultimately\s+)?(ensuring|enabling|allowing|resulting in|leading to|highlighting|demonstrating|indicating|creating|making it|improving|enhancing|reducing|increasing)\s+(?:that\s+)?([^.!?]{6,140})([.!?])",
    re.I,
)

_WHICH_TAIL_RE = re.compile(
    r",\s*which\s+(ensures|enables|allows|facilitates|improves|enhances|reduces|increases|leads to|results in)\s+([^.!?]{6,140})([.!?])",
    re.I,
)

_FRONT_SUBORD_RE = re.compile(
    r"^(Once|When|While|During|After|Before|Because|Since|Although|Though|If|Unless)\s+([^,]{8,95}),\s+([^.!?]{8,140})([.!?])$",
    re.I,
)
_TRAILING_WHILE_RE = re.compile(
    r"^([^,]{10,120}),\s+(while|whereas|because|since|when|once|although|so)\s+([^.!?]{10,130})([.!?])$",
    re.I,
)
_BY_GERUND_RE = re.compile(
    r"^([A-Z][^,]{12,110}?)\s+by\s+([a-z]+ing\s+[^.!?]{8,120})([.!?])$"
)
_PURPOSE_INF_RE = re.compile(
    r"^([A-Z][^,]{12,110}?)\s+to\s+(regulate|control|manage|reduce|improve|prevent|monitor|detect|provide|supply|support|send|handle|enable|achieve|maintain|display|show|exchange|track|ensure|avoid|minimize|maximize)\s+([^.!?]{8,90})([.!?])$"
)
_TRAILING_PREP_RE = re.compile(
    r"^([A-Z][^,]{10,110}?)\s+(at|across|during|for|through|within|with|under|between|in)\s+([a-z0-9][^,.!?]{6,80})([.!?])$"
)
_COMPOUND_AND_RE = re.compile(
    r"^([^,]{15,110}),\s+and\s+([^.!?]{15,110})([.!?])$"
)
_LIST_THREE_RE = re.compile(
    r"\b([a-z0-9-]+),\s+([a-z0-9-]+),\s+and\s+([a-z0-9-]+)\b"
)

_PROPER_KEEP = {
    "Arduino", "NodeMCU", "Google", "Python", "English", "India", "Bengaluru",
    "Bluetooth", "Wi-Fi", "WiFi", "GPS", "GSM", "RFID", "LCD", "LED", "IoT",
    "UDP", "TCP", "HTTP", "API", "USB", "UART", "SPI", "I2C", "PWM",
}


def _looks_like_code(text: str) -> bool:
    if any(tok in text for tok in ("#include", "void ", "Serial.", "digitalWrite", "pinMode", "delay(", "int ", "const ", "return ")):
        return True
    if text.count(";") >= 2 or ("{" in text and "}" in text):
        return True
    return False


def _cap(s: str) -> str:
    s = s.lstrip()
    return (s[0].upper() + s[1:]) if s else s


def _lower_first(s: str) -> str:
    s = s.lstrip()
    if len(s) >= 2 and s[0].isupper() and s[1].islower():
        first_word = s.split(None, 1)[0].rstrip(",;:")
        if first_word not in _PROPER_KEEP:
            return s[0].lower() + s[1:]
    return s


def _mask_protected(text: str) -> tuple[str, list[str]]:
    """Mask quoted titles, URLs, emails, and numeric citations so they stay byte-identical."""
    stashed: list[str] = []

    def stash(m: re.Match[str]) -> str:
        stashed.append(m.group(0))
        return f"__HDQ{len(stashed) - 1}__"

    masked = re.sub(r'"[^"\n]{4,180}"|https?://\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\[\d+(?:,\s*\d+)*\]', stash, text)
    return masked, stashed


def _unmask_protected(text: str, stashed: list[str]) -> str:
    for idx, q in enumerate(stashed):
        text = text.replace(f"__HDQ{idx}__", q)
    return text


_ACRONYM_SKIP = {
    "ON", "OFF", "IN", "TO", "OF", "IS", "AS", "BY", "OR", "AN", "AT", "IT", "BE",
    "NO", "SO", "UP", "IF", "DO", "GO", "WE", "HE", "ME", "MY", "US", "THE", "AND",
    "FOR", "NOT", "ARE", "BUT", "ALL", "CAN", "HAS", "HAD", "WAS", "ONE", "OUR", "OUT",
    "USE", "NEW", "NOW", "WAY", "MAY", "OWN", "SEE", "TWO", "ANY", "ITS", "SET", "END",
}


def _apply_lex(text: str) -> str:
    masked, stashed = _mask_protected(text)

    def repl(m: re.Match[str]) -> str:
        matched = m.group(0)
        if matched.isupper() and len(matched) >= 2 and matched not in _ACRONYM_SKIP:
            return matched
        target = PHRASE_MAP.get(matched.lower(), matched)
        if not target:
            return ""
        if matched[0].isupper() and target[0].islower():
            return target[0].upper() + target[1:]
        return target

    out = _LEX_RE.sub(repl, masked)
    return _unmask_protected(out, stashed)


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
    if len(s.split()) < 5:
        return s

    # Rotate 3-item lowercase lists (breaks 4-grams in enumerations)
    s = _LIST_THREE_RE.sub(r"\3, \1, and \2", s)

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
            "if": "provided that",
            "unless": "except when",
        }
        return f"{_cap(main_cl)} {conj_map.get(conj, conj)} {_lower_first(sub)}{end}"

    m2 = _TRAILING_WHILE_RE.match(s)
    if m2:
        main_cl, conj, sub, end = m2.group(1).strip(), m2.group(2).capitalize(), m2.group(3).strip(), m2.group(4)
        if conj.lower() == "so":
            return f"Because {_lower_first(main_cl)}, {_lower_first(sub)}{end}"
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
        mc = _COMPOUND_AND_RE.match(s)
        if mc:
            left, right, end = mc.group(1).strip(), mc.group(2).strip(), mc.group(3)
            return f"{_cap(left)}. In turn, {_lower_first(right)}{end}"

        m5 = _TRAILING_PREP_RE.match(s)
        if m5 and not s.lower().startswith("to "):
            head, prep, tail, end = m5.group(1).strip(), m5.group(2).capitalize(), m5.group(3).strip(), m5.group(4)
            return f"{prep} {tail}, {_lower_first(head)}{end}"

    return s


def _ngrams_list(text: str, n: int = 4) -> list[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return [" ".join(tokens[i : i + n]) for i in range(max(0, len(tokens) - n + 1))]


def _max_ngram_overlap(a: str, b: str, n: int = 4) -> float:
    sa = set(_ngrams_list(a, n))
    sb = set(_ngrams_list(b, n))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa)


def _break_surviving_ngrams(original: str, rewritten: str) -> str:
    """Break any surviving 4-gram from `original` by substituting safe content words."""
    orig_4 = set(_ngrams_list(original, 4))
    if not orig_4:
        return rewritten

    masked, stashed = _mask_protected(rewritten)
    seed_base = int(hashlib.md5(original.encode("utf-8", "ignore")).hexdigest()[:8], 16)

    # Up to 3 passes to break overlapping 4-gram chains
    for pass_idx in range(3):
        cur_4 = set(_ngrams_list(masked, 4))
        surviving = orig_4 & cur_4
        if not surviving:
            break

        # Collect candidate words from surviving 4-grams that exist in _NGRAM_BREAK_SWAPS
        target_words: set[str] = set()
        for ng in surviving:
            for w in ng.split():
                if w in _NGRAM_BREAK_SWAPS:
                    target_words.add(w)
        if not target_words:
            break

        # Replace every other matching word in surviving 4-grams to avoid over-editing
        replaced_any = False
        tokens = re.split(r"(\b[A-Za-z][A-Za-z0-9-]*\b)", masked)
        for i, tok in enumerate(tokens):
            low = tok.lower()
            if low in target_words and not tok.isupper() and not tok.startswith("__HDQ"):
                # Avoid replacing noun "use" after "the/a/its/their"
                prev_tok = tokens[i - 2].lower() if i >= 2 else ""
                if low == "use" and prev_tok in ("the", "a", "an", "its", "their", "this"):
                    continue
                opts = _NGRAM_BREAK_SWAPS[low]
                choice = opts[(seed_base + pass_idx + i) % len(opts)]
                if tok[0].isupper() and choice[0].islower():
                    choice = choice[0].upper() + choice[1:]
                tokens[i] = choice
                replaced_any = True
                # Refresh target check: break out early if we've swapped enough
                if pass_idx == 0 and i % 3 == 0:
                    continue
        if not replaced_any:
            break
        masked = "".join(tokens)

    return _unmask_protected(masked, stashed)


def _fix_articles(text: str) -> str:
    text = re.sub(
        r"\b(an)\s+([bcdfghjklmnpqrstvwxyz][a-z]+)",
        lambda m: ("A " if m.group(1)[0].isupper() else "a ") + m.group(2),
        text,
        flags=re.I,
    )
    text = re.sub(
        r"\b(a)\s+([aeiou][a-z]+)",
        lambda m: m.group(0)
        if m.group(2).lower().startswith(("uni", "use", "eu", "one"))
        else (("An " if m.group(1)[0].isupper() else "an ") + m.group(2)),
        text,
        flags=re.I,
    )
    return text


def paraphrase_block_local(original: str, style: str = "academic", strength: str = "medium") -> str:
    """Apply syntactic clause restructuring, single-pass lexical replacement, and n-gram breaking."""
    text = original.strip()
    if not text or len(text.split()) < 3 or _looks_like_code(text):
        return text

    if " | " in text:
        cells = [paraphrase_block_local(cell, style=style, strength=strength) for cell in text.split(" | ")]
        return " | ".join(cells)

    text = _PARTICIPIAL_TAIL_RE.sub(_rewrite_participial_tail, text)
    text = _WHICH_TAIL_RE.sub(_rewrite_which_tail, text)

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    text = " ".join(
        _restructure_sentence(s, aggressive=(strength in ("strong", "heavy") or len(sentences) <= 2))
        for s in sentences
    )

    text = _apply_lex(text)

    if strength in ("medium", "strong", "heavy") and _max_ngram_overlap(original, text, 4) > 0.0:
        s2 = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        text = " ".join(_restructure_sentence(s, aggressive=True) for s in s2)
        text = _break_surviving_ngrams(original, text)

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
