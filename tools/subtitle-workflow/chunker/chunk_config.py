from dataclasses import dataclass


@dataclass
class ChunkerConfig:
    # pause thresholds
    gap_strong_glue: float = 0.08
    gap_glue: float = 0.18
    gap_neutral: float = 0.35
    gap_break: float = 0.60

    # target chunk size
    min_chunk_words: int = 2
    preferred_min_chunk_words: int = 3
    target_chunk_words_min: int = 3
    target_chunk_words_max: int = 8
    max_chunk_words: int = 12

    # target chunk duration
    min_chunk_duration: float = 0.45
    preferred_min_chunk_duration: float = 0.80
    target_chunk_duration_min: float = 0.80
    target_chunk_duration_max: float = 2.80
    max_chunk_duration: float = 4.20

    # scoring weights
    score_phrase_keep: float = 2.4
    score_function_attachment: float = 1.2
    score_structure_keep: float = 1.4
    score_pause_strong_glue: float = 1.2
    score_pause_glue: float = 0.7
    score_pause_neutral: float = 0.0
    score_pause_break: float = -0.9
    score_pause_strong_break: float = -1.8
    score_terminal_punct_break: float = -3.5
    score_abbreviation_keep: float = 3.0
    score_weak_boundary_penalty: float = 1.0
    score_oversize_pressure: float = -0.8

    # hard bias
    hard_keep_bias: float = 100.0
    hard_break_bias: float = -100.0

    # decision
    break_when_score_below: float = -0.15
    low_confidence_margin: float = 0.45

    # debug / behavior
    enable_post_merge: bool = True
    enable_post_split: bool = True
    enable_low_confidence: bool = True
    force_merge_single_word_chunks: bool = True


DEFAULT_CHUNKER_CONFIG = ChunkerConfig()
