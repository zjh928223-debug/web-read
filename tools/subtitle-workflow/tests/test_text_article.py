import json
import tempfile
import unittest
import wave
from pathlib import Path
from threading import Event
from unittest.mock import patch

from youtube_workflow.core import LocalWorkflowRunner, WorkflowConfig, WorkflowRequest, validate_session_files
from youtube_workflow.service import JobManager
from youtube_workflow.workflow_owner import WorkflowOwner
from tests import test_reader_session_owner as reader_fixtures
from tests.test_service_app import TestClient, create_app
from youtube_workflow.article_audio import align_words, generate_article_audio, speech_ranges, synthesize_sentence


def fake_sentence(runner, text, cache_dir, cancel_event):
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "fixture.wav"
    tokens = text.split()
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        output.writeframes(b"\0\0" * (len(tokens) * 6000))
    return path, [{"text": word, "start": i * 0.25, "end": (i + 1) * 0.25}
                  for i, word in enumerate(tokens)]


class TextArticleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = WorkflowConfig(output_dir=self.root / "output", state_dir=self.root / "state", proxy_url="")
        self.payload = {"sourceType": "text-only", "articleText": "A curious bird flies.\n\nIt finds a home.",
                        "title": "A small article", "geminiMode": "mock"}
        self.audio_patch = patch("youtube_workflow.article_audio.synthesize_sentence", side_effect=fake_sentence)
        self.audio_patch.start()
        self.addCleanup(self.audio_patch.stop)

    def tearDown(self):
        self.temp.cleanup()

    def manager(self):
        return JobManager(config=self.config, runner_factory=lambda: LocalWorkflowRunner(self.config))

    def run_job(self, manager, payload=None):
        created = manager.create_job(payload or self.payload, start_worker=False, idempotency_key="article-create")
        record = manager.jobs[created["jobId"]]
        manager.pending.clear()
        manager._run_job(record)
        return record

    def test_article_preserves_content_and_reopens_with_audio_and_marks(self):
        manager = self.manager()
        try:
            with patch.object(manager, "_require_workflow_tools", side_effect=AssertionError("media tools called")):
                record = self.run_job(manager)
            self.assertEqual(record.status, "ready", record.error)
            manifest = manager._manifest_for_job(record.job_id)
            self.assertEqual(manifest["sourceType"], "pasted-article")
            self.assertTrue(Path(manifest["files"]["audio"]).is_file())
            self.assertEqual(manifest["audioGeneration"]["voice"], "en-US-AriaNeural")
            self.assertNotIn("video", manifest["files"])
            transcript = json.loads(Path(manifest["files"]["transcript"]).read_text(encoding="utf-8"))
            self.assertEqual([w["word"] for s in transcript["segments"] for w in s["words"]], self.payload["articleText"].split())
            self.assertEqual((Path(manifest["outputDir"]) / "article.txt").read_text(encoding="utf-8"), self.payload["articleText"])
            manager.save_reader_marks(record.job_id, {"marks": [{"globalIndex": 1, "word": "curious", "start": 1}]})
            job_id = record.job_id
        finally:
            manager.close()
        reopened = self.manager()
        try:
            self.assertEqual(reopened.jobs[job_id].request.article_text, self.payload["articleText"])
            self.assertEqual(reopened.get_reader_marks(job_id)["marks"][0]["word"], "curious")
            self.assertTrue(any(item["jobId"] == job_id for item in reopened.list_reader_recent()))
            with TestClient(create_app(reopened)) as client:
                self.assertEqual(client.get(f"/api/jobs/{job_id}/session").status_code, 200)
                self.assertEqual(client.get(f"/api/jobs/{job_id}/file/transcript").status_code, 200)
                audio = client.get(f"/api/jobs/{job_id}/media/audio", headers={"Range": "bytes=0-43"})
                self.assertEqual(audio.status_code, 206)
                self.assertTrue(audio.content.startswith(b"RIFF"))
        finally:
            reopened.close()

    def test_real_ai_failure_is_failed_and_retry_retains_article(self):
        manager = self.manager()
        try:
            payload = {**self.payload, "geminiMode": "real", "apiKey": "test-key"}
            with patch.object(LocalWorkflowRunner, "_build_input_json_with_gemini", side_effect=RuntimeError("Gemini unavailable")):
                record = self.run_job(manager, payload)
            self.assertEqual(record.status, "failed")
            with patch.object(manager, "_require_workflow_tools", side_effect=AssertionError("media tools called")):
                retry = manager.retry_job(record.job_id, start_worker=False)
            retried = manager.jobs[retry["jobId"]]
            self.assertEqual(retried.request.article_text, self.payload["articleText"])
            self.assertEqual(retried.request.title, self.payload["title"])
        finally:
            manager.close()

    def test_audio_failure_cannot_be_ready_and_existing_retry_adds_audio(self):
        manager = self.manager()
        try:
            with patch("youtube_workflow.article_audio.synthesize_sentence", side_effect=RuntimeError("Aria unavailable")):
                record = self.run_job(manager)
            self.assertEqual(record.status, "failed")
            self.assertFalse((self.config.output_dir / f"article-{record.job_id}" / "manifest.json").exists())
            retry = manager.retry_job(record.job_id, start_worker=False)
            retried = manager.jobs[retry["jobId"]]
            manager.pending.clear()
            manager._run_job(retried)
            self.assertEqual(retried.status, "ready", retried.error)
            manifest = manager._manifest_for_job(retried.job_id)
            Path(manifest["files"]["audio"]).unlink()
            with self.assertRaisesRegex(ValueError, "audio file"):
                validate_session_files(manifest)
        finally:
            manager.close()

    def test_owner_job_start_accepts_long_multiline_article_and_replays(self):
        class NonStartingManager(JobManager):
            def start_pending_worker(self):
                pass
        manager = NonStartingManager(config=self.config)
        owner = WorkflowOwner(self.config.state_dir, self.config.output_dir, "profile-1", "article-test", service_manager=manager)
        text = ("A curious bird flies.\n\n" * 300).strip()
        payload = {"record": {"jobId": "client-article", "status": "queued", "sourceType": "text-only",
                              "request": {**self.payload, "articleText": text}}}
        try:
            args = dict(payload=payload, expected_revision=0, idempotency_key="owner-article",
                        request_id="request-article", correlation_id="correlation-article")
            result = owner.command("job-start", **args)
            self.assertEqual(result["outcome"], "committed", result.get("error"))
            replay = owner.command("job-start", **args)
            self.assertEqual(result["receipt"]["receiptId"], replay["receipt"]["receiptId"])
            self.assertEqual(len(manager.jobs), 1)
            self.assertEqual(next(iter(manager.jobs.values())).request.article_text, text)
        finally:
            manager.close()

    def test_validation_bounds_and_existing_audio_requirement(self):
        for text in ("", " " * 4, "x" * 30001):
            with self.assertRaises(ValueError):
                WorkflowRequest.from_payload({**self.payload, "articleText": text})
        with self.assertRaisesRegex(ValueError, "audio file"):
            validate_session_files({"files": {}})


class TextReaderOwnerTests(unittest.TestCase):
    setUp = reader_fixtures.ReaderSessionOwnerTests.setUp
    tearDown = reader_fixtures.ReaderSessionOwnerTests.tearDown
    make_owner = reader_fixtures.ReaderSessionOwnerTests.make_owner
    candidate = staticmethod(reader_fixtures.ReaderSessionOwnerTests.candidate)
    request_ids = staticmethod(reader_fixtures.ReaderSessionOwnerTests.request_ids)
    prepare = reader_fixtures.ReaderSessionOwnerTests.prepare
    commit = reader_fixtures.ReaderSessionOwnerTests.commit

    def test_literal_file_word_is_readable_but_file_uri_is_rejected(self):
        candidate = self.candidate()
        candidate["audioMeta"]["sourceType"] = "text-only"
        candidate["media"] = None
        candidate["transcript"] = {"segments": [{"words": [{"word": "file:", "start": 0, "end": 1}]}]}
        owner = self.make_owner()
        result = self.commit(owner, candidate)
        self.assertEqual(result["outcome"], "committed", result.get("error"))
        candidate["revision"] = 2
        candidate["transcript"]["segments"][0]["words"][0]["word"] = "file:///C:/private/audio.wav"
        rejected = owner.prepare(candidate, **self.request_ids("file-uri"))
        self.assertEqual(rejected["outcome"], "rejected")

    def test_text_candidate_commits_reopens_and_media_queries_are_empty(self):
        owner = self.make_owner()
        candidate = self.candidate()
        candidate["audioMeta"]["sourceType"] = "text-only"
        candidate["media"] = None
        result = self.commit(owner, candidate)
        self.assertEqual(result["outcome"], "committed", result.get("error"))
        reopened = self.make_owner(instance_id="reopened")
        for operation in ("snapshot", "current-revision", "media-identity", "restore-status"):
            response = reopened.query(operation, **self.request_ids(operation))
            self.assertEqual(response["outcome"], "read")
        self.assertIsNone(reopened.query("media-identity", **self.request_ids("media"))["payload"]["media"])

    def test_ordinary_missing_media_is_still_rejected(self):
        candidate = self.candidate()
        candidate["media"] = None
        result = self.make_owner().prepare(candidate, **self.request_ids("invalid"))
        self.assertEqual(result["outcome"], "rejected")


class ArticleAudioTests(unittest.TestCase):
    def test_cancel_during_provider_pacing_stops_before_starting_process(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = LocalWorkflowRunner(WorkflowConfig(state_dir=root, output_dir=root))
            runner._article_tts_next_request_at = 1001.5
            event = Event()

            def cancel_while_waiting(delay):
                self.assertAlmostEqual(delay, 1.5)
                event.set()
                return True

            with patch("youtube_workflow.article_audio.time.monotonic", return_value=1000), \
                    patch.object(event, "wait", side_effect=cancel_while_waiting), \
                    patch.object(runner.command_runner, "run") as command:
                with self.assertRaisesRegex(RuntimeError, "取消"):
                    synthesize_sentence(runner, "Hello", root / "cache", event)
            command.assert_not_called()
            self.assertFalse(list((root / "cache").glob("*.request.json")))

    def test_valid_sentence_cache_avoids_synthesis_and_corrupt_cache_regenerates(self):
        from youtube_workflow.core import _write_json
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = LocalWorkflowRunner(WorkflowConfig(state_dir=root, output_dir=root))

            def command(cmd, source, emit, cancel_event=None):
                if source == "article-tts":
                    Path(cmd[-2]).write_bytes(b"encoded fixture")
                    _write_json(Path(cmd[-1]), [{"text": "Hello", "start": 0, "end": 0.25}])
                else:
                    fake_path, _ = fake_sentence(runner, "Hello", root / "fixture", Event())
                    Path(cmd[-1]).write_bytes(fake_path.read_bytes())

            with patch.object(runner.command_runner, "run", side_effect=command) as commands:
                cached, timing = synthesize_sentence(runner, "Hello", root / "cache", Event())
                self.assertEqual(commands.call_count, 2)
                self.assertEqual(synthesize_sentence(runner, "Hello", root / "cache", Event()), (cached, timing))
                self.assertEqual(commands.call_count, 2)
                cached.write_bytes(b"corrupt")
                synthesize_sentence(runner, "Hello", root / "cache", Event())
                self.assertEqual(commands.call_count, 4)

    def test_ai_clauses_share_sentences_and_cover_paragraph_boundary(self):
        words = [{"word": word} for word in "A curious bird flies. It finds a home.".split()]
        transcript = {"segments": [{"words": words[:4]}, {"words": words[4:]}]}
        chunks = {"s": [{"chunks": [{"a": 1, "b": 2}, {"a": 3, "b": 6}, {"a": 7, "b": 8}]}]}
        self.assertEqual(speech_ranges(transcript, chunks), [(0, 4, True), (4, 8, True)])
        chunks["s"][0]["chunks"][1]["a"] = 4
        with self.assertRaisesRegex(ValueError, "范围不完整"):
            speech_ranges(transcript, chunks)

    def test_provider_boundaries_align_contractions_hyphens_and_punctuation(self):
        words = [{"word": text} for text in ["Don't", "re-enter", "—", "today."]]
        boundaries = [{"text": text, "start": i * 0.2, "end": (i + 1) * 0.2}
                      for i, text in enumerate(["Don", "t", "re", "enter", "today"])]
        self.assertEqual(align_words(words, boundaries, 1), [(0, 0.4), (0.4, 0.8), (0.8, 0.8), (0.8, 1)])
        with self.assertRaisesRegex(ValueError, "不匹配"):
            align_words(words, [{"text": "wrong", "start": 0, "end": 1}], 1)

    def test_continuous_track_uses_decoded_duration_and_cancel_never_publishes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = LocalWorkflowRunner(WorkflowConfig(state_dir=root / "state", output_dir=root))
            transcript = {"segments": [{"words": [{"word": "Hello."}]}, {"words": [{"word": "Again."}]}]}
            chunks = {"s": [{"chunks": [{"a": 1, "b": 1}, {"a": 2, "b": 2}]}]}
            target = root / "article.wav"
            with patch("youtube_workflow.article_audio.synthesize_sentence", side_effect=fake_sentence):
                result = generate_article_audio(runner, transcript, chunks, target, lambda message: None, Event())
            self.assertAlmostEqual(result["duration"], 0.7)
            self.assertAlmostEqual(transcript["segments"][1]["words"][0]["start"], 0.45)
            event = Event()
            event.set()
            canceled_target = root / "canceled.wav"
            with self.assertRaisesRegex(RuntimeError, "取消"):
                generate_article_audio(runner, transcript, chunks, canceled_target, lambda message: None, event)
            self.assertFalse(canceled_target.exists())
            self.assertFalse(canceled_target.with_suffix(".partial.wav").exists())


if __name__ == "__main__":
    unittest.main()
