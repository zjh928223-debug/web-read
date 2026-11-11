"""Pasted articles: AI chunks first, then a saved and aligned Aria track."""
import re
from threading import Event

from .core import (
    _write_json, assert_manifest_has_no_secret, load_json_file, make_manifest,
    utc_now_iso, validate_session_files,
)
from .article_audio import generate_article_audio


def run_text_article(runner, request, job_id, emit, cancel_event=None):
    cancel_event = cancel_event or Event()
    started_at = utc_now_iso()
    folder = runner.config.output_dir / f"article-{job_id}"
    workflow = folder / "_workflow"
    workflow.mkdir(parents=True, exist_ok=True)
    transcript_path = folder / "article.transcript.json"
    output_path = workflow / "output.json"
    public_path = folder / "article.ai-chunks.json"
    logs = []

    def stage(name, message):
        if cancel_event.is_set():
            raise RuntimeError("任务已取消。")
        logs.append(message)
        emit({"jobId": job_id, "status": name, "stage": name, "message": message})

    # Keep all source words, including punctuation, in stable document order.
    segments = []
    index = 0
    for paragraph in re.split(r"\n\s*\n", request.article_text):
        tokens = paragraph.split()
        if not tokens:
            continue
        words = [{"word": token, "start": index + i, "end": index + i + 1}
                 for i, token in enumerate(tokens)]
        segments.append({"start": index, "end": index + len(tokens),
                         "text": " ".join(tokens), "words": words})
        index += len(tokens)
    _write_json(transcript_path, {"segments": segments, "sourceType": "text-only"})
    # Preserve the original paste separately from normalized reading tokens.
    (folder / "article.txt").write_text(request.article_text, encoding="utf-8")
    stage("segmenting", "正在生成文章 AI 切分。")
    runner._apply_proxy_settings()
    if request.gemini_mode == "real":
        runner._build_input_json_with_gemini(transcript_path, output_path, request, logs.append)
    else:
        runner._build_input_json(transcript_path, output_path)
    stage("translating", "正在生成逐句中文释义。")
    if request.gemini_mode == "real":
        runner._generate_real_output(workflow / "input.json", output_path, request, logs, emit, job_id)
    else:
        runner._generate_local_output(workflow / "input.json", output_path, request.gemini_mode)
    chunk_data = load_json_file(output_path)
    transcript = load_json_file(transcript_path)
    audio_path = folder / "article.wav"
    generation = generate_article_audio(
        runner, transcript, chunk_data, audio_path,
        lambda message: stage("synthesizing", message), cancel_event,
    )
    stage("validating", "正在保存文章与音频。")
    _write_json(transcript_path, transcript)
    _write_json(public_path, chunk_data)
    manifest = make_manifest(
        job_id=job_id, request=request, status="ready", stage="ready", output_dir=folder,
        files={"audio": str(audio_path), "transcript": str(transcript_path), "chunkData": str(public_path)},
        title=request.title or request.article_text.splitlines()[0][:80],
        started_at=started_at, finished_at=utc_now_iso(), log_summary=logs,
    )
    manifest["sourceType"] = "pasted-article"
    manifest["audioGeneration"] = generation
    validate_session_files(manifest)
    assert_manifest_has_no_secret(manifest, [request.api_key])
    _write_json(folder / "manifest.json", manifest)
    emit({"jobId": job_id, "status": "ready", "stage": "ready", "message": "文章已保存，可从素材库打开。"})
    return manifest
