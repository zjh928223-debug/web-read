import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from threading import Event

from PyQt6.QtCore import QThread, pyqtSignal
from PyQt6.QtGui import QCloseEvent
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

SCRIPT_DIR = Path(__file__).resolve().parent
CHUNKER_DIR = SCRIPT_DIR / "chunker"
if str(CHUNKER_DIR) not in sys.path:
    sys.path.insert(0, str(CHUNKER_DIR))

import chunk_adapter as chunk_adapter_boundary
import language_service as language_service_boundary
from spoken_chunker import build_spoken_chunks_from_whisperx_json, extract_words_from_whisperx_json
from youtube_workflow.core import LocalWorkflowRunner, WorkflowConfig, WorkflowRequest

WHISPERX_PATH = r"D:\whisper_env\Scripts\whisperx.exe"
YT_DLP_PATH = r"D:\whisper_env\Scripts\yt-dlp.exe"
COOKIES_PATH = Path(r"C:\Users\0\Desktop\www.youtube.com_cookies.txt")
DEFAULT_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEFAULT_GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "")
APP_CONFIG_DIR = Path(os.getenv("LOCALAPPDATA", str(Path.home()))) / "YouTubeGeminiWorkflow"
CONFIG_PATH = APP_CONFIG_DIR / "config.json"
CLASH_PROXY = "http://127.0.0.1:7897"
DEFAULT_NEED_CLOZE = False
ALLOW_MAIN_API_RERUN = False
GEMINI_CACHE_DIR = SCRIPT_DIR / ".gemini_cache"

SYSTEM_PROMPT = """
你是英语语块的中文口语转述助手。
输入已经给出固定 chunks，且最外层 s 只允许有 1 个元素。
你只能为每个 chunk 补写 zh。
绝对禁止修改 id、a、b、en。
绝对禁止合并、拆分、调整顺序或改写 en。
输出必须是合法 JSON，对象格式为 {"s":[{"id":0,"chunks":[{"a":1,"b":2,"en":"...","zh":"..."}]}]}，并且 s 中只能有这 1 个元素。
只输出 JSON，不要 markdown，不要解释。

zh 要求：
1. 口语化
2. 简短
3. 顺口
4. 像人在讲解，不像书面翻译
5. 如果英文本身没说完，中文也保留这种感觉
"""

MAIN_OUTPUT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "s": {
            "type": "array",
            "minItems": 1,
            "maxItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "chunks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "a": {"type": "integer"},
                                "b": {"type": "integer"},
                                "en": {"type": "string"},
                                "zh": {"type": "string"},
                            },
                            "required": ["a", "b", "en", "zh"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "chunks"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["s"],
    "additionalProperties": False,
}

SYSTEM_PROMPT_CLOZE = """
你是英语填空题生成助手。
输入是一个 JSON 对象，包含 article_text 和 selected_candidates。
输出必须是合法 JSON 数组，不要 markdown，不要解释文字。

任务：
根据给定文章内容，生成适合 B1-B2 学习者的英文填空题。

每一项结构为：
{
  "source_sentence": "原句",
  "chinese_translation": "中文提示",
  "cloze_sentence": "带 ________ 的英文句子",
  "target_word": "待考目标表达",
  "word_type": "noun / verb / phrasal verb / adjective / expression 等",
  "reasoning": "简短中文解释"
}

核心原则：
1. 一个题只能考一个 target_expression。
2. target_expression 可以是一个单词，也可以是一个固定短语、phrasal verb、常见搭配或高频表达。
3. target_expression 必须是 source_sentence 中的一个连续原文片段。
4. 不允许把两个独立短语、两个不同语法单位、或两个不同学习点拼接成一个答案。
5. 如果一句话里同时有两个可学表达，只能选其中一个出题。
6. blank 必须只对应 target_expression，且完整替换后句子依然自然。
7. 如果某个候选表达会导致题目别扭、不自然、难以判分，就不要选它。
8. 优先选择有学习价值的表达，例如 phrasal verbs、固定搭配、常见口语表达、熟词生义、高频但容易误解的表达。
9. 不要选择低价值功能词、半截短语、机械截取的片段，或依赖上下文硬猜才能答出的内容。
10. 宁可少出一道，也不要出结构不自然的题。

额外硬规则：
- cloze_sentence 中只能有一个 blank。
- target_expression 必须能完整、自然地填回 blank。
- blank 不能跨越两个独立表达。
- 禁止把前后各自已经完整成立的两个短语合并为一个答案。
- target_expression 必须与 source_sentence 中的原文完全一致，不得改写，不得拼接。
- 在生成题目前，先检查 target_expression 是否是一个连续、独立、自然的学习单位；如果不是，则放弃该候选。

输出字段：
- source_sentence
- chinese_translation
- cloze_sentence
- target_word
- word_type
- reasoning

兼容说明：
这里的 target_word 指待考目标表达，不一定是单个 word，也可以是 phrase、phrasal verb、collocation 或 fixed expression。
在生成和判断时，按 target_expression 的标准处理。

规则：
1. 只处理 selected_candidates 里给出的项目，不要新增，不要删除，不要改 target_word，不要改 cloze_sentence。
2. 主要补全 chinese_translation 和 reasoning；source_sentence、cloze_sentence、target_word、word_type 保持原意。
3. 每题只允许一个 blank，每题只允许一个 target_word；这里的 target_word 表示 target_expression。
4. target_word 必须是 source_sentence 中一个连续、自然、可独立学习的原文片段，不能把两个独立表达拼起来。
5. 如果一句话里有两个可学表达，只能选其中一个；不要把两个短语或两个语法单位合并成一个答案。
6. 不要提取生僻专有名词。
7. 优先突出 phrasal verbs、固定搭配、常见口语表达、熟词生义、高频但容易被字面误解的表达。
8. 拒绝低价值功能词、半截短语、机械拼接碎片，以及只能靠重组多个片段才能成立的答案。
9. source_sentence、chinese_translation、cloze_sentence、target_word、word_type、reasoning 必须都是字符串。

数量要求：
- 必须输出且只输出 10 道题。
- 不允许少于 10 道，也不允许多于 10 道。
- 数组中的 10 个对象都必须完整，不能出现前几题完整、后几题缺字段或留空的情况。

硬规则：
- 每一道题都必须包含以下 6 个字段，且全部为非空字符串：
  - source_sentence
  - chinese_translation
  - cloze_sentence
  - target_word
  - word_type
  - reasoning
- chinese_translation 不能为空。
- reasoning 不能为空。
- 禁止只给答案不写解释。
- 禁止前面几题完整、后面几题省略 explanation。
- 如果某个候选做不出高质量解释，就不要选它进入最终 10 题；但一旦进入最终输出，这一题的所有字段必须完整。

质量要求：
- 每一道题都必须有明确、简短、自然的中文解释。
- reasoning 必须说明这个 target_expression 为什么值得学，或它在当前句子里的实际意思。
- 不允许使用空字符串、占位语、重复模板、敷衍解释来凑满 10 题。

最终检查：
- 在输出前，请逐题检查 10 道题是否都包含完整非空的 chinese_translation 和 reasoning。
- 只要有任意一道题 explanation 为空，就视为整个输出不合格，必须重写完整后再输出。
"""

SYSTEM_PROMPT_ZH_ONLY = """
你是英语语块的中文口语转述助手。
输入已经给出固定 chunks，且最外层 s 只允许有 1 个元素。
你只能为每个 chunk 生成 zh。
绝对禁止修改 id、a、b、en。
绝对禁止删除、合并、拆分、重排 chunks，绝对禁止改写 en。
输出必须是合法 JSON，对象格式为 {"s":[{"id":0,"chunks":[{"a":1,"b":2,"en":"...","zh":"..."}]}]}，并且 s 中只能有 1 个元素。
只输出 JSON，不要 markdown，不要解释。

硬性规则：
1. s 只允许 1 个元素
2. 只能填写 chunks[*].zh
3. 每个 zh 必须非空
4. 当前 zh 只能对应当前 chunk
5. 不要把后一个 chunk 的意思提前翻进前一个 zh
6. 不要遗漏任何输入 chunk

zh 要求：
1. 口语化
2. 简短
3. 顺口
4. 像人在讲解，不像书面翻译
5. 如果英文本身没说完，中文也保留这种感觉

避免生硬书面语：
因此
此外
综上
从技术上讲
本质上
尤为
关乎
"""

SYSTEM_PROMPT_ZH_REPAIR = """
你是英语意群的中文口语转述助手。
输入已经给出固定 chunk。你只能为每个 chunk 生成 zh。
绝对禁止修改 id、a、b、en。
绝对禁止合并 chunk、拆分 chunk、调整顺序。
输出必须是合法 JSON，对象格式为 {"s":[{"id":0,"chunks":[{"a":1,"b":2,"en":"...","zh":"..."}]}]}。
只输出 JSON，不要 markdown，不要解释。

修复要求：
1. 每个 zh 必须只对应当前 en
2. 更短，更顺，更像口语解释
3. 不要把相邻 chunk 的信息提前翻进来
4. 如果英文是转折、原因、结果、补充说明的半句，中文也保持这种节奏
"""

SYSTEM_PROMPT_CHUNK = """
你是英语口语语块的切分助手。
输入是一段从视频转录的英语文本，每个词带有编号。

你的任务是将这些词按美国人口语的自然"气口"切分成语块（spoken chunks）。

核心原则：
- 一个 chunk 尽量只承载一个动作或一个判断
- 宁可多切一点，也不要一口气塞满信息
- 每个 chunk 长度建议 4-12 词，避免 1-2 词碎片和 15+ 词长句

优先切在这些位置（气口）：
- 句末标点（. ! ?）之后
- 主句落地、补充解释之前
- 原因/解释引导词之前：because, which, who, that, so, meaning, so that, if, when, to + 目的
- 并列/转折词之前：and, but，尤其是后半句是完整新想法时
- 列举变长时，清单单独成块，评价或结论再单独成块
- 并列动词堆叠时，拆成两到三口气
- 较长的句子如果内部有明显逗号停顿、或出现 which/that/because 等从句引导词，可以在那里考虑再切一刀，但不是必须

严禁切在这些位置：
- 不要把功能词挂在 chunk 结尾：and, but, to, of, between, with, for, in, on, at
- 不要切出无意义的碎片
- 固定搭配内部：a lot of, in order to, pick up 等
- 名词短语内部、动词短语内部
- 介词和宾语之间

特殊处理：
- 口语引子词（Today, In fact, Maybe, Actually）通常和后面连在一起
- 回应词（Yeah, No, Well, Okay）可以单独成块

输出格式：{"cuts": [9, 18, 25, ...]}
cuts 是切分点数组，每个数字表示"在此编号的词之后切分"。
切分点必须是 1 到总词数-1 之间的整数，严格递增。
只输出 JSON，不要 markdown，不要解释。
"""

CHUNK_OUTPUT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "cuts": {
            "type": "array",
            "items": {"type": "integer"},
        }
    },
    "required": ["cuts"],
    "additionalProperties": False,
}


def clean_text(value: str) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    return " ".join(text.split())


def load_app_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_app_config(data: dict):
    APP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_saved_output_dir() -> str:
    default_dir = Path.cwd() / "Downloads"
    data = load_app_config()
    saved_dir = str(data.get("last_output_dir", "")).strip()
    if saved_dir and Path(saved_dir).exists():
        return saved_dir

    return str(default_dir)


def save_output_dir(path: str):
    data = load_app_config()
    data["last_output_dir"] = path
    save_app_config(data)


def load_saved_gemini_model() -> str:
    model_name = str(load_app_config().get("gemini_model", "")).strip()
    return model_name or DEFAULT_GEMINI_MODEL


def save_gemini_model(model_name: str):
    data = load_app_config()
    data["gemini_model"] = str(model_name).strip()
    save_app_config(data)


def load_saved_gemini_base_url() -> str:
    saved = str(load_app_config().get("gemini_base_url", "")).strip()
    return saved or DEFAULT_GEMINI_BASE_URL


def save_gemini_base_url(base_url: str):
    data = load_app_config()
    data["gemini_base_url"] = str(base_url).strip()
    save_app_config(data)


def apply_proxy_settings():
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ[key] = CLASH_PROXY


def print_yellow_warning(message: str):
    print(f"\033[33mWARNING: {message}\033[0m")


# Formal primary-path language service boundary wrappers.
def build_request_fingerprint(model_name, system_prompt, payload_obj, extra_config=None):
    return language_service_boundary.build_request_fingerprint(
        model_name,
        system_prompt,
        payload_obj,
        extra_config=extra_config,
    )


def request_gemini_with_cache(model_name, system_prompt, payload_obj, extra_config=None, log_func=None, log_prefix="Gemini"):
    return language_service_boundary.request_gemini_with_cache(
        GEMINI_CACHE_DIR,
        model_name,
        system_prompt,
        payload_obj,
        extra_config=extra_config,
        log_func=log_func,
        log_prefix=log_prefix,
    )


def classify_runtime_error_message(error: Exception) -> str:
    text = clean_text(str(error)).lower()

    if any(keyword in text for keyword in (
        "server disconnected without sending a response",
        "connection reset",
        "connection aborted",
        "connection refused",
        "timed out",
        "timeout",
        "temporary failure",
        "name or service not known",
        "nodename nor servname provided",
        "network is unreachable",
        "proxy",
        "tls",
        "ssl",
    )):
        return "检测到网络或代理连接异常。请先检查当前网络、VPN/代理（如 Clash）是否稳定，再重试。"

    if "resource_exhausted" in text or "quota" in text or "429" in text:
        return "检测到 API 配额或频率限制问题。请检查 Gemini 配额、计费状态或稍后再试。"

    if "jsondecodeerror" in text or "extra data" in text or "expecting value" in text:
        return "检测到模型返回的 JSON 格式异常。可以查看 raw_response 文件进一步排查。"

    if "api key" in text or "permission denied" in text or "unauthorized" in text or "403" in text or "401" in text:
        return "检测到 API 权限问题。请检查 Gemini API Key 是否正确、是否可用。"

    return ""


# Formal primary-path chunk adapter boundary wrapper.
def build_gemini_input_json(raw_json_path: Path, output_json_path: Path):
    return chunk_adapter_boundary.build_gemini_input_files(
        raw_json_path,
        output_json_path,
        build_spoken_chunks_from_whisperx_json,
    )


def build_cloze_input_text(raw_json_path: Path) -> str:
    raw_data = json.loads(raw_json_path.read_text(encoding="utf-8"))
    spoken_chunks = build_spoken_chunks_from_whisperx_json(raw_data, language="en")
    parts = [str(chunk.get("chunk_text", "")).strip() for chunk in spoken_chunks]
    return " ".join(part for part in parts if part)


# Legacy non-primary token/cuts path retained for compatibility and future cleanup.
SUBORDINATORS = {"if", "when", "while", "because", "although", "though", "once", "since", "unless"}
CLAUSE_TRANSITIONS = {"but", "and", "so", "yet"}
RESULT_EXTENDERS = {"causing", "making", "leaving", "changing", "allowing", "preserving", "removing"}
WEAK_ENDINGS = {"and", "but", "to", "of", "with", "for", "in", "on", "at", "or", "a", "an", "the"}
LOW_VALUE_WORDS = {
    "about", "really", "very", "just", "the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "but",
    "so", "then", "also", "still", "more", "most", "much", "many", "thing", "things",
}
STOPWORDS = LOW_VALUE_WORDS | {
    "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "you",
    "your", "we", "our", "they", "their", "he", "she", "his", "her", "them", "as", "by", "from", "into",
    "than", "too", "not", "do", "does", "did", "can", "could", "will", "would", "should", "have", "has",
    "had", "there", "here", "what", "why", "how", "who", "which",
}
PHRASAL_PARTICLES = {
    "up", "out", "off", "down", "in", "on", "over", "away", "back", "through", "around", "into", "along",
}
COMMON_VERBS = {
    "make", "makes", "made", "take", "takes", "took", "get", "gets", "got", "keep", "keeps", "kept", "turn",
    "turns", "turned", "look", "looks", "looked", "work", "works", "worked", "leave", "leaves", "left",
    "end", "ends", "ended",
    "break", "breaks", "broke", "slow", "slows", "slowed", "help", "helps", "helped", "move", "moves",
    "moved", "hold", "holds", "held", "show", "shows", "showed", "stay", "stays", "stayed",
}


def normalize_token(token: str) -> str:
    return re.sub(r"^[^A-Za-z0-9']+|[^A-Za-z0-9']+$", "", str(token).lower())


def join_tokens(tokens: list[str], a: int, b: int) -> str:
    return " ".join(tokens[a - 1 : b])


def token_has_clause_punct(token: str) -> bool:
    return str(token).endswith((",", ";", ":"))


def tokenize_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", text)


def normalize_article_text(text: str) -> str:
    cleaned = clean_text(text)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    return cleaned


def split_text_into_sentences(text: str) -> list[str]:
    normalized = normalize_article_text(text)
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if part.strip()]


def is_noisy_sentence(sentence: str) -> bool:
    if not sentence.strip():
        return True
    alpha = sum(ch.isalpha() for ch in sentence)
    weird = sum(not (ch.isalnum() or ch.isspace() or ch in ".,;:!?'-\"()[]") for ch in sentence)
    words = tokenize_words(sentence)
    if alpha < 8 or len(words) < 4:
        return True
    return weird > max(2, len(sentence) // 20)


def contains_strong_split_signal(tokens: list[str]) -> bool:
    for idx in range(1, len(tokens)):
        prev = tokens[idx - 1]
        nxt = normalize_token(tokens[idx])
        if token_has_clause_punct(prev):
            return True
        if nxt in SUBORDINATORS or nxt in RESULT_EXTENDERS:
            return True
        if nxt in CLAUSE_TRANSITIONS and len(tokens) >= 10:
            return True
    return False


def score_split_point(tokens: list[str], boundary: int, start: int, end: int, aggressive: bool = False) -> int:
    prev = tokens[boundary - 1]
    nxt = tokens[boundary]
    prev_norm = normalize_token(prev)
    next_norm = normalize_token(nxt)
    left_len = boundary - start
    right_len = end - boundary
    score = 0

    if token_has_clause_punct(prev):
        score += 4
    if next_norm in SUBORDINATORS:
        score += 4
    if next_norm in RESULT_EXTENDERS:
        score += 4
    if next_norm in CLAUSE_TRANSITIONS and left_len >= 3 and right_len >= 3:
        score += 3
    if left_len >= 7 and right_len >= 4:
        score += 1
    if aggressive and left_len >= 5 and right_len >= 4:
        score += 1
    if prev_norm in WEAK_ENDINGS:
        score -= 3
    if next_norm == "":
        score -= 2
    return score


def choose_fallback_boundary(start: int, end: int) -> int:
    length = end - start
    return start + max(3, min(length - 3, length // 2))


def split_segment_tokens(tokens: list[str], aggressive: bool = False) -> list[tuple[int, int]]:
    if not tokens:
        return []

    min_len = 2 if aggressive else 3
    soft_max = 8 if aggressive else 10

    def recurse(start: int, end: int) -> list[tuple[int, int]]:
        length = end - start
        if length <= 6:
            return [(start + 1, end)]

        candidate_boundaries = []
        for boundary in range(start + min_len, end - min_len + 1):
            score = score_split_point(tokens, boundary, start, end, aggressive=aggressive)
            candidate_boundaries.append((score, boundary))

        candidate_boundaries.sort(key=lambda item: (item[0], -abs((item[1] - start) - (length / 2))), reverse=True)
        best_score, best_boundary = candidate_boundaries[0] if candidate_boundaries else (-99, None)

        must_split = length >= 14 and contains_strong_split_signal(tokens[start:end])
        too_long = length > soft_max + 2
        if best_boundary is None:
            if too_long:
                best_boundary = choose_fallback_boundary(start, end)
            else:
                return [(start + 1, end)]
        elif not must_split and not too_long and best_score < 3:
            return [(start + 1, end)]
        elif (must_split or too_long) and best_score < 1:
            best_boundary = choose_fallback_boundary(start, end)

        if best_boundary - start < min_len or end - best_boundary < min_len:
            return [(start + 1, end)]

        return recurse(start, best_boundary) + recurse(best_boundary, end)

    spans = recurse(0, len(tokens))
    if len(tokens) >= 14 and len(spans) == 1 and contains_strong_split_signal(tokens):
        boundary = choose_fallback_boundary(0, len(tokens))
        spans = [(1, boundary), (boundary + 1, len(tokens))]
    return spans


def build_chunk_plan(input_data: dict, aggressive: bool = False, segment_ids: set[int] | None = None) -> dict:
    segments = []
    for item in input_data.get("s", []):
        segment_id = item.get("id")
        if segment_ids is not None and segment_id not in segment_ids:
            continue
        tokens = [str(token) for token in item.get("w", [])]
        spans = split_segment_tokens(tokens, aggressive=aggressive)
        chunks = [{"a": a, "b": b, "en": join_tokens(tokens, a, b), "zh": ""} for a, b in spans]
        segments.append({"id": segment_id, "chunks": chunks})
    return {"s": segments}


def merge_chunk_zh(plan: dict, response_data: dict) -> dict:
    response_by_id = {
        item.get("id"): item
        for item in response_data.get("s", [])
        if isinstance(item, dict)
    }
    merged_segments = []
    for segment in plan.get("s", []):
        response_segment = response_by_id.get(segment.get("id"), {})
        response_chunks = response_segment.get("chunks", []) if isinstance(response_segment, dict) else []
        merged_chunks = []
        for idx, chunk in enumerate(segment.get("chunks", [])):
            zh = ""
            if idx < len(response_chunks) and isinstance(response_chunks[idx], dict):
                zh = clean_text(response_chunks[idx].get("zh", ""))
            merged_chunks.append(
                {
                    "a": chunk["a"],
                    "b": chunk["b"],
                    "en": chunk["en"],
                    "zh": zh,
                }
            )
        merged_segments.append({"id": segment.get("id"), "chunks": merged_chunks})
    return {"s": merged_segments}


def build_chunks_from_cuts(segment_input, cuts, zh_list):
    tokens = [str(token) for token in segment_input.get("w", [])]
    if not all(isinstance(cut, int) for cut in cuts):
        raise ValueError("cuts 必须全部是 int。")
    if any(cuts[idx] >= cuts[idx + 1] for idx in range(len(cuts) - 1)):
        raise ValueError("cuts 必须严格递增，且不能重复。")
    if any(cut < 1 or cut >= len(tokens) for cut in cuts):
        raise ValueError("cuts 只能取 1 到 N-1，不能包含 0 或最后一个 token 位置 N。")
    chunk_ends = list(cuts) + [len(tokens)]
    chunks = []
    start = 1
    for idx, end in enumerate(chunk_ends):
        chunks.append(
            {
                "a": start,
                "b": end,
                "en": join_tokens(tokens, start, end),
                "zh": str(zh_list[idx]).strip(),
            }
        )
        start = end + 1
    return chunks


def validate_cut_and_zh_response(input_data, output_data):
    if not isinstance(output_data, dict):
        return False, "output_data 不是 dict。"

    output_segments = output_data.get("s")
    input_segments = input_data.get("s", [])
    if not isinstance(output_segments, list):
        return False, "output_data['s'] 不存在或不是 list。"
    if len(output_segments) != len(input_segments):
        return False, f"segment 数量不一致。input={len(input_segments)} output={len(output_segments)}"

    for input_segment, output_segment in zip(input_segments, output_segments):
        segment_id = input_segment.get("id")
        tokens = [str(token) for token in input_segment.get("w", [])]
        if not isinstance(output_segment, dict):
            return False, f"segment_id={segment_id} 不是对象。"
        if output_segment.get("id") != segment_id:
            return False, f"segment_id 不一致。input={segment_id} output={output_segment.get('id')}"

        cuts = output_segment.get("cuts", [])
        zh_list = output_segment.get("zh_list", [])
        if not isinstance(cuts, list):
            return False, f"segment_id={segment_id} 的 cuts 不是 list。"
        if not all(isinstance(cut, int) for cut in cuts):
            return False, f"segment_id={segment_id} 的 cuts 含非整数值。"
        if any(cuts[idx] >= cuts[idx + 1] for idx in range(len(cuts) - 1)):
            return False, f"segment_id={segment_id} 的 cuts 不是严格递增。cuts={cuts}"
        if any(cut <= 0 or cut >= len(tokens) for cut in cuts):
            return False, f"segment_id={segment_id} 的 cuts 越界。cuts={cuts} token_count={len(tokens)}"

        if not isinstance(zh_list, list):
            return False, f"segment_id={segment_id} 的 zh_list 不是 list。"
        if len(cuts) + 1 != len(zh_list):
            return False, f"segment_id={segment_id} 的 cuts 和 zh_list 数量不匹配。cuts={cuts} zh_count={len(zh_list)}"
        for chunk_index, zh in enumerate(zh_list):
            if not isinstance(zh, str) or not zh.strip():
                return False, f"segment_id={segment_id} chunk_index={chunk_index} 的 zh 为空。zh={zh!r}"

        start = 1
        for end in list(cuts) + [len(tokens)]:
            if end < start or end > len(tokens):
                return False, f"segment_id={segment_id} 的 cuts 无法完整覆盖 token。cuts={cuts}"
            start = end + 1
        if start != len(tokens) + 1:
            return False, f"segment_id={segment_id} 的 cuts 无法完整覆盖 token。cuts={cuts}"

    return True, "ok"


def validate_zh_only_result(input_data, output_data):
    return language_service_boundary.validate_zh_only_result(input_data, output_data)


def build_repair_queue(input_data, output_data, rescued_segments=None):
    return language_service_boundary.build_repair_queue(
        input_data,
        output_data,
        rescued_segments=rescued_segments,
    )


def build_output_audit(input_data, output_data):
    return language_service_boundary.build_output_audit(input_data, output_data)


def normalize_cut_and_zh_lengths(segment_id, cuts, zh_list):
    expected_count = len(cuts) + 1
    if len(zh_list) == expected_count:
        return {
            "normalized_zh_list": zh_list,
            "rescued": False,
            "reason": "",
        }
    if len(zh_list) == len(cuts):
        return {
            "normalized_zh_list": list(zh_list) + [""],
            "rescued": True,
            "reason": "missing_last_zh_autofilled",
        }
    return {
        "normalized_zh_list": zh_list,
        "rescued": False,
        "reason": "",
    }


def extract_first_complete_json(raw_text):
    return language_service_boundary.extract_first_complete_json(raw_text)


def strip_markdown_json_fence(raw_text: str) -> str:
    return language_service_boundary.strip_markdown_json_fence(raw_text)


def lightly_repair_json_text(raw_text: str) -> str:
    return language_service_boundary.lightly_repair_json_text(raw_text)


def build_json_error_context(raw_text: str, error: json.JSONDecodeError) -> str:
    return language_service_boundary.build_json_error_context(raw_text, error)


def parse_json_with_light_repair(raw_text: str, log_func=None, log_prefix="JSON"):
    return language_service_boundary.parse_json_with_light_repair(
        raw_text,
        log_func=log_func,
        log_prefix=log_prefix,
    )


def generate_zh_for_chunks(
    chunk_plan: dict,
    model_name: str,
    api_key: str,
    base_url: str,
    prompt: str,
    raw_response_path: Path | None = None,
    invalid_output_path: Path | None = None,
    repair_queue_path: Path | None = None,
    audit_output_path: Path | None = None,
    log_func=None,
    log_prefix="主任务",
) -> dict:
    return language_service_boundary.generate_zh_for_chunks(
        GEMINI_CACHE_DIR,
        model_name,
        chunk_plan,
        api_key,
        base_url,
        prompt,
        main_output_json_schema=MAIN_OUTPUT_JSON_SCHEMA,
        raw_response_path=raw_response_path,
        invalid_output_path=invalid_output_path,
        repair_queue_path=repair_queue_path,
        audit_output_path=audit_output_path,
        log_func=log_func,
        log_prefix=log_prefix,
        before_request=apply_proxy_settings,
    )


def replace_segments(base_output: dict, replacement_output: dict) -> dict:
    replacement_by_id = {item.get("id"): item for item in replacement_output.get("s", []) if isinstance(item, dict)}
    merged = []
    for segment in base_output.get("s", []):
        merged.append(replacement_by_id.get(segment.get("id"), segment))
    return {"s": merged}


def validate_output_density(input_data: dict, output_data: dict) -> dict:
    failed_segment_ids = []
    under_split_ids = []
    total_chunks = 0

    output_by_id = {item.get("id"): item for item in output_data.get("s", []) if isinstance(item, dict)}
    for input_item in input_data.get("s", []):
        segment_id = input_item.get("id")
        input_chunks = input_item.get("chunks", [])
        output_segment = output_by_id.get(segment_id)
        if not isinstance(output_segment, dict):
            failed_segment_ids.append(segment_id)
            continue

        chunks = output_segment.get("chunks", [])
        if not isinstance(chunks, list) or not chunks or not isinstance(input_chunks, list) or not input_chunks:
            failed_segment_ids.append(segment_id)
            continue

        total_chunks += len(chunks)
        segment_failed = False

        if len(chunks) != len(input_chunks):
            failed_segment_ids.append(segment_id)
            continue

        for input_chunk, output_chunk in zip(input_chunks, chunks):
            if output_chunk.get("a") != input_chunk.get("a"):
                segment_failed = True
                break
            if output_chunk.get("b") != input_chunk.get("b"):
                segment_failed = True
                break
            if output_chunk.get("en") != input_chunk.get("en"):
                segment_failed = True
                break
            zh = output_chunk.get("zh")
            if not isinstance(zh, str) or not zh.strip():
                segment_failed = True
                break

        if segment_failed:
            failed_segment_ids.append(segment_id)
            continue

    total_segments = len(input_data.get("s", []))
    avg_chunks = (total_chunks / total_segments) if total_segments else 0
    unacceptable = bool(failed_segment_ids)
    return {
        "pass": not unacceptable,
        "failed_segment_ids": failed_segment_ids,
        "under_split_segment_ids": under_split_ids,
        "summary": {
            "total_segments": total_segments,
            "total_chunks": total_chunks,
            "avg_chunks_per_segment": round(avg_chunks, 2),
            "under_split_count": len(under_split_ids),
        },
    }


def repair_failed_segments(
    input_data: dict,
    current_output: dict,
    model_name: str,
    api_key: str,
    base_url: str,
    segment_ids: set[int],
    output_json_path: Path,
    log_func=None,
) -> dict:
    if not segment_ids:
        return current_output
    repair_plan = build_chunk_plan(input_data, aggressive=True, segment_ids=segment_ids)
    repair_output = generate_zh_for_chunks(
        repair_plan,
        model_name,
        api_key,
        base_url,
        SYSTEM_PROMPT_ZH_REPAIR,
        raw_response_path=output_json_path.with_suffix(".repair.raw_response.txt"),
        log_func=log_func,
    )
    return replace_segments(current_output, repair_output)


def fallback_segments_with_code_chunks(
    input_data: dict,
    current_output: dict,
    model_name: str,
    api_key: str,
    base_url: str,
    segment_ids: set[int],
    output_json_path: Path,
    log_func=None,
) -> dict:
    if not segment_ids:
        return current_output
    fallback_plan = build_chunk_plan(input_data, aggressive=True, segment_ids=segment_ids)
    try:
        fallback_output = generate_zh_for_chunks(
            fallback_plan,
            model_name,
            api_key,
            base_url,
            SYSTEM_PROMPT_ZH_ONLY,
            raw_response_path=output_json_path.with_suffix(".fallback.raw_response.txt"),
            log_func=log_func,
        )
    except Exception:
        fallback_output = fallback_plan
    return replace_segments(current_output, fallback_output)


def classify_target_word_type(target_text: str) -> str:
    parts = [normalize_token(part) for part in target_text.split()]
    parts = [part for part in parts if part]
    if len(parts) >= 2 and any(part in PHRASAL_PARTICLES for part in parts[1:]):
        return "phrasal verb"
    if len(parts) >= 2:
        return "expression"
    return "verb" if parts and parts[0] in COMMON_VERBS else "expression"


def build_cloze_sentence(sentence: str, target_word: str) -> str:
    pattern = re.compile(re.escape(target_word), flags=re.IGNORECASE)
    return pattern.sub("________", sentence, count=1)


def build_article_statistics(sentences: list[str]) -> dict:
    word_counter = Counter()
    phrase_counter = Counter()
    for sentence in sentences:
        words = [normalize_token(token) for token in tokenize_words(sentence)]
        words = [word for word in words if word]
        for word in words:
            if word not in STOPWORDS and len(word) >= 4:
                word_counter[word] += 1
        for size in (2, 3):
            for idx in range(len(words) - size + 1):
                phrase = words[idx : idx + size]
                if any(token in STOPWORDS for token in phrase):
                    continue
                phrase_counter[" ".join(phrase)] += 1
    top_words = {word for word, _ in word_counter.most_common(20)}
    top_phrases = {phrase for phrase, count in phrase_counter.items() if count >= 2}
    return {"word_counter": word_counter, "phrase_counter": phrase_counter, "top_words": top_words, "top_phrases": top_phrases}


def extract_cloze_candidates(sentences: list[str]) -> list[dict]:
    stats = build_article_statistics(sentences)
    candidates = []
    for sentence_index, sentence in enumerate(sentences):
        if is_noisy_sentence(sentence):
            continue
        words = tokenize_words(sentence)
        lower_words = [normalize_token(word) for word in words]
        for idx in range(len(lower_words) - 1):
            first = lower_words[idx]
            second = lower_words[idx + 1]
            if first in COMMON_VERBS and second in PHRASAL_PARTICLES:
                phrase = f"{words[idx]} {words[idx + 1]}"
                candidates.append(
                    {
                        "source_sentence": sentence,
                        "sentence_index": sentence_index,
                        "target_word": phrase,
                        "word_type": "phrasal verb",
                        "candidate_type": "phrasal_verb",
                        "article_stats": stats,
                    }
                )
        for size in (3, 2):
            for idx in range(len(lower_words) - size + 1):
                surface = words[idx : idx + size]
                normalized = lower_words[idx : idx + size]
                if not all(normalized):
                    continue
                if all(token in STOPWORDS for token in normalized):
                    continue
                if normalized[0] in WEAK_ENDINGS or normalized[-1] in WEAK_ENDINGS:
                    continue
                phrase = " ".join(surface)
                candidates.append(
                    {
                        "source_sentence": sentence,
                        "sentence_index": sentence_index,
                        "target_word": phrase,
                        "word_type": "expression",
                        "candidate_type": "phrase",
                        "article_stats": stats,
                    }
                )
        for idx, word in enumerate(words):
            normalized = lower_words[idx]
            if not normalized or normalized in LOW_VALUE_WORDS or len(normalized) < 5:
                continue
            if word[:1].isupper() and idx != 0:
                continue
            candidates.append(
                {
                    "source_sentence": sentence,
                    "sentence_index": sentence_index,
                    "target_word": word,
                    "word_type": "expression",
                    "candidate_type": "single_word",
                    "article_stats": stats,
                }
            )
    return candidates


def score_cloze_candidate(candidate: dict) -> int:
    target = candidate["target_word"]
    normalized_target = " ".join(normalize_token(part) for part in target.split() if normalize_token(part))
    if not normalized_target:
        return -999
    target_tokens = normalized_target.split()
    if len(target_tokens) == 1 and target_tokens[0] in LOW_VALUE_WORDS:
        return -999
    if any(token.isdigit() for token in target_tokens):
        return -999

    stats = candidate["article_stats"]
    score = 0
    if candidate["candidate_type"] == "phrasal_verb":
        score += 3
    if len(target_tokens) >= 2:
        score += 3
    if normalized_target in stats["top_phrases"] or any(token in stats["top_words"] for token in target_tokens):
        score += 3
    if candidate["candidate_type"] != "single_word":
        score += 2
    if 1 <= len(target_tokens) <= 3:
        score += 1
    if len(candidate["source_sentence"]) > 120:
        score -= 1
    if any(token in LOW_VALUE_WORDS for token in target_tokens):
        score -= 2
    return score


def select_best_cloze_items(candidates: list[dict], n: int = 10) -> list[dict]:
    ranked = []
    for candidate in candidates:
        score = score_cloze_candidate(candidate)
        if score <= 0:
            continue
        target_word = candidate["target_word"]
        cloze_sentence = build_cloze_sentence(candidate["source_sentence"], target_word)
        if cloze_sentence == candidate["source_sentence"]:
            continue
        ranked.append(
            {
                "source_sentence": candidate["source_sentence"],
                "chinese_translation": "",
                "cloze_sentence": cloze_sentence,
                "target_word": target_word,
                "word_type": classify_target_word_type(target_word),
                "reasoning": "",
                "sentence_index": candidate["sentence_index"],
                "score": score,
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    selected = []
    used_targets = set()
    used_sentence_indexes = []
    for item in ranked:
        normalized_target = " ".join(normalize_token(part) for part in item["target_word"].split() if normalize_token(part))
        if normalized_target in used_targets:
            continue
        if any(abs(item["sentence_index"] - used_idx) <= 1 for used_idx in used_sentence_indexes):
            continue
        selected.append({key: value for key, value in item.items() if key not in {"sentence_index", "score"}})
        used_targets.add(normalized_target)
        used_sentence_indexes.append(item["sentence_index"])
        if len(selected) >= n:
            break
    return selected


def score_filtered_cloze_candidate(item: dict) -> int:
    target_word = str(item.get("target_word", "")).strip()
    source_sentence = str(item.get("source_sentence", "")).strip()
    word_type = str(item.get("word_type", "")).strip().lower()
    normalized_target = " ".join(normalize_token(part) for part in target_word.split() if normalize_token(part))
    target_tokens = normalized_target.split()
    sentence_tokens = [normalize_token(token) for token in tokenize_words(source_sentence)]
    score = 0

    if word_type == "phrasal verb":
        score += 4
    elif word_type == "expression":
        score += 2
    elif word_type == "verb":
        score += 1

    if len(target_tokens) >= 2:
        score += 3
    elif len(target_tokens) == 1 and len(target_tokens[0]) >= 5:
        score += 1

    if any(token in {"if", "when", "while", "because", "once", "so", "but", "then"} for token in target_tokens):
        score += 2
    if any(token in PHRASAL_PARTICLES for token in target_tokens):
        score += 2
    if any(token in COMMON_VERBS for token in target_tokens):
        score += 1

    if not target_tokens:
        score -= 10
    if all(token in STOPWORDS for token in target_tokens):
        score -= 8
    if len(target_tokens) == 1 and target_tokens[0] in LOW_VALUE_WORDS:
        score -= 8
    if len(target_tokens) == 1 and len(target_tokens[0]) <= 3:
        score -= 3

    if sentence_tokens[: len(target_tokens)] == target_tokens and len(target_tokens) >= 2:
        score -= 3
    if normalized_target.startswith(("what ", "which ", "this ", "that ")):
        score -= 4
    if len(target_tokens) == 2 and target_tokens[0] not in COMMON_VERBS and target_tokens[1] not in PHRASAL_PARTICLES:
        score -= 2

    return score


def filter_cloze_candidates(candidates):
    scored = []
    for index, item in enumerate(candidates):
        scored.append((score_filtered_cloze_candidate(item), index, item))

    scored.sort(key=lambda row: (row[0], -row[1]), reverse=True)
    preferred = [item for score, _, item in scored if score >= 1]
    if len(preferred) >= len(candidates):
        return preferred[: len(candidates)]

    seen = {id(item) for item in preferred}
    fallback = [item for _, _, item in scored if id(item) not in seen]
    return (preferred + fallback)[: len(candidates)]


def find_chunk_span(tokens: list[str], target_tokens: list[str], start_1based: int):
    if not target_tokens:
        return None

    start_index = max(0, start_1based - 1)
    exact_end = start_index + len(target_tokens)
    if exact_end <= len(tokens) and tokens[start_index:exact_end] == target_tokens:
        return start_index + 1, exact_end

    max_start = len(tokens) - len(target_tokens) + 1
    for idx in range(start_index, max_start):
        if tokens[idx : idx + len(target_tokens)] == target_tokens:
            return idx + 1, idx + len(target_tokens)

    return None


def repair_gemini_output(input_data: dict, output_data: dict):
    input_segments = input_data.get("s", [])
    output_segments = output_data.get("s", [])

    if len(input_segments) != len(output_segments):
        print_yellow_warning(
            f"Gemini 输出的 segment 数量({len(output_segments)})和 input.json({len(input_segments)})不一致。"
        )

    for input_item, output_item in zip(input_segments, output_segments):
        expected_id = input_item.get("id")
        actual_id = output_item.get("id")
        if expected_id != actual_id:
            print_yellow_warning(f"id 不匹配，期望 {expected_id}，实际 {actual_id}。")

        tokens = [str(token) for token in input_item.get("w", [])]
        chunks = output_item.get("chunks", [])
        if not tokens:
            if chunks:
                print_yellow_warning(f"id={expected_id} 的 w 为空，但 Gemini 返回了 chunks。")
            continue
        if not chunks:
            print_yellow_warning(f"id={expected_id} 缺少 chunks。")
            continue

        expected_start = 1
        for chunk in chunks:
            raw_a = chunk.get("a", expected_start)
            raw_b = chunk.get("b", raw_a if isinstance(raw_a, int) else expected_start)
            en = str(chunk.get("en", "")).strip()
            zh = chunk.get("zh")

            if not isinstance(raw_a, int) or not isinstance(raw_b, int):
                print_yellow_warning(f"id={expected_id} 的 chunk a/b 不是整数，已改用顺序修复。")
                raw_a = expected_start
                raw_b = raw_a

            if en:
                matched_span = find_chunk_span(tokens, en.split(), expected_start)
                if matched_span is None:
                    matched_span = find_chunk_span(tokens, en.split(), raw_a)

                if matched_span is not None:
                    fixed_a, fixed_b = matched_span
                    if (fixed_a, fixed_b) != (raw_a, raw_b):
                        print_yellow_warning(
                            f"id={expected_id} 的 chunk 索引已自动修复: ({raw_a}, {raw_b}) -> ({fixed_a}, {fixed_b})"
                        )
                    a, b = fixed_a, fixed_b
                    en = " ".join(tokens[a - 1 : b])
                else:
                    print_yellow_warning(
                        f"id={expected_id} 的 chunk 无法根据 en 自动定位，保留原区间。"
                    )
                    a = max(expected_start, min(raw_a, len(tokens)))
                    b = max(a, min(raw_b, len(tokens)))
                    en = " ".join(tokens[a - 1 : b])
            else:
                a = expected_start
                b = a
                en = " ".join(tokens[a - 1 : b])
                print_yellow_warning(f"id={expected_id} 的 chunk 缺少 en，已按顺序回填。")

            if not isinstance(zh, str):
                zh = "" if zh is None else str(zh)

            chunk["a"] = a
            chunk["b"] = b
            chunk["en"] = en
            chunk["zh"] = zh
            expected_start = b + 1

        if expected_start != len(tokens) + 1:
            print_yellow_warning(f"id={expected_id} 的 chunks 没有完整覆盖全部 tokens。")

    return output_data


def validate_cloze_exercises(cloze_exercises):
    return language_service_boundary.validate_cloze_exercises(cloze_exercises)


# Formal primary-path main subtitle generation entry.
def process_subtitle_with_gemini(input_json_path, output_json_path, model_name, api_key, base_url="", need_cloze=False, log_func=None):
    input_path = Path(input_json_path)
    output_path = Path(output_json_path)
    repair_queue_path = output_path.with_name("repair_queue.json")
    audit_output_path = output_path.with_name("output.audit.json")

    if not api_key or not str(api_key).strip():
        raise ValueError("Gemini API Key 为空。")
    if not input_path.exists():
        raise FileNotFoundError(f"未找到输入 JSON: {input_path}")
    if output_path.exists() and not ALLOW_MAIN_API_RERUN:
        if log_func is not None:
            log_func("已检测到正式 output.json，且 ALLOW_MAIN_API_RERUN=False，本次跳过主任务 API 调用。")
        return {
            "pass": True,
            "failed_segment_ids": [],
            "under_split_segment_ids": [],
            "summary": {
                "total_segments": 0,
                "total_chunks": 0,
                "avg_chunks_per_segment": 0,
                "under_split_count": 0,
            },
        }
    if log_func is not None:
        log_func("允许继续执行主任务 API。")

    apply_proxy_settings()
    input_data = json.loads(input_path.read_text(encoding="utf-8"))
    repair_queue_path.write_text(
        json.dumps([], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    audit_output_path.write_text(
        json.dumps([], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    output_data = generate_zh_for_chunks(
        input_data,
        model_name,
        api_key,
        base_url,
        SYSTEM_PROMPT_ZH_ONLY,
        raw_response_path=output_path.with_suffix(".raw.txt"),
        invalid_output_path=output_path.with_suffix(".invalid.json"),
        repair_queue_path=repair_queue_path,
        audit_output_path=audit_output_path,
        log_func=log_func,
        log_prefix="主任务",
    )
    validation = validate_output_density(input_data, output_data)

    if validation["failed_segment_ids"]:
        raise RuntimeError(f"主任务仍有未修复 segment: {validation['failed_segment_ids']}")

    output_path.write_text(
        json.dumps({"s": output_data.get("s", [])}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return validation


# Formal primary-path cloze generation entry.
def process_cloze_with_gemini(cloze_input_text, output_json_path, model_name, api_key, base_url="", log_func=None):
    output_path = Path(output_json_path)
    cloze_output_path = output_path.with_suffix(".cloze.json")
    raw_response_path = output_path.with_suffix(".cloze.raw_response.txt")

    if not api_key or not str(api_key).strip():
        raise ValueError("Gemini API Key 为空。")

    article_text = normalize_article_text(str(cloze_input_text))
    sentences = split_text_into_sentences(article_text)
    candidates = extract_cloze_candidates(sentences)
    selected_items = select_best_cloze_items(candidates, n=10)
    if log_func is not None:
        log_func(f"cloze：原始 candidates 数量：{len(selected_items)}")
    selected_items = filter_cloze_candidates(selected_items)
    if log_func is not None:
        log_func(f"cloze：过滤后 candidates 数量：{len(selected_items)}")
        log_func("cloze：已按训练价值完成本地排序")
    if not selected_items:
        cloze_output_path.write_text("[]", encoding="utf-8")
        return []

    apply_proxy_settings()
    payload = {
        "article_text": article_text,
        "selected_candidates": selected_items,
    }
    response_text = request_gemini_with_cache(
        model_name,
        SYSTEM_PROMPT_CLOZE,
        payload,
        extra_config={
            "api_key": api_key.strip(),
            "base_url": str(base_url or "").strip(),
            "response_mime_type": "application/json",
            "temperature": 0.1,
        },
        log_func=log_func,
        log_prefix="cloze",
    )
    if not response_text:
        raise RuntimeError("Gemini 没有返回填空题文本内容。")

    try:
        response_data = parse_json_with_light_repair(response_text, log_func=log_func, log_prefix="cloze")
    except Exception:
        raw_response_path.write_text(response_text, encoding="utf-8")
        raise
    if log_func is not None:
        log_func("cloze：JSON 解析成功")

    validated = validate_cloze_exercises(response_data)
    if validated == [] and response_data != []:
        print_yellow_warning("cloze_exercises 结构非法，已降级为 [].")
        if log_func is not None:
            log_func("cloze：业务校验失败：cloze_exercises 结构非法，已降级为 []。")
    elif log_func is not None:
        log_func("cloze：业务校验成功")

    response_by_target = {
        str(item.get("target_word", "")): item
        for item in validated
        if isinstance(item, dict)
    }
    merged_items = []
    for item in selected_items:
        response_item = response_by_target.get(item["target_word"], {})
        merged_items.append(
            {
                "source_sentence": item["source_sentence"],
                "chinese_translation": clean_text(response_item.get("chinese_translation", "")),
                "cloze_sentence": item["cloze_sentence"],
                "target_word": item["target_word"],
                "word_type": item["word_type"],
                "reasoning": clean_text(response_item.get("reasoning", "")),
            }
        )

    cloze_output_path.write_text(
        json.dumps(merged_items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return merged_items


def build_chunks_with_gemini(
    raw_json_path: Path,
    output_json_path: Path,
    model_name: str,
    api_key: str,
    base_url: str,
    log_func=None,
) -> str:
    raw_data = json.loads(raw_json_path.read_text(encoding="utf-8"))
    words = extract_words_from_whisperx_json(raw_data)

    if not words:
        raise ValueError("WhisperX 数据中没有找到词。")

    total_words = len(words)

    word_parts = []
    for i, word in enumerate(words):
        idx = i + 1
        text = str(word.get("word", "")).strip()
        word_parts.append(f"[{idx}] {text}")

    word_list_text = " ".join(word_parts)

    if log_func:
        log_func(f"语块切分：共 {total_words} 个词，已构建词列表发送给 Gemini。")

    apply_proxy_settings()

    response_text = request_gemini_with_cache(
        model_name,
        SYSTEM_PROMPT_CHUNK,
        json.dumps({
            "total_words": total_words,
            "word_list": word_list_text,
        }, ensure_ascii=False),
        extra_config={
            "api_key": api_key.strip(),
            "base_url": str(base_url or "").strip(),
            "response_mime_type": "application/json",
            "response_json_schema": CHUNK_OUTPUT_JSON_SCHEMA,
            "temperature": 0.0,
        },
        log_func=log_func,
        log_prefix="语块切分",
    )

    if not response_text:
        raise RuntimeError("Gemini 没有返回语块切分结果。")

    try:
        response_data = parse_json_with_light_repair(
            response_text,
            log_func=log_func,
            log_prefix="语块切分",
        )
    except Exception:
        if log_func:
            log_func("语块切分：JSON 解析失败")
        raise

    raw_cuts = response_data.get("cuts", [])
    if not isinstance(raw_cuts, list):
        raise RuntimeError(f"Gemini 返回的 cuts 格式不正确：{raw_cuts!r}")

    valid_cuts = []
    for cut in raw_cuts:
        if isinstance(cut, int) and 1 <= cut < total_words:
            valid_cuts.append(cut)

    valid_cuts = sorted(set(valid_cuts))

    if log_func:
        log_func(f"语块切分：原始切分点 {raw_cuts}，有效切分点 {valid_cuts}")

    chunks = []
    chunk_ends = valid_cuts + [total_words]
    start = 1

    for end in chunk_ends:
        chunk_words = words[start - 1 : end]
        chunk_text = " ".join(
            str(w.get("word", "")).strip() for w in chunk_words
        )

        if not chunk_text.strip():
            if log_func:
                log_func(f"语块切分：警告 — chunk [{start}-{end}] 文本为空，已跳过")
            start = end + 1
            continue

        chunks.append({
            "a": start,
            "b": end,
            "en": chunk_text,
            "zh": "",
        })
        start = end + 1

    if not chunks:
        raise RuntimeError("语块切分：未能生成任何有效 chunk。")

    article_text = " ".join(
        str(w.get("word", "")).strip() for w in words
    )

    main_input = {"s": [{"id": 0, "chunks": chunks}]}
    output_json_path.with_name("input.json").write_text(
        json.dumps(main_input, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    debug_items = [
        {
            "chunk_text": c["en"],
            "a": c["a"],
            "b": c["b"],
            "word_count": c["b"] - c["a"] + 1,
        }
        for c in chunks
    ]
    output_json_path.with_name("chunk_debug.json").write_text(
        json.dumps(debug_items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if log_func:
        log_func(f"语块切分：完成，共 {len(chunks)} 个 chunk")
        avg_words = sum(c["b"] - c["a"] + 1 for c in chunks) / len(chunks)
        log_func(f"语块切分：平均每个 chunk {avg_words:.1f} 词")

    return article_text


class WorkerCommandRunner:
    def __init__(self, worker):
        self.worker = worker

    def run(self, cmd, source: str, emit_line, cancel_event=None):
        self.worker.run_command_streaming(cmd, source)

    def cancel(self):
        self.worker.stop_current_process()


class WorkerThread(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool, str)

    def __init__(
        self,
        url: str,
        base_dir: str,
        model_name: str,
        api_key: str,
        base_url: str,
        use_gemini: bool,
        need_cloze: bool = False,
    ):
        super().__init__()
        self.url = url
        self.base_dir = Path(base_dir)
        self.model_name = model_name.strip()
        self.api_key = api_key.strip()
        self.base_url = base_url.strip()
        self.use_gemini = use_gemini
        self.need_cloze = need_cloze
        self.current_process = None
        self.current_process_name = None
        self.stop_requested = False
        self.cancel_event = Event()
        self.gemini_called = False

    def log(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_signal.emit(f"[{timestamp}] {message}")

    def request_stop(self):
        self.stop_requested = True
        self.cancel_event.set()
        self.stop_current_process()

    def stop_current_process(self):
        process = self.current_process
        process_name = self.current_process_name or "外部命令"
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        except Exception:
            pass
        finally:
            self.current_process = None
            self.current_process_name = None

    def classify_whisperx_log(self, line: str) -> str:
        lower = line.lower()
        if "ffmpeg" in lower:
            return f"[ffmpeg] {line}"
        if "vad" in lower or "silero" in lower:
            return f"[vad] {line}"
        if "align" in lower:
            return f"[align] {line}"
        if "transcrib" in lower or "decode" in lower:
            return f"[transcribe] {line}"
        if "model" in lower or "cuda" in lower or "load" in lower:
            return f"[startup] {line}"
        return f"[whisperx] {line}"

    def run_command_streaming(self, cmd, source: str):
        if self.stop_requested:
            raise RuntimeError("任务已取消，未启动新的外部命令。")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self.current_process = process
        self.current_process_name = source

        assert process.stdout is not None
        for raw_line in process.stdout:
            if self.stop_requested:
                self.stop_current_process()
                raise RuntimeError(f"任务已取消，{source} 已停止。")

            line = raw_line.strip()
            if not line:
                continue

            if source == "yt-dlp":
                if "[download]" in line and "%" in line:
                    self.log(line)
                elif any(token in line for token in ("Destination:", "Extracting", "Merging", "Deleting original file")):
                    self.log(f"[yt-dlp] {line}")
                elif "error:" in line.lower() or "warning:" in line.lower():
                    self.log(f"[yt-dlp] {line}")
                elif "[youtube]" in line or "[generic]" in line:
                    self.log(f"[yt-dlp] {line}")
                continue

            if source == "whisperx":
                self.log(self.classify_whisperx_log(line))
                continue

            self.log(f"[{source}] {line}")

        process.wait()
        self.current_process = None
        self.current_process_name = None
        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, cmd)

    def run(self):
        success = False
        finish_message = ""
        try:
            self.gemini_called = self.use_gemini
            self.log("任务已开始。")
            runner = LocalWorkflowRunner(
                WorkflowConfig(
                    output_dir=self.base_dir,
                    yt_dlp_path=Path(YT_DLP_PATH),
                    whisperx_path=Path(WHISPERX_PATH),
                    cookies_path=COOKIES_PATH,
                    proxy_url=CLASH_PROXY,
                ),
                command_runner=WorkerCommandRunner(self),
            )
            manifest = runner.run(
                WorkflowRequest(
                    url=self.url,
                    gemini_mode="real" if self.use_gemini else "off",
                    api_key=self.api_key,
                    model=self.model_name,
                    base_url=self.base_url,
                    auto_open_when_ready=False,
                    replace_policy="ask",
                ),
                job_id=datetime.now().strftime("%Y%m%d%H%M%S"),
                emit=lambda event: self.log(event.get("message", "")),
                cancel_event=self.cancel_event,
            )
            finish_message = manifest.get("outputDir", "")
            self.log("全部处理完成。")
            success = True
        except subprocess.CalledProcessError as exc:
            self.log(f"外部命令执行失败: {exc}")
            finish_message = str(exc)
        except Exception as exc:
            self.log(f"发生错误: {exc}")
            hint = classify_runtime_error_message(exc)
            if hint:
                self.log(hint)
            finish_message = str(exc)
        finally:
            self.stop_current_process()
            self.log("任务已真正结束。")
            self.finished_signal.emit(success, finish_message)


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("YouTube 下载 / WhisperX / Gemini")
        self.resize(820, 620)
        self.task_in_progress = False
        self.start_guard = False

        layout = QVBoxLayout()

        url_layout = QHBoxLayout()
        url_layout.addWidget(QLabel("YouTube 链接:"))
        self.url_input = QLineEdit()
        url_layout.addWidget(self.url_input)
        layout.addLayout(url_layout)

        api_layout = QHBoxLayout()
        api_layout.addWidget(QLabel("Gemini API Key:"))
        self.api_key_input = QLineEdit()
        self.api_key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key_input.setText(DEFAULT_GEMINI_API_KEY)
        self.api_key_input.setPlaceholderText("输入 Gemini API Key，或预先设置 GEMINI_API_KEY 环境变量")
        api_layout.addWidget(self.api_key_input)
        layout.addLayout(api_layout)

        model_layout = QHBoxLayout()
        model_layout.addWidget(QLabel("Gemini 模型:"))
        self.model_input = QLineEdit()
        self.model_input.setText(load_saved_gemini_model())
        self.model_input.setPlaceholderText("例如: gemini-2.5-flash")
        model_layout.addWidget(self.model_input)
        layout.addLayout(model_layout)

        base_url_layout = QHBoxLayout()
        base_url_layout.addWidget(QLabel("Gemini URL:"))
        self.base_url_input = QLineEdit()
        self.base_url_input.setText(load_saved_gemini_base_url())
        self.base_url_input.setPlaceholderText("留空则使用 SDK 默认地址，可填代理/中转地址")
        base_url_layout.addWidget(self.base_url_input)
        layout.addLayout(base_url_layout)

        cloze_layout = QHBoxLayout()
        cloze_layout.addWidget(QLabel("附加输出:"))
        self.need_cloze_checkbox = QCheckBox("同时生成填空题")
        self.need_cloze_checkbox.setChecked(DEFAULT_NEED_CLOZE)
        cloze_layout.addWidget(self.need_cloze_checkbox)
        cloze_layout.addStretch()
        layout.addLayout(cloze_layout)

        path_layout = QHBoxLayout()
        path_layout.addWidget(QLabel("保存目录:"))
        self.path_input = QLineEdit()
        self.path_input.setReadOnly(True)
        self.path_input.setText(load_saved_output_dir())

        self.btn_browse = QPushButton("浏览...")
        self.btn_browse.clicked.connect(self.choose_directory)
        path_layout.addWidget(self.path_input)
        path_layout.addWidget(self.btn_browse)
        layout.addLayout(path_layout)

        self.btn_start = QPushButton("开始执行")
        self.btn_start.setFixedHeight(44)
        font = self.btn_start.font()
        font.setBold(True)
        self.btn_start.setFont(font)
        self.btn_start.clicked.connect(self.start_workflow)
        layout.addWidget(self.btn_start)

        layout.addWidget(QLabel("运行日志:"))
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setStyleSheet(
            "background-color: #1e1e1e; color: #d4d4d4; font-family: Consolas, 'Microsoft YaHei UI';"
        )
        layout.addWidget(self.log_output)

        self.setLayout(layout)
        self.worker = None

    def append_log(self, text: str):
        self.log_output.append(text)
        scrollbar = self.log_output.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def choose_directory(self):
        dir_path = QFileDialog.getExistingDirectory(self, "选择保存目录")
        if dir_path:
            self.path_input.setText(dir_path)
            save_output_dir(dir_path)

    def start_workflow(self):
        url = self.url_input.text().strip()
        base_dir = self.path_input.text().strip()
        model_name = self.model_input.text().strip()
        api_key = self.api_key_input.text().strip()
        base_url = self.base_url_input.text().strip()
        need_cloze = self.need_cloze_checkbox.isChecked()

        if self.start_guard or self.task_in_progress or (self.worker is not None and self.worker.isRunning()):
            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 已有任务正在运行，拒绝重复启动。")
            return
        self.start_guard = True

        if not url:
            self.start_guard = False
            QMessageBox.warning(self, "警告", "请输入 YouTube 链接。")
            return
        if not base_dir:
            self.start_guard = False
            QMessageBox.warning(self, "警告", "请选择保存目录。")
            return
        if api_key and not model_name:
            self.start_guard = False
            QMessageBox.warning(self, "警告", "已填写 Gemini API Key，但模型名称为空。")
            return

        use_gemini = bool(api_key)

        if need_cloze and not api_key:
            self.start_guard = False
            QMessageBox.warning(self, "警告", "你勾选了生成填空题，但还没有填写 Gemini API Key。")
            return

        save_output_dir(base_dir)
        save_gemini_model(model_name)
        save_gemini_base_url(base_url)

        self.task_in_progress = True
        self.start_guard = False
        self.btn_start.setEnabled(False)
        self.url_input.setEnabled(False)
        self.api_key_input.setEnabled(False)
        self.model_input.setEnabled(False)
        self.base_url_input.setEnabled(False)
        self.need_cloze_checkbox.setEnabled(False)
        self.btn_browse.setEnabled(False)
        self.log_output.clear()
        self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 开始处理: {url}")
        self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 任务状态已锁定，运行期间将拒绝重复启动。")
        self.append_log(
            f"[{datetime.now().strftime('%H:%M:%S')}] 本次填空题模式: {'开启' if need_cloze else '关闭'}"
        )
        self.append_log(
            f"[{datetime.now().strftime('%H:%M:%S')}] 本次 Gemini 模式: {'开启' if use_gemini else '关闭（未填写 API Key，仅生成本地文件）'}"
        )
        if use_gemini:
            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 本次 Gemini 模型: {model_name}")
            self.append_log(
                f"[{datetime.now().strftime('%H:%M:%S')}] 本次 Gemini URL: {base_url or 'SDK 默认'}"
            )

        self.worker = WorkerThread(
            url,
            base_dir,
            model_name,
            api_key,
            base_url,
            use_gemini,
            need_cloze=need_cloze,
        )
        self.worker.log_signal.connect(self.append_log)
        self.worker.finished_signal.connect(self.workflow_finished)
        self.worker.start()

    def workflow_finished(self, success: bool, msg: str):
        self.task_in_progress = False
        self.start_guard = False
        self.btn_start.setEnabled(True)
        self.url_input.setEnabled(True)
        self.api_key_input.setEnabled(True)
        self.model_input.setEnabled(True)
        self.base_url_input.setEnabled(True)
        self.need_cloze_checkbox.setEnabled(True)
        self.btn_browse.setEnabled(True)
        self.worker = None
        if success:
            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 任务结束，结果目录已打开。")
            os.startfile(msg)
        else:
            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 任务结束，状态已恢复。")
            QMessageBox.critical(self, "执行中断", "流程执行失败，请查看日志。")

    def closeEvent(self, event: QCloseEvent):
        if self.worker is not None and self.worker.isRunning():
            reply = QMessageBox.question(
                self,
                "任务仍在运行",
                "当前仍有任务在运行。关闭窗口会停止并清理 yt-dlp / whisperx 子进程。\n\n确认关闭吗？",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                event.ignore()
                self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 已取消关闭窗口，请等待当前任务完成。")
                return

            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 窗口关闭前检测到任务仍在运行，开始清理子进程。")
            self.btn_start.setEnabled(False)
            self.url_input.setEnabled(False)
            self.api_key_input.setEnabled(False)
            self.model_input.setEnabled(False)
            self.base_url_input.setEnabled(False)
            self.need_cloze_checkbox.setEnabled(False)
            self.btn_browse.setEnabled(False)
            self.worker.request_stop()
            if not self.worker.wait(8000):
                self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 线程尚未结束，已阻止关闭，请等待任务完全停止。")
                event.ignore()
                return

            self.append_log(f"[{datetime.now().strftime('%H:%M:%S')}] 窗口关闭前已完成子进程清理。")
            self.task_in_progress = False
            self.start_guard = False

        event.accept()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
