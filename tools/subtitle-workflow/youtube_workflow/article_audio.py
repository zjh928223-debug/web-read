"""Generate an article's continuous Aria track and word-aligned transcript."""
import hashlib
import html
import re
import shutil
import time
import unicodedata
import wave
from pathlib import Path

from .core import _write_json, load_json_file

VOICE = "en-US-AriaNeural"
RATE = "-5%"
SAMPLE_RATE = 24000


def check_canceled(cancel_event):
    if cancel_event.is_set():
        raise RuntimeError("任务已取消。")


def speech_ranges(transcript, chunk_data):
    """Keep AI boundaries, but let short clauses share a complete sentence."""
    words = [word for segment in transcript["segments"] for word in segment["words"]]
    paragraph_ends = set()
    count = 0
    for segment in transcript["segments"]:
        count += len(segment["words"])
        paragraph_ends.add(count)
    chunks = [chunk for segment in chunk_data["s"] for chunk in segment["chunks"]]
    ranges = []
    start, expected = 0, 1
    for chunk in chunks:
        a, b = chunk["a"], chunk["b"]
        if type(a) is not int or type(b) is not int or a != expected or not a <= b <= len(words):
            raise ValueError("文章 AI 切分范围不完整，无法生成音频。")
        expected = b + 1
        # A paragraph boundary may fall inside a chunk; never read across it.
        ends = sorted(end for end in paragraph_ends if a <= end <= b)
        if not ends or ends[-1] != b:
            ends.append(b)
        for end in ends:
            text = " ".join(word["word"] for word in words[start:end])
            if end in paragraph_ends or re.search(r'[.!?][\"\u201d\u2019\')\]]*$', text) or len(text) >= 900:
                ranges.append((start, end, end in paragraph_ends))
                start = end
    if expected != len(words) + 1:
        raise ValueError("文章 AI 切分未覆盖所有单词。")
    if start < len(words):
        ranges.append((start, len(words), True))
    return ranges


def synthesize_sentence(runner, text, cache_dir, cancel_event):
    """Atomic per-sentence cache also survives the existing new-job retry path."""
    key = hashlib.sha256(f"v1\0{VOICE}\0{RATE}\0{text}".encode("utf-8")).hexdigest()
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav_path = cache_dir / f"{key}.wav"
    timing_path = cache_dir / f"{key}.json"
    check_canceled(cancel_event)
    if wav_path.is_file() and timing_path.is_file():
        try:
            boundaries = load_json_file(timing_path)
            with wave.open(str(wav_path), "rb") as audio:
                if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, SAMPLE_RATE):
                    raise ValueError("invalid cache format")
                align_words([{"word": word} for word in text.split()], boundaries,
                            audio.getnframes() / SAMPLE_RATE)
            return wav_path, boundaries
        except (ValueError, KeyError, TypeError, OSError, EOFError, wave.Error):
            pass  # Regenerate incomplete or corrupt private cache entries.
    mp3_path = cache_dir / f"{key}.partial.mp3"
    partial_wav = cache_dir / f"{key}.partial.wav"
    input_path = cache_dir / f"{key}.request.json"
    partial_timing = cache_dir / f"{key}.partial.json"
    try:
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Aria 文章语音需要 Node，请通过正式启动器启动。")
        script = Path(__file__).resolve().parents[3] / "src/services/pronunciation/article-tts-cli.mjs"
        _write_json(input_path, {"text": text, "proxy": runner.config.proxy_url})
        # Each uncached sentence opens a new provider connection. Pace them to
        # avoid a burst across a long article; cancellation interrupts the wait.
        delay = max(0, getattr(runner, "_article_tts_next_request_at", 0) - time.monotonic())
        if cancel_event.wait(delay):
            check_canceled(cancel_event)
        runner._article_tts_next_request_at = time.monotonic() + 1.5
        runner.command_runner.run(
            [node, str(script), str(input_path), str(mp3_path), str(partial_timing)],
            "article-tts", lambda line: None, cancel_event=cancel_event,
        )
        boundaries = load_json_file(partial_timing)
        runner._require_configured_tool("ffmpeg", runner.config.ffmpeg_path)
        runner.command_runner.run(
            [str(runner.config.ffmpeg_path), "-y", "-v", "error", "-i", str(mp3_path),
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(partial_wav)],
            "article-tts-decode", lambda line: None, cancel_event=cancel_event,
        )
        with wave.open(str(partial_wav), "rb") as audio:
            if audio.getnframes() <= 0:
                raise RuntimeError("Aria 音频解码为空。")
            align_words([{"word": word} for word in text.split()], boundaries,
                        audio.getnframes() / SAMPLE_RATE)
        check_canceled(cancel_event)
        partial_wav.replace(wav_path)
        _write_json(timing_path, boundaries)
        return wav_path, boundaries
    finally:
        mp3_path.unlink(missing_ok=True)
        partial_wav.unlink(missing_ok=True)
        input_path.unlink(missing_ok=True)
        partial_timing.unlink(missing_ok=True)


def _letters(text):
    return "".join(char for char in unicodedata.normalize("NFKC", html.unescape(text)).casefold()
                   if char.isalnum())


def align_words(words, boundaries, duration):
    """Map provider words (including split contractions) back to source tokens."""
    tokens = [_letters(word["word"]) for word in words]
    source = "".join(tokens)
    spans, cursor = [], 0
    for boundary in boundaries:
        text = _letters(boundary["text"])
        if not text:
            continue
        if not source.startswith(text, cursor):
            raise ValueError("Aria 单词时间与原文不匹配，请重试。")
        start, end = float(boundary["start"]), float(boundary["end"])
        if not 0 <= start < end <= duration + 0.1:
            raise ValueError("Aria 单词时间超出音频范围。")
        spans.append((cursor, cursor + len(text), start, min(end, duration)))
        cursor += len(text)
    if cursor != len(source) or not spans:
        raise ValueError("Aria 单词时间未覆盖原文。")
    result, cursor, span_index = [], 0, 0
    for token in tokens:
        end = cursor + len(token)
        while span_index < len(spans) and spans[span_index][1] <= cursor:
            span_index += 1
        overlaps = []
        for span in spans[span_index:]:
            a, b, t0, t1 = span
            if a >= end:
                break
            overlaps.append((t0 + (max(a, cursor) - a) / (b - a) * (t1 - t0),
                             t0 + (min(b, end) - a) / (b - a) * (t1 - t0)))
        if overlaps:
            result.append((overlaps[0][0], overlaps[-1][1]))
        else:
            # Standalone punctuation is unspoken; keep its place in the index.
            point = result[-1][1] if result else spans[0][2]
            result.append((point, point))
        cursor = end
    return result


def generate_article_audio(runner, transcript, chunk_data, output_path, progress, cancel_event):
    words = [word for segment in transcript["segments"] for word in segment["words"]]
    ranges = speech_ranges(transcript, chunk_data)
    cache_dir = runner.config.state_dir / "article-tts-cache"
    partial_path = output_path.with_suffix(".partial.wav")
    frames_written = 0
    try:
        with wave.open(str(partial_path), "wb") as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
            for i, (a, b, paragraph_end) in enumerate(ranges):
                check_canceled(cancel_event)
                progress(f"正在生成 Aria 美式语音 {i + 1}/{len(ranges)}。")
                sentence = words[a:b]
                text = " ".join(word["word"] for word in sentence)
                wav_path, boundaries = synthesize_sentence(runner, text, cache_dir, cancel_event)
                with wave.open(str(wav_path), "rb") as audio:
                    if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, SAMPLE_RATE):
                        raise ValueError("Aria 音频缓存格式不匹配。")
                    frame_count = audio.getnframes()
                    timings = align_words(sentence, boundaries, frame_count / SAMPLE_RATE)
                    offset = frames_written / SAMPLE_RATE
                    for word, (start, end) in zip(sentence, timings):
                        word.update(start=round(offset + start, 6), end=round(offset + end, 6))
                    output.writeframes(audio.readframes(frame_count))
                    frames_written += frame_count
                # The provider already includes sentence pauses; add only a small
                # paragraph break, with no network activity during playback.
                if paragraph_end and i + 1 < len(ranges):
                    pause_frames = int(SAMPLE_RATE * 0.2)
                    output.writeframes(b"\0\0" * pause_frames)
                    frames_written += pause_frames
        check_canceled(cancel_event)
        partial_path.replace(output_path)
    finally:
        partial_path.unlink(missing_ok=True)
    for segment in transcript["segments"]:
        segment["start"] = segment["words"][0]["start"]
        segment["end"] = segment["words"][-1]["end"]
    transcript["sourceType"] = "pasted-article"
    return {"provider": "edge-tts", "voice": VOICE, "rate": RATE,
            "sentenceCount": len(ranges), "duration": frames_written / SAMPLE_RATE}
