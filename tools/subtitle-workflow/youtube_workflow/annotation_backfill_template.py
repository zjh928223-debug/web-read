"""Annotation request scoping, batching and result-format helpers."""

import json
import re
from pathlib import Path

from .core import load_json_file


ANNOTATION_BACKFILL_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "annotation_backfill_prompt.txt"
ANNOTATION_BACKFILL_JOINT_PROMPT_PATH = ANNOTATION_BACKFILL_PROMPT_PATH.with_name("annotation_backfill_joint_prompt.txt")
ANNOTATION_BACKFILL_BATCH_SIZE = 15
ANNOTATION_BACKFILL_MAX_BATCH_SIZE = 50
JOINT_ARTICLE_MAX_CHARS = 700
JOINT_REQUEST_MAX_CHARS = 7200
JOINT_MAX_BATCH_SIZE = 14
JOINT_BATCH_CHAR_BUDGET = 16000
JOINT_OUTPUT_CHARS_PER_ITEM = 600
SRS_MEANING_REFINEMENT_PURPOSE = "srs_meaning_refinement"
SRS_MEANING_REFINEMENT_SOURCE = "article-srs-meaning-refinement"
SRS_MEANING_REFINEMENT_PROMPT = """
You will receive a JSON object for SRS meaning refinement.
Return only valid JSON in this exact shape:
{"items":[{"targetId":"...","simpleMeaning":"..."}]}

For each item, keep targetId unchanged and generate a very short Chinese simpleMeaning.
simpleMeaning is the short Chinese lexical gloss of markedText/boundary as written, not the named entity, concrete referent, or explanation object that the expression points to in the article.
Use sentence, localContext, and contextualExplanation only to choose the expression's sense. Do not directly compress contextualExplanation into the answer.
Even when contextualExplanation explicitly identifies a concrete entity, never substitute that entity for markedText/boundary unless the entity name is explicitly present in markedText/boundary itself.

Follow these contrastive examples:
- markedText="invisible gas"; contextualExplanation identifies ethylene -> simpleMeaning="不可见气体", not "乙烯气体".
- markedText="the capital"; contextualExplanation identifies Beijing -> simpleMeaning="首都", not "北京".
- markedText="the enzyme"; contextualExplanation identifies polyphenol oxidase -> simpleMeaning="这种酶", not "多酚氧化酶".
- markedText="ethylene gas" -> simpleMeaning="乙烯气体".
- markedText="polyphenol oxidase" -> simpleMeaning="多酚氧化酶".

Do not introduce article background, world knowledge, named entities, chemicals, causes, or facts that are not part of the lexical meaning of markedText/boundary.
Do not generate boundary, type, memoryHint, article explanation, markdown, or any extra text.
If an item is a proper noun, temporary term, or unsuitable for SRS, return an empty simpleMeaning for that targetId.
""".strip()


def parse_annotation_backfill_response(response_text: str, log_func=None) -> dict:
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        from language_service import parse_json_with_light_repair

        parsed = parse_json_with_light_repair(
            response_text,
            log_func=log_func,
            log_prefix="annotation-backfill",
        )
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        raise RuntimeError("Gemini annotation backfill response must be a JSON object with an items array")
    return parsed


def annotation_backfill_target_ids(items) -> list[str]:
    target_ids = []
    seen = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        target_id = str(item.get("targetId") or "").strip()
        if target_id and target_id not in seen:
            seen.add(target_id)
            target_ids.append(target_id)
    return target_ids


def validate_annotation_backfill_batch_result(request_template: dict, result: dict, *, normalize_simple_meanings: bool = False) -> None:
    requested_ids = annotation_backfill_target_ids(
        request_template.get("items") if isinstance(request_template, dict) else []
    )
    if not requested_ids:
        return
    returned_ids = set(annotation_backfill_target_ids(result.get("items") if isinstance(result, dict) else []))
    missing_ids = [target_id for target_id in requested_ids if target_id not in returned_ids]
    if not missing_ids:
        if normalize_simple_meanings:
            normalize_annotation_simple_meanings(request_template, result)
        return
    preview = ", ".join(missing_ids[:5])
    if len(missing_ids) > 5:
        preview += ", ..."
    raise RuntimeError(
        "Gemini annotation backfill response is incomplete: "
        f"missing {len(missing_ids)} requested target(s): {preview}"
    )


def normalize_annotation_simple_meanings(request_template: dict, result: dict) -> None:
    requested = {str(item.get("targetId") or "").strip(): item
                 for item in request_template.get("items", []) if isinstance(item, dict)}
    for item in result.get("items", []):
        if not isinstance(item, dict) or "simpleMeaning" not in item:
            continue
        target = requested.get(str(item.get("targetId") or "").strip(), {})
        tokens = re.findall(r"[a-z]+(?:[-'’][a-z]+)*", str(target.get("markedText") or "").lower())
        limit = 20 if len(tokens) > 1 else 16
        short = item["simpleMeaning"]
        short = " ".join(short.split()) if isinstance(short, str) else ""
        # Optional bad short output cannot discard a good detailed explanation.
        # Match the existing browser's UTF-16 length gate; no lexical inference.
        item["simpleMeaning"] = short if len(short.encode("utf-16-le", errors="surrogatepass")) // 2 <= limit else ""


def normalize_annotation_backfill_text(value) -> str:
    return " ".join(str(value or "").split())


def is_srs_meaning_refinement_request(payload: dict, template: dict) -> bool:
    purpose = str((payload or {}).get("purpose") or (template or {}).get("purpose") or "").strip()
    source = str((template or {}).get("source") or (payload or {}).get("source") or "").strip()
    return purpose == SRS_MEANING_REFINEMENT_PURPOSE or source == SRS_MEANING_REFINEMENT_SOURCE


def find_annotation_backfill_sentence_index(sentences: list[str], item: dict) -> int:
    source_sentence = normalize_annotation_backfill_text(item.get("sourceSentence") if isinstance(item, dict) else "")
    if not source_sentence:
        return -1
    for index, sentence in enumerate(sentences):
        if sentence == source_sentence or source_sentence in sentence or sentence in source_sentence:
            return index
    return -1


def scope_annotation_backfill_template(template: dict, items: list[dict]) -> dict:
    scoped = dict(template)
    scoped["items"] = items
    sentences = [
        normalize_annotation_backfill_text(sentence)
        for sentence in (template.get("articleSentences") if isinstance(template.get("articleSentences"), list) else [])
    ]
    sentences = [sentence for sentence in sentences if sentence]
    if not items:
        return scoped

    last_sentence_index = -1
    for item in items:
        last_sentence_index = max(last_sentence_index, find_annotation_backfill_sentence_index(sentences, item))
    if last_sentence_index >= 0:
        scoped_sentences = sentences[:last_sentence_index + 1]
        scoped["articleSentences"] = scoped_sentences
        scoped["articleText"] = " ".join(scoped_sentences)
        return scoped

    article_text = normalize_annotation_backfill_text(template.get("articleText"))
    last_end = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        source_sentence = normalize_annotation_backfill_text(item.get("sourceSentence"))
        if not source_sentence or not article_text:
            continue
        index = article_text.find(source_sentence)
        if index >= 0:
            last_end = max(last_end, index + len(source_sentence))
    if last_end > 0:
        scoped["articleText"] = article_text[:last_end].strip()
    return scoped


def normalize_annotation_backfill_batch_size(value) -> int:
    try:
        batch_size = int(value)
    except (TypeError, ValueError):
        batch_size = ANNOTATION_BACKFILL_BATCH_SIZE
    if batch_size <= 0:
        batch_size = ANNOTATION_BACKFILL_BATCH_SIZE
    return max(1, min(batch_size, ANNOTATION_BACKFILL_MAX_BATCH_SIZE))


def normalize_annotation_backfill_retry_count(value) -> int:
    try:
        retry_count = int(value)
    except (TypeError, ValueError):
        retry_count = 2
    return max(0, min(retry_count, 5))


def normalize_annotation_backfill_retry_delay(value) -> float:
    try:
        retry_delay = float(value)
    except (TypeError, ValueError):
        retry_delay = 2.0
    return max(0.0, min(retry_delay, 30.0))


def is_transient_annotation_backfill_error(exc: Exception) -> bool:
    detail = str(exc or "").lower()
    return (
        "503" in detail
        or "429" in detail
        or "unavailable" in detail
        or "high demand" in detail
        or "rate limit" in detail
        or "temporarily" in detail
    )


def split_annotation_backfill_template(template: dict, batch_size: int) -> list[dict]:
    items = template.get("items") if isinstance(template.get("items"), list) else []
    if len(items) <= batch_size:
        return [template]
    return [
        scope_annotation_backfill_template(template, items[index:index + batch_size])
        for index in range(0, len(items), batch_size)
    ]


def plan_annotation_backfill_requests(template: dict, batch_size: int) -> tuple[list[dict], bool]:
    """Joint output only within the reviewed short-context character range.

    Preserve the original prompt/batching for long or oversized requests rather
    than deleting required context to qualify. These estimates are not tokens.
    """
    original = split_annotation_backfill_template(template, batch_size)
    items = template.get("items") if isinstance(template.get("items"), list) else []
    article = normalize_annotation_backfill_text(template.get("articleText"))
    raw_sentences = template.get("articleSentences") if isinstance(template.get("articleSentences"), list) else []
    sentences = " ".join(normalize_annotation_backfill_text(s) for s in raw_sentences if s)
    if not items or not (article or sentences) or max(len(article), len(sentences)) > JOINT_ARTICLE_MAX_CHARS:
        return original, False
    groups, current = [], []
    cap = min(batch_size, JOINT_MAX_BATCH_SIZE)
    for item in items:
        candidate = scope_annotation_backfill_template(template, current + [item])
        input_chars = len(json.dumps(candidate, ensure_ascii=False))
        output_chars = len(candidate["items"]) * JOINT_OUTPUT_CHARS_PER_ITEM
        if current and (len(current) >= cap or input_chars > JOINT_REQUEST_MAX_CHARS
                        or input_chars + output_chars > JOINT_BATCH_CHAR_BUDGET):
            groups.append(scope_annotation_backfill_template(template, current))
            current = []
        current.append(item)
    groups.append(scope_annotation_backfill_template(template, current))
    if len(groups) == 1:
        groups = [template]
    if any(len(json.dumps(group, ensure_ascii=False)) > JOINT_REQUEST_MAX_CHARS
           or len(json.dumps(group, ensure_ascii=False)) + len(group["items"]) * JOINT_OUTPUT_CHARS_PER_ITEM > JOINT_BATCH_CHAR_BUDGET
           for group in groups):
        return original, False
    return groups, True


def merge_annotation_backfill_results(existing: dict | None, incoming: dict) -> dict:
    if not isinstance(incoming, dict):
        return {"items": []}
    if not isinstance(existing, dict) or not isinstance(existing.get("items"), list):
        return incoming
    incoming_items = incoming.get("items") if isinstance(incoming.get("items"), list) else []
    existing_items = existing.get("items") if isinstance(existing.get("items"), list) else []
    merged_by_key: dict[str, dict] = {}
    order: list[str] = []

    def put_item(item: dict, fallback_index: int) -> None:
        if not isinstance(item, dict):
            return
        target_id = str(item.get("targetId") or "").strip()
        key = f"target:{target_id}" if target_id else f"index:{fallback_index}"
        if key not in merged_by_key:
            order.append(key)
        merged_by_key[key] = item

    for index, item in enumerate(existing_items):
        put_item(item, index)
    for index, item in enumerate(incoming_items, start=len(existing_items)):
        put_item(item, index)

    merged = dict(existing)
    merged.update(incoming)
    merged["items"] = [merged_by_key[key] for key in order]
    return merged


def load_annotation_backfill_history(backfill_dir: Path) -> list[dict]:
    runs_dir = backfill_dir / "runs"
    if not runs_dir.exists():
        return []
    history: list[dict] = []
    for meta_path in sorted(runs_dir.glob("*-meta.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        try:
            meta = load_json_file(meta_path)
        except Exception:
            continue
        if isinstance(meta, dict):
            history.append(meta)
    return history
