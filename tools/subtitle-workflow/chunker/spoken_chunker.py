from typing import Dict, List, Optional

from chunk_config import ChunkerConfig, DEFAULT_CHUNKER_CONFIG
from chunk_lexicon import (
    AUXILIARIES,
    BROADCAST_FLOW_WORDS,
    COMPARATIVE_START_WORDS,
    DEGREE_MODIFIERS,
    DETERMINERS,
    DEPENDENT_START_WORDS,
    DISCOURSE_PREFIX_WORDS,
    MODALS,
    NUMBER_WORDS,
    POSSESSIVES,
    PREPOSITIONS,
    PRONOUNS,
    PROPER_NAME_CONNECTORS,
    SHORT_BRIDGE_WORDS,
    SHORT_CHUNK_STARTERS,
    STANDALONE_SHORT_FORMS,
    SUBORDINATORS,
    TEMPORAL_START_WORDS,
    UNIT_WORDS,
    VOCATIVE_WORDS,
    WEAK_EDGE_WORDS,
    WEAK_TAIL_WORDS,
    normalize_token,
)
from chunk_rules import (
    build_phrase_spans,
    chunk_text_ends_weak,
    chunk_text_starts_weak,
    get_word_end,
    get_word_start,
    get_word_text,
    safe_gap,
    score_edge,
    should_break_from_decision,
)


def _coerce_word(word: Dict, index: int) -> Dict:
    text = (
        word.get("text")
        or word.get("word")
        or word.get("token")
        or word.get("value")
        or ""
    )
    start = word.get("start")
    end = word.get("end")

    return {
        "text": str(text),
        "start": float(start) if start is not None else None,
        "end": float(end) if end is not None else None,
        "_index": index,
        "_raw": word,
    }


def _normalize_words(words: List[Dict]) -> List[Dict]:
    out = []
    for idx, w in enumerate(words):
        coerced = _coerce_word(w, idx)
        if coerced["text"].strip() == "":
            continue
        out.append(coerced)
    return out


def _smart_join_tokens(words: List[Dict]) -> str:
    tokens = [w["text"] for w in words]
    if not tokens:
        return ""

    text = tokens[0]
    for token in tokens[1:]:
        stripped = token.strip()
        if stripped in {".", ",", "!", "?", ";", ":"}:
            text += stripped
        else:
            text += " " + token
    return text.strip()


def _chunk_duration(chunk_words: List[Dict]) -> float:
    if not chunk_words:
        return 0.0
    start = get_word_start(chunk_words[0])
    end = get_word_end(chunk_words[-1])
    if start is None or end is None:
        return 0.0
    return max(0.0, end - start)


def _build_initial_chunks(
    words: List[Dict],
    edge_decisions: List[Dict],
    config: ChunkerConfig,
) -> List[Dict]:
    chunks = []
    start_idx = 0

    for decision in edge_decisions:
        edge_index = decision["edge_index"]
        should_break = should_break_from_decision(decision, config)
        if should_break:
            chunk_words = words[start_idx:edge_index + 1]
            chunks.append({
                "start_idx": start_idx,
                "end_idx": edge_index,
                "words": chunk_words,
            })
            start_idx = edge_index + 1

    if start_idx < len(words):
        chunks.append({
            "start_idx": start_idx,
            "end_idx": len(words) - 1,
            "words": words[start_idx:],
        })

    return chunks


def _boundary_score_between_chunks(
    left_chunk: Dict,
    right_chunk: Dict,
    edge_decisions_by_index: Dict[int, Dict],
) -> float:
    edge_index = left_chunk["end_idx"]
    decision = edge_decisions_by_index.get(edge_index)
    if not decision:
        return 0.0
    return decision["score"]


def _merge_two_chunks(left_chunk: Dict, right_chunk: Dict) -> Dict:
    merged_words = left_chunk["words"] + right_chunk["words"]
    return {
        "start_idx": left_chunk["start_idx"],
        "end_idx": right_chunk["end_idx"],
        "words": merged_words,
    }


def _chunk_ends_terminal(chunk: Dict) -> bool:
    words = chunk["words"]
    if not words:
        return False
    last = get_word_text(words[-1]).strip()
    return last.endswith((".", "!", "?"))


def _chunk_starts_with_short_fragment(chunk: Dict) -> bool:
    words = chunk["words"]
    if not words:
        return False
    first = normalize_token(get_word_text(words[0]))
    return (
        first in DETERMINERS
        or first in POSSESSIVES
        or first in AUXILIARIES
        or first in MODALS
        or first in WEAK_EDGE_WORDS
    )


# Fragment suppression / chain protection helpers.
def _is_standalone_short_chunk(chunk: Dict) -> bool:
    words = chunk["words"]
    if len(words) != 1 or not _chunk_ends_terminal(chunk):
        return False
    token = normalize_token(get_word_text(words[0]))
    return token in STANDALONE_SHORT_FORMS


def _looks_like_complete_short_utterance(chunk: Dict) -> bool:
    words = chunk["words"]
    if not words or not _chunk_ends_terminal(chunk):
        return False
    if len(words) > 4:
        return False
    first = normalize_token(get_word_text(words[0]))
    if first in STANDALONE_SHORT_FORMS:
        return True
    if first in SHORT_CHUNK_STARTERS or first in AUXILIARIES or first in MODALS:
        return True
    if len(words) >= 2:
        second = normalize_token(get_word_text(words[1]))
        if first in {"i", "we", "you", "he", "she", "it", "they", "there", "that", "this"}:
            return True
        if second in AUXILIARIES or second in MODALS:
            return True
    return False


def _chunk_ends_with_weak_tail(chunk: Dict) -> bool:
    words = chunk["words"]
    if not words:
        return False
    last = normalize_token(get_word_text(words[-1]))
    return last in WEAK_TAIL_WORDS


def _looks_like_sentence_starter(word: Dict) -> bool:
    text = get_word_text(word).strip()
    normalized = normalize_token(text)
    if normalized in SHORT_CHUNK_STARTERS:
        return True
    return bool(text[:1].isupper())


def _is_title_like_token(word: Dict) -> bool:
    text = get_word_text(word).strip()
    normalized = normalize_token(text)
    if not text or not normalized:
        return False
    if normalized in WEAK_EDGE_WORDS or normalized in PREPOSITIONS or normalized in SUBORDINATORS:
        return False
    alpha = "".join(ch for ch in text if ch.isalpha())
    if not alpha:
        return False
    return alpha[0].isupper() or alpha.isupper()


def _is_numberish_token(token: str) -> bool:
    normalized = normalize_token(token)
    if not normalized:
        return False
    if any(ch.isdigit() for ch in normalized):
        return True
    return normalized in NUMBER_WORDS


def _is_unit_like_token(token: str) -> bool:
    normalized = normalize_token(token)
    return normalized in UNIT_WORDS


def _is_contentish_token(token: str) -> bool:
    normalized = normalize_token(token)
    if not normalized:
        return False
    if _is_numberish_token(normalized) or _is_unit_like_token(normalized):
        return True
    if normalized in WEAK_EDGE_WORDS:
        return False
    if normalized in PREPOSITIONS or normalized in SUBORDINATORS:
        return False
    if normalized in AUXILIARIES or normalized in MODALS:
        return False
    if normalized in PRONOUNS:
        return False
    if normalized in SHORT_BRIDGE_WORDS or normalized in DISCOURSE_PREFIX_WORDS:
        return False
    return True


def _looks_like_short_np_prefix(chunk: Dict) -> bool:
    words = chunk["words"]
    if not words or len(words) > 3 or _chunk_ends_terminal(chunk):
        return False
    first = normalize_token(get_word_text(words[0]))
    if first not in DETERMINERS and first not in POSSESSIVES:
        return False
    return True


def _looks_like_modifier_or_complement_prefix(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _chunk_ends_terminal(chunk):
        return False
    word_count = len(words)
    if word_count > max(3, config.preferred_min_chunk_words):
        return False

    first = normalize_token(get_word_text(words[0]))
    last = normalize_token(get_word_text(words[-1]))
    if first == "to":
        return True
    if first in AUXILIARIES or first in MODALS:
        return True
    if first in PREPOSITIONS or first in SUBORDINATORS:
        return True
    if first in DEGREE_MODIFIERS:
        return True
    duration = _chunk_duration(words)
    if duration > config.preferred_min_chunk_duration * 1.8:
        return False
    if last.endswith(("ing", "ed", "ive", "al", "ary", "ory", "ous")):
        return True
    return False


def _looks_like_discourse_vocative_prefix(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _chunk_ends_terminal(chunk):
        return False
    if len(words) > 3:
        return False
    tokens = [normalize_token(get_word_text(word)) for word in words]
    if not tokens:
        return False
    if tokens[0] in DISCOURSE_PREFIX_WORDS:
        return True
    if len(tokens) >= 2 and tokens[0] in DISCOURSE_PREFIX_WORDS and tokens[1] in VOCATIVE_WORDS:
        return True
    if any(token in VOCATIVE_WORDS for token in tokens) and len(tokens) <= 2:
        return True
    return False


def _looks_like_bridge_prefix(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _chunk_ends_terminal(chunk):
        return False
    if len(words) > 3:
        return False
    tokens = [normalize_token(get_word_text(word)) for word in words]
    tokens = [token for token in tokens if token]
    if not tokens:
        return False
    return tokens[0] in SHORT_BRIDGE_WORDS or all(token in SHORT_BRIDGE_WORDS for token in tokens)


def _looks_like_single_content_fragment(chunk: Dict) -> bool:
    words = chunk["words"]
    if len(words) != 1 or _chunk_ends_terminal(chunk):
        return False
    token = normalize_token(get_word_text(words[0]))
    if not token:
        return False
    if token in WEAK_EDGE_WORDS or token in SHORT_BRIDGE_WORDS:
        return False
    if token in STANDALONE_SHORT_FORMS:
        return False
    return True


def _looks_like_short_nominal_prefix(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _chunk_ends_terminal(chunk):
        return False
    if len(words) > 2:
        return False
    first = normalize_token(get_word_text(words[0]))
    last = normalize_token(get_word_text(words[-1]))
    if first in DETERMINERS or first in POSSESSIVES:
        return True
    if len(words) == 1 and last and last not in WEAK_EDGE_WORDS and last not in PREPOSITIONS and last not in SUBORDINATORS:
        return True
    return False


def _starts_with_dependent_fragment(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _chunk_ends_terminal(chunk):
        return False
    first = normalize_token(get_word_text(words[0]))
    second = normalize_token(get_word_text(words[1])) if len(words) > 1 else ""
    word_count = len(words)
    duration = _chunk_duration(words)
    if first in DEPENDENT_START_WORDS and word_count <= max(3, config.preferred_min_chunk_words):
        return True
    if first in TEMPORAL_START_WORDS and word_count <= 3:
        return True
    if first in COMPARATIVE_START_WORDS and (second == "than" or word_count <= 3):
        return True
    if first in SHORT_CHUNK_STARTERS and word_count <= 2 and duration < config.preferred_min_chunk_duration * 1.8:
        return True
    return False


def _looks_like_proper_name_fragment(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or len(words) > 2 or _chunk_ends_terminal(chunk):
        return False
    title_like_count = sum(1 for word in words if _is_title_like_token(word))
    connector_count = sum(
        1
        for word in words
        if normalize_token(get_word_text(word)) in PROPER_NAME_CONNECTORS
    )
    return title_like_count >= 1 and title_like_count + connector_count == len(words)


def _looks_like_split_proper_name(left_chunk: Dict, right_chunk: Dict, config: ChunkerConfig) -> bool:
    if _chunk_ends_terminal(left_chunk):
        return False
    left_words = left_chunk["words"]
    right_words = right_chunk["words"]
    if not left_words or not right_words:
        return False
    if len(left_words) + len(right_words) > max(5, config.target_chunk_words_min + 2):
        return False
    return _is_title_like_token(left_words[-1]) and _is_title_like_token(right_words[0])


def _is_short_fragment_candidate(chunk: Dict, config: ChunkerConfig) -> bool:
    if _chunk_ends_terminal(chunk):
        return False
    word_count = len(chunk["words"])
    duration = _chunk_duration(chunk["words"])
    return (
        word_count <= max(4, config.preferred_min_chunk_words + 1)
        and duration <= config.preferred_min_chunk_duration * 1.35
    )


def _run_boundary_scores_ok(
    run: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    config: ChunkerConfig,
) -> bool:
    if len(run) < 2:
        return False
    for left_chunk, right_chunk in zip(run, run[1:]):
        score = _boundary_score_between_chunks(left_chunk, right_chunk, edge_decisions_by_index)
        if score < (config.break_when_score_below - 0.25):
            return False
    return True


def _run_looks_like_sentence_intro(run: List[Dict], is_sentence_initial: bool, config: ChunkerConfig) -> bool:
    if not is_sentence_initial or len(run) < 2:
        return False
    if any(_chunk_ends_terminal(chunk) for chunk in run):
        return False
    total_words = sum(len(chunk["words"]) for chunk in run)
    short_count = sum(1 for chunk in run if len(chunk["words"]) <= 2)
    if total_words > max(12, config.target_chunk_words_max + 2):
        return False
    return len(run) >= 3 or short_count >= 2


def _run_looks_like_proper_name_chain(run: List[Dict], config: ChunkerConfig) -> bool:
    if len(run) < 2 or len(run) > 5:
        return False
    tokens = []
    title_like_count = 0
    for chunk in run:
        for word in chunk["words"]:
            tokens.append(normalize_token(get_word_text(word)))
            if _is_title_like_token(word):
                title_like_count += 1
    if title_like_count < 2:
        return False
    return all(
        token in PROPER_NAME_CONNECTORS or _is_contentish_token(token) or token == ""
        for token in tokens
    ) and all(_looks_like_proper_name_fragment(chunk, config) for chunk in run)


def _run_looks_like_number_unit_chain(run: List[Dict], config: ChunkerConfig) -> bool:
    if len(run) < 2 or len(run) > 4:
        return False
    tokens = [
        normalize_token(get_word_text(word))
        for chunk in run
        for word in chunk["words"]
    ]
    tokens = [token for token in tokens if token]
    if len(tokens) < 2 or len(tokens) > 6:
        return False
    if not any(_is_numberish_token(token) for token in tokens):
        return False
    if not any(_is_unit_like_token(token) for token in tokens):
        return False
    return any(_is_contentish_token(token) for token in tokens)


def _run_looks_like_compound_chain(run: List[Dict], config: ChunkerConfig) -> bool:
    if len(run) < 2 or len(run) > 5:
        return False
    tokens = [
        normalize_token(get_word_text(word))
        for chunk in run
        for word in chunk["words"]
    ]
    tokens = [token for token in tokens if token]
    if len(tokens) < 2 or len(tokens) > 7:
        return False
    if any(token in PRONOUNS or token in AUXILIARIES or token in MODALS for token in tokens):
        return False
    if tokens[0] in SHORT_BRIDGE_WORDS or tokens[0] in DISCOURSE_PREFIX_WORDS:
        return False
    content_count = sum(1 for token in tokens if _is_contentish_token(token))
    if content_count < 2:
        return False
    weak_count = sum(1 for token in tokens if token in WEAK_EDGE_WORDS)
    return weak_count <= 2


def _looks_like_unfinished_translation_unit(chunk: Dict, config: ChunkerConfig) -> bool:
    words = chunk["words"]
    if not words or _looks_like_complete_short_utterance(chunk):
        return False
    word_count = len(words)
    if word_count > 4:
        return False
    if _chunk_ends_terminal(chunk):
        return word_count == 1 and _is_contentish_token(get_word_text(words[0]))
    if _starts_with_dependent_fragment(chunk, config):
        return True
    if _looks_like_bridge_prefix(chunk, config):
        return True
    if _looks_like_short_nominal_prefix(chunk, config):
        return True
    if _looks_like_modifier_or_complement_prefix(chunk, config):
        return True
    if _chunk_ends_with_weak_tail(chunk):
        return True
    if word_count == 1 and _is_contentish_token(get_word_text(words[0])):
        return True
    duration = _chunk_duration(words)
    if duration > config.preferred_min_chunk_duration * 1.5:
        return False
    return False


def _looks_like_number_unit_pair(left_chunk: Dict, right_chunk: Dict) -> bool:
    tokens = [
        normalize_token(get_word_text(word))
        for chunk in (left_chunk, right_chunk)
        for word in chunk["words"]
    ]
    tokens = [token for token in tokens if token]
    if len(tokens) < 2 or len(tokens) > 5:
        return False
    if not any(_is_numberish_token(token) for token in tokens):
        return False
    if not any(_is_unit_like_token(token) for token in tokens):
        return False
    return any(_is_contentish_token(token) for token in tokens)


def _looks_like_compound_noun_pair(left_chunk: Dict, right_chunk: Dict) -> bool:
    if _chunk_ends_terminal(left_chunk):
        return False
    tokens = [
        normalize_token(get_word_text(word))
        for chunk in (left_chunk, right_chunk)
        for word in chunk["words"]
    ]
    tokens = [token for token in tokens if token]
    if len(tokens) < 2 or len(tokens) > 5:
        return False
    if any(token in PRONOUNS or token in AUXILIARIES or token in MODALS for token in tokens):
        return False
    if tokens[0] in SHORT_BRIDGE_WORDS or tokens[0] in DISCOURSE_PREFIX_WORDS:
        return False
    content_count = sum(1 for token in tokens if _is_contentish_token(token))
    return content_count >= 2


def _run_looks_like_broadcast_transition(run: List[Dict]) -> bool:
    if len(run) < 2:
        return False
    tokens = []
    for chunk in run:
        tokens.extend(normalize_token(get_word_text(word)) for word in chunk["words"])
    tokens = [token for token in tokens if token]
    if len(tokens) > 12:
        return False
    cue_count = sum(1 for token in tokens if token in BROADCAST_FLOW_WORDS)
    return cue_count >= 2


# Post-merge regrouping for over-fragmented runs.
def _merge_fragment_runs(
    chunks: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    config: ChunkerConfig,
) -> List[Dict]:
    if len(chunks) < 2:
        return chunks

    merged: List[Dict] = []
    i = 0
    while i < len(chunks):
        is_sentence_initial = i == 0 or _chunk_ends_terminal(chunks[i - 1])
        if not _is_short_fragment_candidate(chunks[i], config):
            merged.append(chunks[i])
            i += 1
            continue

        run = [chunks[i]]
        total_words = len(chunks[i]["words"])
        j = i + 1
        while j < len(chunks) and len(run) < 5:
            next_chunk = chunks[j]
            if not _is_short_fragment_candidate(next_chunk, config):
                break
            if total_words + len(next_chunk["words"]) > max(config.target_chunk_words_max, 10):
                break
            run.append(next_chunk)
            total_words += len(next_chunk["words"])
            j += 1

        if (
            len(run) >= 2
            and _run_boundary_scores_ok(run, edge_decisions_by_index, config)
            and (
                _run_looks_like_sentence_intro(run, is_sentence_initial, config)
                or _run_looks_like_proper_name_chain(run, config)
                or _run_looks_like_number_unit_chain(run, config)
                or _run_looks_like_compound_chain(run, config)
                or _run_looks_like_broadcast_transition(run)
                or _looks_like_unfinished_translation_unit(run[0], config)
                or (
                    len(run) >= 2
                    and (
                        (_looks_like_bridge_prefix(run[0], config) and _looks_like_single_content_fragment(run[1]))
                        or (_looks_like_short_nominal_prefix(run[0], config) and len(run[1]["words"]) <= 2)
                    )
                )
            )
        ):
            merged_chunk = run[0]
            for extra_chunk in run[1:]:
                merged_chunk = _merge_two_chunks(merged_chunk, extra_chunk)
            merged.append(merged_chunk)
            i += len(run)
            continue

        merged.append(chunks[i])
        i += 1

    return merged


def _find_terminal_tail_split(chunk: Dict, config: ChunkerConfig) -> Optional[int]:
    words = chunk["words"]
    if len(words) < 3:
        return None

    last_candidate = None
    for idx in range(len(words) - 1):
        text = get_word_text(words[idx]).strip()
        if text.endswith((".", "!", "?")):
            last_candidate = idx

    if last_candidate is None:
        return None

    tail_count = len(words) - (last_candidate + 1)
    if tail_count <= 0 or tail_count > max(2, config.preferred_min_chunk_words - 1):
        return None

    tail_duration = _chunk_duration(words[last_candidate + 1 :])
    if tail_duration > config.preferred_min_chunk_duration:
        return None

    if not _looks_like_sentence_starter(words[last_candidate + 1]):
        return None

    return last_candidate


def _cleanup_terminal_tails(chunks: List[Dict], config: ChunkerConfig) -> List[Dict]:
    if not chunks:
        return chunks

    cleaned: List[Dict] = []
    for index, chunk in enumerate(chunks):
        split_idx = _find_terminal_tail_split(chunk, config)
        if split_idx is None:
            cleaned.append(chunk)
            continue

        left_chunk = {
            "start_idx": chunk["start_idx"],
            "end_idx": chunk["start_idx"] + split_idx,
            "words": chunk["words"][: split_idx + 1],
        }
        tail_chunk = {
            "start_idx": chunk["start_idx"] + split_idx + 1,
            "end_idx": chunk["end_idx"],
            "words": chunk["words"][split_idx + 1 :],
        }

        cleaned.append(left_chunk)
        if index + 1 < len(chunks):
            next_chunk = chunks[index + 1]
            chunks[index + 1] = _merge_two_chunks(tail_chunk, next_chunk)
        else:
            cleaned.append(tail_chunk)

    return cleaned


def _merge_weak_tail_pairs(chunks: List[Dict], config: ChunkerConfig) -> List[Dict]:
    if len(chunks) < 2:
        return chunks

    merged: List[Dict] = []
    i = 0
    while i < len(chunks):
        current = chunks[i]
        if i == len(chunks) - 1:
            merged.append(current)
            break

        right = chunks[i + 1]
        right_word_count = len(right["words"])
        right_duration = _chunk_duration(right["words"])
        if (
            _chunk_ends_with_weak_tail(current)
            and not _chunk_ends_terminal(current)
            and (
                right_word_count <= 2
                or right_duration < config.preferred_min_chunk_duration
            )
        ):
            merged.append(_merge_two_chunks(current, right))
            i += 2
            continue

        merged.append(current)
        i += 1

    return merged


def _merge_name_and_np_pairs(chunks: List[Dict], config: ChunkerConfig) -> List[Dict]:
    if len(chunks) < 2:
        return chunks

    merged: List[Dict] = []
    i = 0
    while i < len(chunks):
        current = chunks[i]
        if i == len(chunks) - 1:
            merged.append(current)
            break

        right = chunks[i + 1]
        right_word_count = len(right["words"])
        if _looks_like_split_proper_name(current, right, config):
            merged.append(_merge_two_chunks(current, right))
            i += 2
            continue
        if _looks_like_short_np_prefix(current) and right_word_count <= 3 and not _chunk_starts_with_short_fragment(right):
            merged.append(_merge_two_chunks(current, right))
            i += 2
            continue

        merged.append(current)
        i += 1

    return merged


def _merge_unfinished_translation_pairs(chunks: List[Dict], config: ChunkerConfig) -> List[Dict]:
    if len(chunks) < 2:
        return chunks

    merged: List[Dict] = []
    i = 0
    while i < len(chunks):
        current = chunks[i]
        if i == len(chunks) - 1:
            merged.append(current)
            break

        right = chunks[i + 1]
        current_words = len(current["words"])
        right_words = len(right["words"])

        if (
            current_words == 1
            and _chunk_ends_terminal(current)
            and not _looks_like_complete_short_utterance(current)
            and merged
            and not _chunk_ends_terminal(merged[-1])
        ):
            prev = merged.pop()
            merged.append(_merge_two_chunks(prev, current))
            i += 1
            continue

        if (
            _looks_like_unfinished_translation_unit(current, config)
            and not _looks_like_complete_short_utterance(right)
            and (
                right_words <= 3
                or _looks_like_single_content_fragment(right)
                or _looks_like_proper_name_fragment(right, config)
                or _looks_like_number_unit_pair(current, right)
                or _looks_like_compound_noun_pair(current, right)
            )
        ):
            merged.append(_merge_two_chunks(current, right))
            i += 2
            continue

        if (
            _looks_like_unfinished_translation_unit(current, config)
            and current_words <= 3
            and not _chunk_ends_terminal(current)
            and right_words <= max(5, config.preferred_min_chunk_words + 2)
            and _chunk_duration(right["words"]) <= config.preferred_min_chunk_duration * 1.8
        ):
            merged.append(_merge_two_chunks(current, right))
            i += 2
            continue

        merged.append(current)
        i += 1

    return merged


def _should_force_merge(chunk: Dict, config: ChunkerConfig) -> bool:
    word_count = len(chunk["words"])
    duration = _chunk_duration(chunk["words"])
    is_short_chunk = word_count <= max(3, config.preferred_min_chunk_words)

    if _looks_like_complete_short_utterance(chunk):
        return False
    if (
        config.force_merge_single_word_chunks
        and word_count == 1
        and not _is_standalone_short_chunk(chunk)
    ):
        return True
    if word_count < config.min_chunk_words:
        return True
    if is_short_chunk and duration < config.min_chunk_duration:
        return True
    if is_short_chunk and chunk_text_starts_weak(chunk["words"]):
        return True
    if is_short_chunk and chunk_text_ends_weak(chunk["words"]):
        return True
    return False


def _should_prefer_merge(chunk: Dict, config: ChunkerConfig) -> bool:
    word_count = len(chunk["words"])
    duration = _chunk_duration(chunk["words"])
    is_short_chunk = word_count <= max(4, config.preferred_min_chunk_words + 1)

    if _looks_like_complete_short_utterance(chunk):
        return False
    if word_count == 1 and not _is_standalone_short_chunk(chunk):
        return True
    if word_count == 2 and not _chunk_ends_terminal(chunk) and duration < config.preferred_min_chunk_duration:
        return True
    if (
        word_count < config.preferred_min_chunk_words
        and duration < config.preferred_min_chunk_duration
    ):
        return True
    if (
        _chunk_starts_with_short_fragment(chunk)
        and word_count < config.preferred_min_chunk_words
    ):
        return True
    if (
        _chunk_starts_with_short_fragment(chunk)
        and duration < config.preferred_min_chunk_duration
    ):
        return True
    if (
        is_short_chunk
        and duration <= config.preferred_min_chunk_duration * 1.6
        and _looks_like_unfinished_translation_unit(chunk, config)
    ):
        return True
    if is_short_chunk and _starts_with_dependent_fragment(chunk, config):
        return True
    if is_short_chunk and _looks_like_short_np_prefix(chunk):
        return True
    if is_short_chunk and _looks_like_modifier_or_complement_prefix(chunk, config):
        return True
    if is_short_chunk and _looks_like_discourse_vocative_prefix(chunk, config):
        return True
    if is_short_chunk and _looks_like_bridge_prefix(chunk, config):
        return True
    if is_short_chunk and _looks_like_short_nominal_prefix(chunk, config):
        return True
    return False


def _preferred_merge_direction(chunk: Dict, prev_chunk: Dict, next_chunk: Dict, config: ChunkerConfig) -> Optional[str]:
    if _chunk_ends_terminal(chunk) and len(chunk["words"]) == 1 and not _looks_like_complete_short_utterance(chunk):
        return "left"
    if _chunk_ends_with_weak_tail(prev_chunk) and len(chunk["words"]) <= 3:
        return "left"
    if _looks_like_unfinished_translation_unit(prev_chunk, config) and len(chunk["words"]) <= 2:
        return "left"
    if _looks_like_single_content_fragment(chunk) and (
        _looks_like_bridge_prefix(prev_chunk, config)
        or _looks_like_discourse_vocative_prefix(prev_chunk, config)
        or _looks_like_unfinished_translation_unit(prev_chunk, config)
    ):
        return "left"
    if _starts_with_dependent_fragment(chunk, config):
        return "right"
    if _looks_like_short_np_prefix(chunk):
        return "right"
    if _looks_like_modifier_or_complement_prefix(chunk, config):
        return "right"
    if _looks_like_discourse_vocative_prefix(chunk, config):
        return "right"
    if _looks_like_bridge_prefix(chunk, config):
        return "right"
    if _looks_like_short_nominal_prefix(chunk, config):
        return "right"
    if _looks_like_split_proper_name(prev_chunk, chunk, config):
        return "left"
    if _looks_like_split_proper_name(chunk, next_chunk, config):
        return "right"
    return None


# Final small-chunk merge pass.
def _post_merge_small_chunks(
    chunks: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    words: List[Dict],
    config: ChunkerConfig,
) -> List[Dict]:
    if not chunks:
        return chunks

    current = _cleanup_terminal_tails(list(chunks), config)
    current = _merge_weak_tail_pairs(current, config)
    current = _merge_name_and_np_pairs(current, config)
    current = _merge_unfinished_translation_pairs(current, config)
    current = _merge_fragment_runs(current, edge_decisions_by_index, config)
    changed = True

    while changed:
        changed = False
        new_chunks: List[Dict] = []
        i = 0

        while i < len(current):
            chunk = current[i]

            force_merge = _should_force_merge(chunk, config)
            prefer_merge = _should_prefer_merge(chunk, config)

            if not force_merge and not prefer_merge:
                new_chunks.append(chunk)
                i += 1
                continue

            if len(current) == 1:
                new_chunks.append(chunk)
                i += 1
                continue

            if i == 0:
                merged = _merge_two_chunks(chunk, current[i + 1])
                new_chunks.append(merged)
                i += 2
                changed = True
                continue

            if i == len(current) - 1:
                prev_chunk = new_chunks.pop()
                merged = _merge_two_chunks(prev_chunk, chunk)
                new_chunks.append(merged)
                i += 1
                changed = True
                continue

            prev_chunk = new_chunks[-1]
            next_chunk = current[i + 1]

            preferred_direction = _preferred_merge_direction(chunk, prev_chunk, next_chunk, config)
            if preferred_direction == "left":
                prev_chunk = new_chunks.pop()
                merged = _merge_two_chunks(prev_chunk, chunk)
                new_chunks.append(merged)
                i += 1
                changed = True
                continue
            if preferred_direction == "right":
                merged = _merge_two_chunks(chunk, next_chunk)
                new_chunks.append(merged)
                i += 2
                changed = True
                continue

            left_boundary_score = _boundary_score_between_chunks(prev_chunk, chunk, edge_decisions_by_index)
            right_boundary_score = _boundary_score_between_chunks(chunk, next_chunk, edge_decisions_by_index)

            if left_boundary_score >= right_boundary_score:
                prev_chunk = new_chunks.pop()
                merged = _merge_two_chunks(prev_chunk, chunk)
                new_chunks.append(merged)
                i += 1
            else:
                merged = _merge_two_chunks(chunk, next_chunk)
                new_chunks.append(merged)
                i += 2

            changed = True

        current = new_chunks

    return _rebalance_oversized_merged_chunks(current, edge_decisions_by_index, words, config)


def _find_best_split_edge(
    chunk: Dict,
    edge_decisions_by_index: Dict[int, Dict],
    config: ChunkerConfig,
) -> Optional[int]:
    start_idx = chunk["start_idx"]
    end_idx = chunk["end_idx"]

    candidate_edges = []
    for edge_index in range(start_idx, end_idx):
        decision = edge_decisions_by_index.get(edge_index)
        if not decision:
            continue
        if decision["hard_keep"] and not decision["hard_break"]:
            continue
        candidate_edges.append(decision)

    if not candidate_edges:
        return None

    candidate_edges.sort(key=lambda d: d["score"])
    return candidate_edges[0]["edge_index"]


def _find_rebalance_split_edge(
    chunk: Dict,
    edge_decisions_by_index: Dict[int, Dict],
    words: List[Dict],
    config: ChunkerConfig,
) -> Optional[int]:
    start_idx = chunk["start_idx"]
    end_idx = chunk["end_idx"]
    total_words = end_idx - start_idx + 1
    min_side_words = max(2, config.min_chunk_words)

    candidate_edges = []
    for edge_index in range(start_idx, end_idx):
        left_words = edge_index - start_idx + 1
        right_words = end_idx - edge_index
        if left_words < min_side_words or right_words < min_side_words:
            continue
        decision = edge_decisions_by_index.get(edge_index)
        if not decision:
            continue
        if decision["hard_keep"] and not decision["hard_break"]:
            continue
        left_chunk = {
            "start_idx": start_idx,
            "end_idx": edge_index,
            "words": words[start_idx:edge_index + 1],
        }
        right_chunk = {
            "start_idx": edge_index + 1,
            "end_idx": end_idx,
            "words": words[edge_index + 1:end_idx + 1],
        }
        if (
            _looks_like_unfinished_translation_unit(left_chunk, config)
            or _looks_like_unfinished_translation_unit(right_chunk, config)
        ):
            continue
        if (
            len(left_chunk["words"]) <= 2
            and not _looks_like_complete_short_utterance(left_chunk)
            and (
                _looks_like_bridge_prefix(left_chunk, config)
                or _looks_like_short_nominal_prefix(left_chunk, config)
                or _looks_like_modifier_or_complement_prefix(left_chunk, config)
            )
        ):
            continue
        if (
            len(right_chunk["words"]) <= 2
            and not _looks_like_complete_short_utterance(right_chunk)
            and (
                _looks_like_bridge_prefix(right_chunk, config)
                or _looks_like_short_nominal_prefix(right_chunk, config)
                or _looks_like_modifier_or_complement_prefix(right_chunk, config)
            )
        ):
            continue
        imbalance = abs((left_words / total_words) - 0.5)
        candidate_edges.append((decision["score"], imbalance, decision["edge_index"]))

    if not candidate_edges:
        return None

    candidate_edges.sort(key=lambda item: (item[0], item[1]))
    return candidate_edges[0][2]


def _rebalance_oversized_merged_chunks(
    chunks: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    words: List[Dict],
    config: ChunkerConfig,
) -> List[Dict]:
    out: List[Dict] = []

    for chunk in chunks:
        word_count = len(chunk["words"])
        duration = _chunk_duration(chunk["words"])
        too_long = (
            word_count > config.max_chunk_words
            or duration > config.max_chunk_duration
        )
        if not too_long:
            out.append(chunk)
            continue

        split_edge = _find_rebalance_split_edge(chunk, edge_decisions_by_index, words, config)
        if split_edge is None:
            out.append(chunk)
            continue

        left_chunk = {
            "start_idx": chunk["start_idx"],
            "end_idx": split_edge,
            "words": words[chunk["start_idx"]:split_edge + 1],
        }
        right_chunk = {
            "start_idx": split_edge + 1,
            "end_idx": chunk["end_idx"],
            "words": words[split_edge + 1:chunk["end_idx"] + 1],
        }
        out.extend(
            _rebalance_oversized_merged_chunks(
                [left_chunk, right_chunk],
                edge_decisions_by_index,
                words,
                config,
            )
        )

    return out


def _post_split_oversized_chunks(
    chunks: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    words: List[Dict],
    config: ChunkerConfig,
) -> List[Dict]:
    out: List[Dict] = []

    for chunk in chunks:
        word_count = len(chunk["words"])
        duration = _chunk_duration(chunk["words"])

        too_long = (
            word_count > config.max_chunk_words
            or duration > config.max_chunk_duration
        )

        if not too_long:
            out.append(chunk)
            continue

        split_edge = _find_best_split_edge(chunk, edge_decisions_by_index, config)
        if split_edge is None:
            out.append(chunk)
            continue

        left_chunk = {
            "start_idx": chunk["start_idx"],
            "end_idx": split_edge,
            "words": words[chunk["start_idx"]:split_edge + 1],
        }
        right_chunk = {
            "start_idx": split_edge + 1,
            "end_idx": chunk["end_idx"],
            "words": words[split_edge + 1:chunk["end_idx"] + 1],
        }

        out.extend(_post_split_oversized_chunks([left_chunk, right_chunk], edge_decisions_by_index, words, config))

    return out


def _compute_chunk_confidence(
    chunk: Dict,
    edge_decisions_by_index: Dict[int, Dict],
    config: ChunkerConfig,
) -> float:
    start_idx = chunk["start_idx"]
    end_idx = chunk["end_idx"]

    internal_scores = []
    internal_low_conf = 0

    for edge_index in range(start_idx, end_idx):
        d = edge_decisions_by_index.get(edge_index)
        if not d:
            continue
        internal_scores.append(abs(d["score"]))
        if d["low_confidence"]:
            internal_low_conf += 1

    if not internal_scores:
        return 0.95

    avg_strength = sum(internal_scores) / len(internal_scores)
    confidence = min(0.99, 0.45 + avg_strength / 4.5)

    if internal_low_conf:
        confidence -= min(0.25, 0.08 * internal_low_conf)

    return max(0.10, round(confidence, 3))


def _finalize_chunk(
    chunk: Dict,
    words: List[Dict],
    edge_decisions_by_index: Dict[int, Dict],
    config: ChunkerConfig,
) -> Dict:
    chunk_words = chunk["words"]
    start_idx = chunk["start_idx"]
    end_idx = chunk["end_idx"]

    start = get_word_start(chunk_words[0]) if chunk_words else None
    end = get_word_end(chunk_words[-1]) if chunk_words else None

    pause_before = None
    if start_idx > 0:
        pause_before = safe_gap(words[start_idx - 1], words[start_idx])

    pause_after = None
    if end_idx < len(words) - 1:
        pause_after = safe_gap(words[end_idx], words[end_idx + 1])

    internal_edges = []
    applied_rules = []
    low_confidence = False

    for edge_index in range(start_idx, end_idx):
        d = edge_decisions_by_index.get(edge_index)
        if not d:
            continue
        internal_edges.append({
            "edge_index": edge_index,
            "left": d["left"],
            "right": d["right"],
            "gap": d["gap"],
            "score": d["score"],
            "low_confidence": d["low_confidence"],
            "applied_rules": d["applied_rules"],
        })
        applied_rules.extend(d["applied_rules"])
        if d["low_confidence"]:
            low_confidence = True

    return {
        "chunk_text": _smart_join_tokens(chunk_words),
        "words": [w["_raw"] for w in chunk_words],
        "start": start,
        "end": end,
        "duration": round(_chunk_duration(chunk_words), 3),
        "word_count": len(chunk_words),
        "word_start_index": start_idx,
        "word_end_index": end_idx,
        "confidence": _compute_chunk_confidence(chunk, edge_decisions_by_index, config),
        "applied_rules": sorted(set(applied_rules)),
        "pause_before": pause_before,
        "pause_after": pause_after,
        "low_confidence": low_confidence,
        "internal_edges": internal_edges,
    }


def extract_words_from_whisperx_json(data: Dict) -> List[Dict]:
    segments = data.get("segments", []) if isinstance(data, dict) else []
    words: List[Dict] = []

    for segment_index, segment in enumerate(segments):
        segment_text = (
            segment.get("text")
            or segment.get("segment_text")
            or ""
        )
        for word_index, word in enumerate(segment.get("words", []) or []):
            words.append(
                {
                    "word": word.get("word") or word.get("text") or "",
                    "start": word.get("start"),
                    "end": word.get("end"),
                    "score": word.get("score"),
                    "_segment_index": segment_index,
                    "_word_index_in_segment": word_index,
                    "_segment_text": segment_text,
                }
            )

    return words


def build_spoken_chunks_from_whisperx(
    words: List[Dict],
    language: str = "en",
    config: Optional[ChunkerConfig] = None,
) -> List[Dict]:
    config = config or DEFAULT_CHUNKER_CONFIG
    words = _normalize_words(words)

    if not words:
        return []

    if len(words) == 1:
        single = words[0]
        return [{
            "chunk_text": single["text"],
            "words": [single["_raw"]],
            "start": single["start"],
            "end": single["end"],
            "duration": round((single["end"] or 0.0) - (single["start"] or 0.0), 3),
            "word_count": 1,
            "word_start_index": 0,
            "word_end_index": 0,
            "confidence": 0.99,
            "applied_rules": ["single_word_chunk"],
            "pause_before": None,
            "pause_after": None,
            "low_confidence": False,
            "internal_edges": [],
        }]

    phrase_spans = build_phrase_spans(words)

    edge_decisions = []
    for i in range(len(words) - 1):
        decision = score_edge(words, i, phrase_spans, config)
        edge_decisions.append(decision)

    edge_decisions_by_index = {d["edge_index"]: d for d in edge_decisions}

    chunks = _build_initial_chunks(words, edge_decisions, config)

    if config.enable_post_merge:
        chunks = _post_merge_small_chunks(chunks, edge_decisions_by_index, words, config)

    if config.enable_post_split:
        chunks = _post_split_oversized_chunks(chunks, edge_decisions_by_index, words, config)

    final_chunks = [
        _finalize_chunk(chunk, words, edge_decisions_by_index, config)
        for chunk in chunks
    ]

    return final_chunks


def build_spoken_chunks_from_whisperx_json(
    data: Dict,
    language: str = "en",
    config: Optional[ChunkerConfig] = None,
) -> List[Dict]:
    words = extract_words_from_whisperx_json(data)
    return build_spoken_chunks_from_whisperx(words, language=language, config=config)
