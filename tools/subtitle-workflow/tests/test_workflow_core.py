import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from youtube_workflow.core import (
    FakeWorkflowRunner,
    LocalWorkflowRunner,
    WorkflowConfig,
    WorkflowRequest,
    assert_manifest_has_no_secret,
    classify_error,
    classify_error_code,
    validate_session_files,
    marks_integrity,
)


class FakeCommandRunner:
    def __init__(self):
        self.calls = []

    def run(self, cmd, source, emit_line, cancel_event=None):
        self.calls.append((source, list(cmd)))
        if source == "yt-dlp":
            output_pattern = Path(cmd[cmd.index("-o") + 1])
            output_pattern.parent.mkdir(parents=True, exist_ok=True)
            format_selector = cmd[cmd.index("-f") + 1]
            suffix = ".mp4" if "bestvideo" in format_selector or "ext=mp4" in format_selector else ".webm"
            media = output_pattern.parent / f"Example Video{suffix}"
            media.write_bytes(b"fake media")
            emit_line("[download] 100%")
        elif source == "ffmpeg":
            output = Path(cmd[-1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"clean wav")
            emit_line("[ffmpeg] extracted")
        elif source == "whisperx":
            audio = Path(cmd[1])
            output_dir = Path(cmd[cmd.index("--output_dir") + 1])
            transcript = {
                "segments": [
                    {
                        "start": 0.0,
                        "end": 1.2,
                        "text": "Hello world.",
                        "words": [
                            {"word": "Hello", "start": 0.0, "end": 0.5},
                            {"word": "world", "start": 0.6, "end": 1.2},
                        ],
                    }
                ]
            }
            (output_dir / f"{audio.stem}.json").write_text(json.dumps(transcript), encoding="utf-8")
            emit_line("[whisperx] done")


class VideoImportCommandRunner:
    def __init__(self):
        self.calls = []

    def run(self, cmd, source, emit_line, cancel_event=None):
        self.calls.append((source, list(cmd)))
        if source == "ffmpeg":
            output = Path(cmd[-1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"extracted mp3")
            emit_line("audio extracted")
        elif source == "whisperx":
            audio = Path(cmd[1])
            output_dir = Path(cmd[cmd.index("--output_dir") + 1])
            transcript = {
                "segments": [
                    {
                        "start": 0,
                        "end": 1,
                        "text": "Video words",
                        "words": [{"word": "Video"}, {"word": "words"}],
                    }
                ]
            }
            (output_dir / f"{audio.stem}.json").write_text(json.dumps(transcript), encoding="utf-8")
            emit_line("transcribed")


class WorkflowCoreTests(unittest.TestCase):
    def test_marks_integrity_uses_cross_language_stable_business_field_projection(self):
        first = marks_integrity([{
            "globalIndex": 2,
            "word": "stable",
            "start": 1.0,
            "sourceType": "manual-mark",
            "browserOnlyExtension": {"ignored": True},
        }])
        second = marks_integrity([{
            "sourceType": "manual-mark",
            "start": 1,
            "word": "stable",
            "globalIndex": 2,
        }])

        self.assertEqual(first, second)
        self.assertEqual(first["representation"], "marks-fields.v1")

    def test_fake_runner_generates_manifest_and_reader_files_without_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            events = []
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=fake",
                gemini_mode="real",
                api_key="SECRET-KEY-SHOULD-NOT-LEAK",
                model="gemini-test-model",
                base_url="https://example.invalid/gemini",
                auto_open_when_ready=True,
                replace_policy="ask",
            )

            manifest = FakeWorkflowRunner(WorkflowConfig(output_dir=Path(tmp))).run(
                request,
                job_id="job-test",
                emit=events.append,
            )

            self.assertEqual(manifest["jobId"], "job-test")
            self.assertEqual(manifest["status"], "ready")
            self.assertEqual(manifest["stage"], "ready")
            self.assertEqual(manifest["request"]["geminiMode"], "real")
            self.assertNotIn("apiKey", manifest["request"])
            self.assertNotIn("SECRET-KEY-SHOULD-NOT-LEAK", json.dumps(manifest, ensure_ascii=False))
            self.assertTrue(Path(manifest["files"]["audio"]).exists())
            self.assertTrue(Path(manifest["files"]["transcript"]).exists())
            self.assertTrue(Path(manifest["files"]["chunkData"]).exists())
            self.assertTrue(Path(manifest["files"]["chunkData"]).name.endswith(".ai-chunks.json"))
            self.assertEqual(manifest["contentId"], "youtube-workflow:job-test")
            self.assertRegex(manifest["revision"], r"^sha256:[0-9a-f]{64}$")
            self.assertEqual(manifest["integrity"]["algorithm"], "sha256")
            self.assertEqual(manifest["integrity"]["transcript"]["representation"], "file-bytes")
            self.assertEqual(manifest["integrity"]["chunkData"]["representation"], "file-bytes")
            self.assertIsNone(manifest["integrity"]["marks"])
            revision = manifest["revision"]
            validate_session_files(manifest)
            self.assertEqual(manifest["revision"], revision)
            self.assertFalse((Path(manifest["outputDir"]) / "output.json").exists())
            self.assertIn("ready", [event["stage"] for event in events])
            allowed_states = {
                "queued",
                "downloading",
                "transcribing",
                "segmenting",
                "translating",
                "validating",
                "ready",
                "failed",
                "canceled",
            }
            self.assertTrue(all(event["status"] in allowed_states for event in events))
            assert_manifest_has_no_secret(manifest, ["SECRET-KEY-SHOULD-NOT-LEAK"])
            validate_session_files(manifest)

    def test_validate_session_files_rejects_bad_transcript_and_preserves_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio = root / "audio.wav"
            transcript = root / "transcript.json"
            chunk_data = root / "output.json"
            audio.write_bytes(b"RIFFfake")
            transcript.write_text(json.dumps({"segments": []}), encoding="utf-8")
            chunk_data.write_text(json.dumps({"s": [{"id": 0, "chunks": []}]}), encoding="utf-8")
            manifest = {
                "files": {
                    "audio": str(audio),
                    "transcript": str(transcript),
                    "chunkData": str(chunk_data),
                }
            }

            with self.assertRaisesRegex(ValueError, "transcript.*segments"):
                validate_session_files(manifest)

    def test_validate_session_files_rejects_resource_changed_after_identity_was_declared(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio = root / "audio.wav"
            transcript = root / "transcript.json"
            chunk_data = root / "output.json"
            audio.write_bytes(b"RIFFfake")
            transcript.write_text(json.dumps({"segments": [{"words": [{"word": "stable"}]}]}), encoding="utf-8")
            chunk_data.write_text(json.dumps({"s": [{"id": 0, "chunks": [{"en": "stable"}]}]}), encoding="utf-8")
            manifest = {
                "jobId": "integrity-fixture",
                "outputDir": str(root),
                "files": {
                    "audio": str(audio),
                    "transcript": str(transcript),
                    "chunkData": str(chunk_data),
                },
            }

            validate_session_files(manifest)
            declared_revision = manifest["revision"]
            transcript.write_text(json.dumps({"segments": [{"words": [{"word": "changed"}]}]}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "resource integrity mismatch"):
                validate_session_files(manifest)
            self.assertEqual(manifest["revision"], declared_revision)

    def test_classify_error_groups_user_visible_failure_categories(self):
        self.assertEqual(classify_error(RuntimeError("cookies are expired")), "youtube")
        self.assertEqual(classify_error(RuntimeError("whisperx failed to align")), "whisperx")
        self.assertEqual(classify_error(RuntimeError("Gemini quota exceeded")), "gemini")
        self.assertEqual(classify_error(RuntimeError("output.json invalid format")), "output")

    def test_classify_error_code_identifies_youtube_media_403(self):
        self.assertEqual(
            classify_error_code("yt-dlp failed: HTTP Error 403: Forbidden"),
            "YOUTUBE_MEDIA_HTTP_403",
        )
        self.assertEqual(classify_error_code("Gemini quota exceeded"), "")

    def test_proxy_settings_preserve_existing_bypass_and_add_loopback_hosts(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {
                "NO_PROXY": "internal.example,metadata.internal",
            },
            clear=True,
        ):
            runner = LocalWorkflowRunner(
                WorkflowConfig(
                    output_dir=Path(tmp),
                    proxy_url="http://127.0.0.1:7897",
                ),
                command_runner=FakeCommandRunner(),
            )

            runner._apply_proxy_settings()

            self.assertEqual(os.environ["HTTP_PROXY"], "http://127.0.0.1:7897")
            self.assertEqual(os.environ["HTTPS_PROXY"], "http://127.0.0.1:7897")
            self.assertEqual(
                set(os.environ["NO_PROXY"].split(",")),
                {"internal.example", "metadata.internal", "127.0.0.1", "localhost", "::1"},
            )
            self.assertEqual(os.environ["no_proxy"], os.environ["NO_PROXY"])

    def test_local_runner_uses_commands_and_mock_translation_without_gemini_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            command_runner = FakeCommandRunner()
            events = []
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=example",
                gemini_mode="mock",
                model="gemini-test",
                auto_open_when_ready=False,
                replace_policy="ask",
            )

            manifest = LocalWorkflowRunner(
                WorkflowConfig(output_dir=Path(tmp)),
                command_runner=command_runner,
            ).run(request, job_id="job-local", emit=events.append)

            self.assertEqual([source for source, _cmd in command_runner.calls], ["yt-dlp", "whisperx"])
            yt_dlp_cmd = command_runner.calls[0][1]
            self.assertEqual(yt_dlp_cmd[yt_dlp_cmd.index("-f") + 1], "best[ext=mp4]/best")
            self.assertEqual(
                yt_dlp_cmd[yt_dlp_cmd.index("--extractor-args") + 1],
                "youtube:player_client=mweb",
            )
            whisperx_cmd = command_runner.calls[1][1]
            self.assertEqual(manifest["status"], "ready")
            self.assertEqual(manifest["request"]["videoPriority"], True)
            allowed_states = {
                "queued",
                "downloading",
                "transcribing",
                "segmenting",
                "translating",
                "validating",
                "ready",
                "failed",
                "canceled",
            }
            self.assertTrue(events)
            self.assertTrue(all(event["status"] in allowed_states for event in events))
            self.assertTrue(all(event["stage"] in allowed_states for event in events))
            self.assertEqual(Path(manifest["files"]["video"]).name, "Example Video.mp4")
            self.assertEqual(Path(manifest["files"]["audio"]).name, "Example Video.mp4")
            self.assertNotIn("transcriptionAudio", manifest["files"])
            self.assertEqual(Path(whisperx_cmd[1]), Path(manifest["files"]["audio"]))
            self.assertTrue(Path(manifest["files"]["audio"]).exists())
            self.assertTrue(Path(manifest["files"]["transcript"]).exists())
            self.assertTrue(Path(manifest["files"]["transcript"]).name.endswith(".transcript.json"))
            self.assertTrue(Path(manifest["files"]["chunkData"]).name.endswith(".ai-chunks.json"))
            self.assertFalse((Path(manifest["outputDir"]) / "output.json").exists())
            self.assertTrue((Path(manifest["outputDir"]) / "_workflow" / "output.json").exists())
            chunk_data = json.loads(Path(manifest["files"]["chunkData"]).read_text(encoding="utf-8"))
            self.assertEqual(chunk_data["s"][0]["chunks"][0]["zh"], "mock translation")
            validate_session_files(manifest)

    def test_local_runner_can_use_audio_first_download_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            command_runner = FakeCommandRunner()
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=audio-first",
                gemini_mode="mock",
                video_priority=False,
            )

            manifest = LocalWorkflowRunner(
                WorkflowConfig(output_dir=Path(tmp)),
                command_runner=command_runner,
            ).run(request, job_id="job-audio-first")

            yt_dlp_cmd = command_runner.calls[0][1]
            self.assertEqual(yt_dlp_cmd[yt_dlp_cmd.index("-f") + 1], "bestaudio/best")
            self.assertEqual(manifest["request"]["videoPriority"], False)

    def test_retry_with_downloaded_video_and_no_transcript_resumes_at_whisperx(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job_dir = root / "job"
            workflow_dir = job_dir / "_workflow"
            workflow_dir.mkdir(parents=True)
            video = job_dir / "Example Video.mp4"
            video.write_bytes(b"fake video")
            request = WorkflowRequest(url="https://example.com/retry", gemini_mode="mock")
            previous_manifest = {
                "jobId": "old-job",
                "title": "Example Video",
                "url": request.url,
                "status": "failed",
                "stage": "failed",
                "checkpoint": {
                    "jobId": "old-job",
                    "title": "Example Video",
                    "url": request.url,
                    "outputDir": str(job_dir),
                    "files": {"audio": str(video), "video": str(video)},
                    "workflow": {},
                    "lastStage": "downloading",
                },
            }
            command_runner = FakeCommandRunner()

            manifest = LocalWorkflowRunner(
                WorkflowConfig(output_dir=root),
                command_runner=command_runner,
            ).retry_from_stage(
                request,
                job_id="retry-job",
                previous_manifest=previous_manifest,
                retry_stage="translating",
                emit=lambda event: None,
            )

            self.assertEqual([source for source, _cmd in command_runner.calls], ["whisperx"])
            self.assertEqual(Path(command_runner.calls[0][1][1]), video)
            self.assertEqual(manifest["status"], "ready")
            self.assertEqual(manifest["retryStage"], "transcribing")
            self.assertTrue(Path(manifest["files"]["transcript"]).is_file())
            self.assertEqual(previous_manifest["checkpoint"]["jobId"], "old-job")
            validate_session_files(manifest)

    def test_local_runner_stage_retry_reuses_checkpoint_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job_dir = root / "job"
            workflow_dir = job_dir / "_workflow"
            workflow_dir.mkdir(parents=True)
            audio = job_dir / "Example.wav"
            transcript = job_dir / "Example.transcript.json"
            input_json = workflow_dir / "input.json"
            output_json = workflow_dir / "output.json"
            public_chunk = job_dir / "Example.ai-chunks.json"
            audio.write_bytes(b"RIFFfake")
            transcript.write_text(
                json.dumps({
                    "segments": [
                        {
                            "start": 0,
                            "end": 1,
                            "text": "Hello world",
                            "words": [{"word": "Hello"}, {"word": "world"}],
                        }
                    ]
                }),
                encoding="utf-8",
            )
            input_json.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": ""}]}]}),
                encoding="utf-8",
            )
            request = WorkflowRequest(url="https://example.com/retry", gemini_mode="mock")
            previous_manifest = {
                "jobId": "old-job",
                "title": "Example",
                "url": request.url,
                "status": "failed",
                "stage": "failed",
                "checkpoint": {
                    "jobId": "old-job",
                    "title": "Example",
                    "url": request.url,
                    "outputDir": str(job_dir),
                    "files": {"audio": str(audio), "transcript": str(transcript)},
                    "workflow": {
                        "inputJson": str(input_json),
                        "outputJson": str(output_json),
                        "publicChunk": str(public_chunk),
                    },
                    "lastStage": "translating",
                },
            }

            manifest = LocalWorkflowRunner(WorkflowConfig(output_dir=root)).retry_from_stage(
                request,
                job_id="retry-job",
                previous_manifest=previous_manifest,
                retry_stage="translating",
                emit=lambda event: None,
            )

            self.assertEqual(manifest["status"], "ready")
            self.assertEqual(manifest["retryStage"], "translating")
            self.assertTrue(public_chunk.exists())
            self.assertFalse((job_dir / "output.json").exists())
            validate_session_files(manifest)

    def test_ready_stage_retry_writes_new_chunk_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job_dir = root / "job"
            workflow_dir = job_dir / "_workflow"
            workflow_dir.mkdir(parents=True)
            audio = job_dir / "Example.wav"
            transcript = job_dir / "Example.transcript.json"
            input_json = workflow_dir / "input.json"
            output_json = workflow_dir / "output.json"
            public_chunk = job_dir / "Example.ai-chunks.json"
            audio.write_bytes(b"RIFFfake")
            transcript.write_text(
                json.dumps({"segments": [{"start": 0, "end": 1, "text": "Hello world", "words": [{"word": "Hello"}, {"word": "world"}]}]}),
                encoding="utf-8",
            )
            input_json.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": ""}]}]}),
                encoding="utf-8",
            )
            public_chunk.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": "old"}]}]}),
                encoding="utf-8",
            )
            request = WorkflowRequest(url="https://example.com/retry", gemini_mode="mock")
            previous_manifest = {
                "jobId": "old-job",
                "title": "Example",
                "url": request.url,
                "status": "ready",
                "stage": "ready",
                "checkpoint": {
                    "jobId": "old-job",
                    "title": "Example",
                    "url": request.url,
                    "outputDir": str(job_dir),
                    "files": {"audio": str(audio), "transcript": str(transcript), "chunkData": str(public_chunk)},
                    "workflow": {
                        "inputJson": str(input_json),
                        "outputJson": str(output_json),
                        "publicChunk": str(public_chunk),
                    },
                    "lastStage": "ready",
                },
            }

            manifest = LocalWorkflowRunner(WorkflowConfig(output_dir=root)).retry_from_stage(
                request,
                job_id="retry-ready",
                previous_manifest=previous_manifest,
                retry_stage="translating",
                emit=lambda event: None,
            )

            self.assertNotEqual(Path(manifest["files"]["chunkData"]), public_chunk)
            self.assertEqual(json.loads(public_chunk.read_text(encoding="utf-8"))["s"][0]["chunks"][0]["zh"], "old")
            validate_session_files(manifest)

    def test_local_runner_real_mode_uses_gemini_chunking_boundary_before_translation(self):
        class RealModeNoNetworkRunner(LocalWorkflowRunner):
            def __init__(self, config, command_runner):
                super().__init__(config, command_runner=command_runner)
                self.calls = []

            def _build_input_json_with_gemini(self, transcript_path, output_json_path, request, log_func):
                self.calls.append("gemini-chunking")
                input_data = {"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": ""}]}]}
                output_json_path.with_name("input.json").write_text(
                    json.dumps(input_data),
                    encoding="utf-8",
                )
                output_json_path.with_name("chunk_debug.json").write_text("[]", encoding="utf-8")
                return "Hello world"

            def _generate_real_output(self, input_json_path, output_json_path, request, log_summary, emit, job_id):
                self.calls.append("real-translation")
                output_json_path.write_text(
                    json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Hello world", "zh": "你好"}]}]}),
                    encoding="utf-8",
                )

        with tempfile.TemporaryDirectory() as tmp:
            runner = RealModeNoNetworkRunner(WorkflowConfig(output_dir=Path(tmp)), FakeCommandRunner())
            request = WorkflowRequest(
                url="https://www.youtube.com/watch?v=example",
                gemini_mode="real",
                api_key="SECRET-REAL-MODE",
                model="gemini-test",
            )

            manifest = runner.run(request, job_id="job-real", emit=lambda event: None)

            self.assertEqual(runner.calls, ["gemini-chunking", "real-translation"])
            self.assertEqual(manifest["status"], "ready")
            self.assertNotIn("SECRET-REAL-MODE", json.dumps(manifest, ensure_ascii=False))

    def test_local_runner_imports_legacy_audio_with_fixed_file_names_and_source_map(self):
        class ImportNoNetworkRunner(LocalWorkflowRunner):
            def _build_input_json(self, transcript_path, output_json_path):
                output_json_path.with_name("input.json").write_text(
                    json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 1, "en": "Hello", "zh": ""}]}]}),
                    encoding="utf-8",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy_dir = root / "legacy"
            legacy_dir.mkdir()
            audio = legacy_dir / "Original Name.mp3"
            transcript = legacy_dir / "random subtitle.json"
            audio.write_bytes(b"audio")
            transcript.write_text(
                json.dumps({"segments": [{"start": 0, "end": 1, "text": "Hello", "words": [{"word": "Hello"}]}]}),
                encoding="utf-8",
            )
            runner = ImportNoNetworkRunner(WorkflowConfig(output_dir=root / "managed"))
            request = WorkflowRequest(url=audio.as_uri(), gemini_mode="mock")

            manifest = runner.import_from_plan(
                request,
                job_id="import-1",
                import_plan={
                    "audioPath": str(audio),
                    "transcriptPath": str(transcript),
                    "action": "ai_only",
                    "confidence": 96,
                    "sourceDir": str(legacy_dir),
                },
                emit=lambda event: None,
            )

            output_dir = Path(manifest["outputDir"])
            self.assertEqual(output_dir.name, "job-import-1")
            self.assertEqual(Path(manifest["files"]["audio"]).name, "source.audio.mp3")
            self.assertEqual(Path(manifest["files"]["transcript"]).name, "source.transcript.json")
            self.assertRegex(Path(manifest["files"]["chunkData"]).name, r"source\.ai-chunks\.\d{8}-\d{6}\.json")
            source_map = json.loads((output_dir / "_workflow" / "source-map.json").read_text(encoding="utf-8"))
            self.assertEqual(source_map["originalAudio"]["path"], str(audio))
            self.assertEqual(source_map["originalTranscript"]["path"], str(transcript))
            self.assertEqual(source_map["action"], "ai_only")
            validate_session_files(manifest)

    def test_local_runner_imports_video_only_material_by_extracting_mp3_audio(self):
        class ImportVideoRunner(LocalWorkflowRunner):
            def _build_input_json(self, transcript_path, output_json_path):
                output_json_path.with_name("input.json").write_text(
                    json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 2, "en": "Video words", "zh": ""}]}]}),
                    encoding="utf-8",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_dir = root / "source"
            source_dir.mkdir()
            video = source_dir / "Video Only.mp4"
            video.write_bytes(b"video")
            command_runner = VideoImportCommandRunner()
            runner = ImportVideoRunner(WorkflowConfig(output_dir=root / "managed"), command_runner=command_runner)
            request = WorkflowRequest(url=video.as_uri(), gemini_mode="mock")

            manifest = runner.import_from_plan(
                request,
                job_id="video-import",
                import_plan={
                    "videoPath": str(video),
                    "sourceDir": str(source_dir),
                    "title": "Video Only",
                    "action": "whisper_ai",
                },
                emit=lambda event: None,
            )

            self.assertEqual([source for source, _cmd in command_runner.calls], ["ffmpeg", "whisperx"])
            self.assertEqual(Path(manifest["files"]["video"]), video)
            self.assertEqual(Path(manifest["files"]["audio"]).name, "source.audio.mp3")
            self.assertTrue(Path(manifest["files"]["audio"]).exists())
            source_map = json.loads((Path(manifest["outputDir"]) / "_workflow" / "source-map.json").read_text(encoding="utf-8"))
            self.assertEqual(source_map["originalVideo"]["path"], str(video))
            validate_session_files(manifest)

    def test_local_runner_import_reuses_existing_chunk_data_without_regenerating(self):
        class NoChunkGenerationRunner(LocalWorkflowRunner):
            def _build_input_json(self, transcript_path, output_json_path):
                raise AssertionError("chunk input should not be rebuilt when chunkDataPath is supplied")

            def _generate_local_output(self, input_json_path, output_json_path, gemini_mode):
                raise AssertionError("chunk output should not be regenerated when chunkDataPath is supplied")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy_dir = root / "legacy"
            legacy_dir.mkdir()
            audio = legacy_dir / "Talk.mp3"
            transcript = legacy_dir / "Talk.transcript.json"
            chunk_data = legacy_dir / "Talk.ai-chunks.json"
            audio.write_bytes(b"audio")
            transcript.write_text(
                json.dumps({"segments": [{"start": 0, "end": 1, "text": "Hello", "words": [{"word": "Hello"}]}]}),
                encoding="utf-8",
            )
            chunk_data.write_text(
                json.dumps({"s": [{"id": 0, "chunks": [{"a": 1, "b": 1, "en": "Hello", "zh": "cached"}]}]}),
                encoding="utf-8",
            )
            runner = NoChunkGenerationRunner(WorkflowConfig(output_dir=root / "managed"))
            request = WorkflowRequest(url=audio.as_uri(), gemini_mode="mock")

            manifest = runner.import_from_plan(
                request,
                job_id="cached-chunk",
                import_plan={
                    "audioPath": str(audio),
                    "transcriptPath": str(transcript),
                    "chunkDataPath": str(chunk_data),
                    "action": "ai_only",
                    "sourceDir": str(legacy_dir),
                },
                emit=lambda event: None,
            )

            imported_chunk = json.loads(Path(manifest["files"]["chunkData"]).read_text(encoding="utf-8"))
            self.assertEqual(imported_chunk["s"][0]["chunks"][0]["zh"], "cached")
            source_map = json.loads((Path(manifest["outputDir"]) / "_workflow" / "source-map.json").read_text(encoding="utf-8"))
            self.assertEqual(source_map["originalChunkData"]["path"], str(chunk_data))
            validate_session_files(manifest)


if __name__ == "__main__":
    unittest.main()
