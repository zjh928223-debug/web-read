from typing import Dict, List, Optional

from chunk_config import ChunkerConfig
from chunk_lexicon import (
    ABBREVIATIONS,
    ALL_PHRASE_ENTRIES,
    AUXILIARIES,
    DETERMINERS,
    FUNCTION_WORD_ATTACHMENTS,
    MODALS,
    NEGATIONS,
    PARTICLES,
    POSSESSIVES,
    PREPOSITIONS,
    PRONOUNS,
    WEAK_EDGE_WORDS,
    WH_WORDS,
    normalize_token,
)


def get_word_text(word: Dict) -> str:
    return (
        word.get("text")
        or word.get("word")
        or word.get("token")
        or word.get("value")
        or ""
    )


def get_word_start(word: Dict) -> Optional[float]:
    return word.get("start")


def get_word_end(word: Dict) -> Optional[float]:
    return word.get("end")


def safe_gap(left_word: Dict, right_word: Dict) -> float:
    left_end = get_word_end(left_word)
    right_start = get_word_start(right_word)
    if left_end is None or right_start is None:
        return 0.0
    return max(0.0, right_start - left_end)


def is_abbreviation(raw_text: str) -> bool:
    raw = str(raw_text).strip().lower()
    return raw in ABBREVIATIONS


def ends_with_terminal_punctuation(raw_text: str) -> bool:
    raw = str(raw_text).strip()
    if not raw:
        return False
    raw_lower = raw.lower()
    if raw_lower in ABBREVIATIONS:
        return False
    return raw.endswith(".") or raw.endswith("?") or raw.endswith("!")


def repair_sentence_boundary_cuts(words: List[Dict], cuts) -> List[int]:
    """Make Gemini cuts respect terminal punctuation without changing word order.

    Gemini sometimes returns a cut after the first word of the next sentence,
    even when it also recognizes the preceding sentence.  The runtime contract
    is that a cut is *after* the numbered word, so every ordinary terminal word
    must be a cut and a redundant cut immediately after it must be removed.
    Abbreviations remain governed by ``ends_with_terminal_punctuation``.
    """
    total_words = len(words)
    valid_cuts = {
        cut
        for cut in cuts
        if isinstance(cut, int)
        and not isinstance(cut, bool)
        and 1 <= cut < total_words
    }
    terminal_cuts = {
        index
        for index, word in enumerate(words, start=1)
        if index < total_words and ends_with_terminal_punctuation(get_word_text(word))
    }

    repaired_cuts = valid_cuts | terminal_cuts
    for terminal_index in terminal_cuts:
        successor = terminal_index + 1
        if successor in repaired_cuts and successor not in terminal_cuts:
            repaired_cuts.remove(successor)

    return sorted(repaired_cuts)


def build_phrase_spans(words: List[Dict]) -> List[Dict]:
    norm_words = [normalize_token(get_word_text(w)) for w in words]
    spans: List[Dict] = []

    for i in range(len(norm_words)):
        for entry in ALL_PHRASE_ENTRIES:
            tokens = entry["tokens"]
            n = len(tokens)
            if i + n > len(norm_words):
                continue
            if tuple(norm_words[i:i+n]) == tokens:
                spans.append({
                    "start": i,
                    "end": i + n - 1,
                    "label": entry["label"],
                    "text": entry["text"],
                })
                break
    return spans


def edge_is_inside_span(edge_index: int, span: Dict) -> bool:
    return span["start"] <= edge_index < span["end"]


def phrase_rules_for_edge(edge_index: int, phrase_spans: List[Dict]) -> List[str]:
    matched = []
    for span in phrase_spans:
        if edge_is_inside_span(edge_index, span):
            matched.append(f'{span["label"]}:{span["text"]}')
    return matched


def classify_gap_score(gap: float, config: ChunkerConfig) -> Dict:
    if gap < config.gap_strong_glue:
        return {"score": config.score_pause_strong_glue, "reason": f"gap<{config.gap_strong_glue}"}
    if gap < config.gap_glue:
        return {"score": config.score_pause_glue, "reason": f"gap<{config.gap_glue}"}
    if gap < config.gap_neutral:
        return {"score": config.score_pause_neutral, "reason": f"gap<{config.gap_neutral}"}
    if gap < config.gap_break:
        return {"score": config.score_pause_break, "reason": f"gap<{config.gap_break}"}
    return {"score": config.score_pause_strong_break, "reason": f"gap>={config.gap_break}"}


def is_function_attachment(left: str, right: str) -> bool:
    return (left, right) in FUNCTION_WORD_ATTACHMENTS


def is_determiner_attachment(left: str, right: str) -> bool:
    return left in DETERMINERS or left in POSSESSIVES


def is_preposition_attachment(left: str, right: str) -> bool:
    return left in PREPOSITIONS and right not in {"", ".", ",", "?", "!"}


def is_subject_aux_attachment(left: str, right: str) -> bool:
    return left in PRONOUNS and (right in AUXILIARIES or right in MODALS)


def is_aux_verb_attachment(left: str, right: str) -> bool:
    if left not in AUXILIARIES and left not in MODALS:
        return False
    if right in {"", ".", ",", "?", "!"}:
        return False
    return True


def is_negation_attachment(left: str, right: str) -> bool:
    if left in NEGATIONS:
        return True
    if right in NEGATIONS:
        return True
    return False


def is_question_opening_attachment(words: List[Dict], edge_index: int) -> bool:
    left = normalize_token(get_word_text(words[edge_index]))
    right = normalize_token(get_word_text(words[edge_index + 1]))

    if edge_index == 0 and left in WH_WORDS:
        return True
    if left in WH_WORDS and right in AUXILIARIES.union(MODALS).union({"do", "does", "did", "are", "is", "was", "were"}):
        return True
    return False


def is_phrasal_particle_attachment(left: str, right: str) -> bool:
    return right in PARTICLES


def boundary_creates_weak_edge(left: str, right: str) -> List[str]:
    reasons = []
    if left in WEAK_EDGE_WORDS:
        reasons.append(f"weak_chunk_end:{left}")
    if right in WEAK_EDGE_WORDS:
        reasons.append(f"weak_chunk_start:{right}")
    return reasons


def score_edge(
    words: List[Dict],
    edge_index: int,
    phrase_spans: List[Dict],
    config: ChunkerConfig,
) -> Dict:
    left_word = words[edge_index]
    right_word = words[edge_index + 1]

    raw_left = get_word_text(left_word)
    raw_right = get_word_text(right_word)

    left = normalize_token(raw_left)
    right = normalize_token(raw_right)

    gap = safe_gap(left_word, right_word)

    score = 0.0
    hard_keep_reasons: List[str] = []
    hard_break_reasons: List[str] = []
    soft_reasons: List[str] = []

    # phrase lexicon protection
    matched_phrase_rules = phrase_rules_for_edge(edge_index, phrase_spans)
    if matched_phrase_rules:
        score += config.score_phrase_keep
        soft_reasons.extend(matched_phrase_rules)

    # abbreviation protection
    if is_abbreviation(str(raw_left).lower()):
        score += config.score_abbreviation_keep
        hard_keep_reasons.append(f"abbreviation:{raw_left}")

    # terminal punctuation break
    if ends_with_terminal_punctuation(raw_left):
        score += config.score_terminal_punct_break
        hard_break_reasons.append(f"terminal_punct:{raw_left}")

    # local structure rules
    if is_function_attachment(left, right):
        score += config.score_function_attachment
        soft_reasons.append(f"function_attachment:{left}_{right}")

    if is_determiner_attachment(left, right):
        score += config.score_structure_keep
        soft_reasons.append(f"determiner_attachment:{left}_{right}")

    if is_preposition_attachment(left, right):
        score += config.score_structure_keep
        soft_reasons.append(f"preposition_attachment:{left}_{right}")

    if is_subject_aux_attachment(left, right):
        score += config.score_structure_keep
        soft_reasons.append(f"subject_aux_attachment:{left}_{right}")

    if is_aux_verb_attachment(left, right):
        score += config.score_structure_keep
        soft_reasons.append(f"aux_verb_attachment:{left}_{right}")

    if is_negation_attachment(left, right):
        score += config.score_structure_keep * 0.8
        soft_reasons.append(f"negation_attachment:{left}_{right}")

    if is_question_opening_attachment(words, edge_index):
        score += config.score_structure_keep
        soft_reasons.append("question_opening_attachment")

    if is_phrasal_particle_attachment(left, right) and left not in PREPOSITIONS:
        score += config.score_structure_keep * 0.8
        soft_reasons.append(f"particle_attachment:{left}_{right}")

    # pause score
    pause_result = classify_gap_score(gap, config)
    score += pause_result["score"]
    soft_reasons.append(f'pause:{pause_result["reason"]}')

    # weak boundary penalty
    weak_edge_reasons = boundary_creates_weak_edge(left, right)
    if weak_edge_reasons:
        score += config.score_weak_boundary_penalty
        soft_reasons.extend(weak_edge_reasons)

    # oversize pressure
    # this is only a mild hint, final split is handled in post-process
    if gap >= config.gap_break and not matched_phrase_rules:
        score += config.score_oversize_pressure
        soft_reasons.append("oversize_pressure_candidate")

    conflict = bool(hard_keep_reasons and hard_break_reasons)
    near_threshold = abs(score - config.break_when_score_below) <= config.low_confidence_margin

    low_confidence = conflict or near_threshold

    applied_rules = hard_keep_reasons + hard_break_reasons + soft_reasons

    return {
        "edge_index": edge_index,
        "left": raw_left,
        "right": raw_right,
        "gap": gap,
        "score": score,
        "hard_keep": bool(hard_keep_reasons),
        "hard_break": bool(hard_break_reasons),
        "hard_keep_reasons": hard_keep_reasons,
        "hard_break_reasons": hard_break_reasons,
        "soft_reasons": soft_reasons,
        "applied_rules": applied_rules,
        "low_confidence": low_confidence,
    }


def should_break_from_decision(decision: Dict, config: ChunkerConfig) -> bool:
    if decision["hard_break"] and not decision["hard_keep"]:
        return True
    if decision["hard_keep"] and not decision["hard_break"]:
        return False
    return decision["score"] < config.break_when_score_below


def chunk_text_starts_weak(words: List[Dict]) -> bool:
    if not words:
        return False
    first = normalize_token(get_word_text(words[0]))
    return first in WEAK_EDGE_WORDS


def chunk_text_ends_weak(words: List[Dict]) -> bool:
    if not words:
        return False
    last = normalize_token(get_word_text(words[-1]))
    return last in WEAK_EDGE_WORDS
