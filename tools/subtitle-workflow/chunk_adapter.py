import json
from pathlib import Path


def load_whisperx_json(raw_json_path: Path) -> dict:
    return json.loads(raw_json_path.read_text(encoding="utf-8"))


def build_chunk_adapter_output(raw_data: dict, chunk_builder) -> dict:
    spoken_chunks = chunk_builder(raw_data, language="en")

    chunks = []
    debug_items = []
    article_parts = []
    previous_b = 0

    for chunk_index, chunk in enumerate(spoken_chunks):
        chunk_text = str(chunk.get("chunk_text", "")).strip()
        if not chunk_text:
            continue

        article_parts.append(chunk_text)
        raw_start_index = chunk.get("word_start_index")
        raw_end_index = chunk.get("word_end_index")
        if not isinstance(raw_start_index, int) or not isinstance(raw_end_index, int):
            raise ValueError(
                f"chunk_index={chunk_index} 缺少有效的全局词索引。"
                f" word_start_index={raw_start_index!r} word_end_index={raw_end_index!r}"
                f" en={chunk_text!r}"
            )

        a = raw_start_index + 1
        b = raw_end_index + 1
        if a > b:
            raise ValueError(
                f"chunk_index={chunk_index} 的 a/b 非法。a={a} b={b} en={chunk_text!r}"
            )
        if a <= previous_b:
            raise ValueError(
                f"chunk_index={chunk_index} 的 a/b 未保持严格递增。"
                f" previous_b={previous_b} a={a} b={b} en={chunk_text!r}"
            )
        if not chunk_text:
            raise ValueError(
                f"chunk_index={chunk_index} 的 en 为空。a={a} b={b} en={chunk_text!r}"
            )

        chunks.append(
            {
                "a": a,
                "b": b,
                "en": chunk_text,
                "zh": "",
            }
        )
        previous_b = b
        debug_items.append(
            {
                "chunk_text": chunk.get("chunk_text", ""),
                "start": chunk.get("start"),
                "end": chunk.get("end"),
                "duration": chunk.get("duration"),
                "word_count": chunk.get("word_count"),
                "word_start_index": chunk.get("word_start_index"),
                "word_end_index": chunk.get("word_end_index"),
                "confidence": chunk.get("confidence"),
                "applied_rules": chunk.get("applied_rules", []),
                "pause_before": chunk.get("pause_before"),
                "pause_after": chunk.get("pause_after"),
                "low_confidence": chunk.get("low_confidence"),
                "internal_edges": chunk.get("internal_edges", []),
            }
        )

    return {
        "main_input": {"s": [{"id": 0, "chunks": chunks}]},
        "debug_items": debug_items,
        "article_text": " ".join(article_parts),
    }


def serialize_main_input_json(output_json_path: Path, main_input: dict):
    output_json_path.with_name("input.json").write_text(
        json.dumps(main_input, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def serialize_chunk_debug_json(output_json_path: Path, debug_items: list[dict]):
    output_json_path.with_name("chunk_debug.json").write_text(
        json.dumps(debug_items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_gemini_input_files(raw_json_path: Path, output_json_path: Path, chunk_builder) -> str:
    raw_data = load_whisperx_json(raw_json_path)
    adapter_output = build_chunk_adapter_output(raw_data, chunk_builder)
    serialize_main_input_json(output_json_path, adapter_output["main_input"])
    serialize_chunk_debug_json(output_json_path, adapter_output["debug_items"])
    return adapter_output["article_text"]
