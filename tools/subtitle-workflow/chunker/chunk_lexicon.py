import re
from typing import Dict, List, Tuple


def normalize_token(token: str) -> str:
    if token is None:
        return ""
    token = str(token).strip().lower()
    token = token.replace("’", "'")
    # keep internal apostrophes, strip outer punctuation
    token = re.sub(r"^[\s\"'“”‘’\(\[\{,;:!?]+", "", token)
    token = re.sub(r"[\s\"'“”‘’\)\]\},;:!?]+$", "", token)
    return token


def normalize_tokens(tokens: List[str]) -> List[str]:
    return [normalize_token(t) for t in tokens]


ABBREVIATIONS = {
    "u.s.", "u.k.", "e.u.", "u.n.", "mr.", "mrs.", "ms.", "dr.", "prof.",
    "jr.", "sr.", "st.", "vs.", "etc.", "p.m.", "a.m.",
}

DETERMINERS = {
    "a", "an", "the", "this", "that", "these", "those",
    "some", "any", "each", "every", "either", "neither",
}

POSSESSIVES = {
    "my", "your", "his", "her", "its", "our", "their",
}

PREPOSITIONS = {
    "in", "on", "at", "for", "with", "from", "to", "of", "by", "about",
    "into", "over", "after", "before", "under", "through", "around",
    "between", "without", "within", "against", "during", "across",
    "behind", "beyond", "toward", "towards", "near",
}

SUBORDINATORS = {
    "as", "if", "when", "while", "because", "since", "although", "though",
    "once", "unless", "after", "before",
}

TEMPORAL_START_WORDS = {
    "today", "tonight", "yesterday", "tomorrow",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "morning", "afternoon", "evening", "night",
    "week", "month", "year",
}

COMPARATIVE_START_WORDS = {"more", "less", "than"}
DEGREE_MODIFIERS = {"too", "very", "more", "less", "most", "almost", "nearly"}

BROADCAST_FLOW_WORDS = {
    "live", "reporter", "cross", "crossing", "joining", "join", "joined",
    "more", "now", "let's", "lets", "from", "to",
}

STANDALONE_SHORT_FORMS = {
    "yes", "no", "okay", "ok", "hello", "hi", "thanks", "thank", "stop", "run",
}

DISCOURSE_PREFIX_WORDS = {
    "well", "look", "listen", "now", "right", "okay", "ok", "so", "hey", "yeah",
}

SHORT_BRIDGE_WORDS = {
    "and", "but", "so", "then", "now", "well", "or", "yet",
    "if", "when", "while", "because", "though", "although",
}

VOCATIVE_WORDS = {
    "mate", "sir", "madam", "guys", "folks", "friends", "everyone", "team",
}

AUXILIARIES = {
    "am", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did",
    "have", "has", "had",
    "i'm", "you're", "he's", "she's", "it's", "we're", "they're",
    "that's", "there's", "what's", "who's", "here's",
    "i've", "you've", "we've", "they've",
}

MODALS = {
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "i'll", "you'll", "he'll", "she'll", "we'll", "they'll",
}

NEGATIONS = {"not", "n't", "never", "no"}

PRONOUNS = {
    "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them",
    "this", "that", "these", "those",
    "there",
}

NUMBER_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
    "billion", "first", "second", "third",
}

UNIT_WORDS = {
    "%", "percent", "percentage",
    "mg", "g", "kg", "lb", "lbs", "oz",
    "ml", "l", "liter", "liters", "litre", "litres",
    "cm", "mm", "m", "km", "meter", "meters", "metre", "metres",
    "mile", "miles", "foot", "feet", "inch", "inches",
    "hour", "hours", "minute", "minutes", "second", "seconds",
    "day", "days", "week", "weeks", "month", "months", "year", "years",
    "degree", "degrees",
}

PROPER_NAME_CONNECTORS = {
    "of", "and", "the", "&",
}

PARTICLES = {
    "up", "off", "out", "back", "down", "on", "away", "around",
    "over", "through", "in",
}

WH_WORDS = {"what", "why", "how", "where", "when", "who", "which"}

WEAK_EDGE_WORDS = {
    "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "from",
    "and", "or", "but", "than", "as", "if", "that",
    "my", "your", "his", "her", "its", "our", "their",
    "i'm", "you're", "he's", "she's", "it's", "we're", "they're",
    "that's", "there's", "what's", "who's", "here's",
    "i've", "you've", "we've", "they've",
    "i'll", "you'll", "he'll", "she'll", "we'll", "they'll",
}

SHORT_CHUNK_STARTERS = (
    DETERMINERS
    | POSSESSIVES
    | AUXILIARIES
    | MODALS
    | PRONOUNS
    | WH_WORDS
)

WEAK_TAIL_WORDS = (
    WEAK_EDGE_WORDS
    | DETERMINERS
    | POSSESSIVES
    | PREPOSITIONS
    | AUXILIARIES
    | MODALS
    | DEGREE_MODIFIERS
)

DEPENDENT_START_WORDS = (
    PREPOSITIONS
    | SUBORDINATORS
    | AUXILIARIES
    | MODALS
    | TEMPORAL_START_WORDS
    | COMPARATIVE_START_WORDS
)

FIXED_PHRASES: List[Tuple[str, ...]] = [
    ("a", "lot", "of"),
    ("a", "bunch", "of"),
    ("a", "couple", "of"),
    ("a", "little", "bit", "of"),
    ("one", "of", "the"),
    ("some", "of", "the"),
    ("most", "of", "the"),
    ("at", "least"),
    ("of", "course"),
    ("in", "fact"),
    ("by", "the", "way"),
    ("on", "the", "other", "hand"),
    ("for", "example"),
    ("you", "know"),
    ("i", "mean"),
    ("i", "guess"),
    ("i", "think"),
    ("i", "feel", "like"),
    ("sort", "of"),
    ("kind", "of"),
    ("all", "of", "a", "sudden"),
    ("at", "the", "same", "time"),
    ("as", "soon", "as"),
    ("even", "though"),
    ("so", "that"),
    ("in", "order", "to"),
    ("the", "rest", "of", "the"),
    ("at", "the", "end", "of"),
    ("at", "the", "end", "of", "the", "day"),
    ("from", "that", "point", "on"),
]

TO_STRUCTURES: List[Tuple[str, ...]] = [
    ("want", "to"),
    ("need", "to"),
    ("have", "to"),
    ("has", "to"),
    ("had", "to"),
    ("got", "to"),
    ("going", "to"),
    ("trying", "to"),
    ("try", "to"),
    ("able", "to"),
    ("supposed", "to"),
    ("used", "to"),
    ("about", "to"),
]

NEGATION_PHRASES: List[Tuple[str, ...]] = [
    ("don't", "know"),
    ("can't", "do"),
    ("isn't", "working"),
    ("wasn't", "sure"),
    ("didn't", "mean", "to"),
    ("not", "really"),
    ("not", "even"),
    ("never", "really"),
]

QUESTION_STARTERS: List[Tuple[str, ...]] = [
    ("what", "are", "you"),
    ("what", "do", "you"),
    ("how", "do", "you"),
    ("why", "would", "you"),
    ("where", "did", "he"),
    ("who", "are", "they"),
    ("do", "you", "think"),
    ("are", "you", "gonna"),
    ("are", "you", "going", "to"),
]

DISCOURSE_MARKERS: List[Tuple[str, ...]] = [
    ("believe", "it", "or", "not"),
    ("to", "be", "honest"),
    ("to", "be", "fair"),
    ("for", "one", "thing"),
    ("in", "other", "words"),
    ("over", "time"),
    ("in", "modern", "times"),
    ("by", "the", "late"),
]

PHRASAL_VERBS: List[Tuple[str, ...]] = [
    ("pick", "up"),
    ("put", "on"),
    ("take", "off"),
    ("find", "out"),
    ("figure", "out"),
    ("turn", "on"),
    ("turn", "off"),
    ("come", "back"),
    ("go", "back"),
    ("sit", "down"),
    ("stand", "up"),
    ("wake", "up"),
    ("get", "up"),
    ("work", "out"),
    ("hang", "out"),
    ("check", "out"),
    ("point", "out"),
    ("carry", "on"),
    ("move", "on"),
    ("end", "up"),
    ("start", "out"),
    ("walk", "in"),
    ("run", "into"),
    ("look", "for"),
    ("look", "at"),
    ("look", "into"),
    ("come", "up", "with"),
    ("pick", "it", "up"),
    ("put", "it", "on"),
    ("take", "it", "off"),
    ("figure", "it", "out"),
    ("check", "it", "out"),
]

FUNCTION_WORD_ATTACHMENTS: List[Tuple[str, str]] = [
    ("of", "the"),
    ("to", "the"),
    ("in", "the"),
    ("on", "the"),
    ("for", "the"),
    ("with", "the"),
    ("at", "the"),
    ("from", "the"),
    ("to", "a"),
    ("for", "a"),
    ("with", "a"),
    ("of", "a"),
    ("in", "a"),
    ("on", "a"),
]


def build_phrase_entries() -> List[Dict]:
    entries: List[Dict] = []

    def add(label: str, phrases: List[Tuple[str, ...]]):
        for tokens in phrases:
            entries.append({
                "label": label,
                "tokens": tuple(normalize_tokens(list(tokens))),
                "text": " ".join(tokens),
            })

    add("fixed_phrase", FIXED_PHRASES)
    add("to_structure", TO_STRUCTURES)
    add("negation_phrase", NEGATION_PHRASES)
    add("question_starter", QUESTION_STARTERS)
    add("discourse_marker", DISCOURSE_MARKERS)
    add("phrasal_verb", PHRASAL_VERBS)

    entries.sort(key=lambda x: len(x["tokens"]), reverse=True)
    return entries


ALL_PHRASE_ENTRIES = build_phrase_entries()
