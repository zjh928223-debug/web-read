import json
import tempfile
import unittest
from pathlib import Path

from youtube_workflow.annotation_backfill_runtime import AnnotationBackfillRuntime
from youtube_workflow.annotation_backfill_template import (
    ANNOTATION_BACKFILL_JOINT_PROMPT_PATH,
    ANNOTATION_BACKFILL_PROMPT_PATH,
    SRS_MEANING_REFINEMENT_PROMPT,
    plan_annotation_backfill_requests,
    split_annotation_backfill_template,
    validate_annotation_backfill_batch_result,
)


class AnnotationJointMeaningTests(unittest.TestCase):
    def template(self, count, prefix=""):
        sentences = [f"Word {i} is here." for i in range(count)]
        return {
            "articleText": prefix + " ".join(sentences),
            "articleSentences": ([prefix] if prefix else []) + sentences,
            "items": [{"targetId": str(i), "markedText": "word", "sourceSentence": sentence}
                      for i, sentence in enumerate(sentences)],
        }

    def runtime(self, directory, calls):
        def write(path, value):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value), "utf8")

        def requester(_cache, _model, prompt, template, **_kwargs):
            calls.append((prompt, template))
            return json.dumps({"items": [dict(item, meaning="完整详细解释", simpleMeaning="短义" if i == 0 else "长" * 17)
                                          for i, item in enumerate(template["items"])]})

        return AnnotationBackfillRuntime(
            manifest_for_job=lambda _job: {"outputDir": str(directory)}, require_writer_open=lambda: None,
            load_config=lambda: {}, read_secret=lambda: "test-only-key", log=lambda _text: None,
            write_json=write, redact=lambda text, _secrets: text, requester=requester,
        )

    def test_short_groups_keep_targets_and_scoped_prefix(self):
        template = self.template(18)
        groups, joint = plan_annotation_backfill_requests(template, 15)
        self.assertTrue(joint)
        self.assertEqual([len(group["items"]) for group in groups], [14, 4])
        self.assertEqual([item["targetId"] for group in groups for item in group["items"]], [str(i) for i in range(18)])
        self.assertTrue(groups[0]["articleText"].endswith("Word 13 is here."))
        self.assertTrue(groups[1]["articleText"].startswith("Word 0 is here."))

    def test_long_and_oversize_preserve_original_payload_and_batch_contract(self):
        template = self.template(61, "Earlier disambiguation. " * 40)
        groups, joint = plan_annotation_backfill_requests(template, 25)
        self.assertFalse(joint)
        self.assertEqual(groups, split_annotation_backfill_template(template, 25))
        self.assertEqual([len(group["items"]) for group in groups], [25, 25, 11])
        for group in groups:
            self.assertTrue(group["articleText"].startswith("Earlier disambiguation."))
        oversized = self.template(1)
        oversized["items"][0]["sentenceBefore"] = "important context " * 600
        groups, joint = plan_annotation_backfill_requests(oversized, 15)
        self.assertFalse(joint)
        self.assertIs(groups[0], oversized)
        empty = {"items": []}
        self.assertEqual(plan_annotation_backfill_requests(empty, 15), ([empty], False))
        no_context = {"items": [{"targetId": str(i)} for i in range(23)]}
        groups, joint = plan_annotation_backfill_requests(no_context, 15)
        self.assertFalse(joint)
        self.assertEqual([len(group["items"]) for group in groups], [15, 8])

    def test_optional_bad_short_never_discards_detail_or_requires_field(self):
        template = self.template(1)
        for short in ["长" * 17, {}, 42, None]:
            result = {"items": [{"targetId": "0", "meaning": "详细原义", "simpleMeaning": short}]}
            validate_annotation_backfill_batch_result(template, result, normalize_simple_meanings=True)
            self.assertEqual(result["items"][0]["meaning"], "详细原义")
            self.assertEqual(result["items"][0]["simpleMeaning"], "")
        old = {"items": [{"targetId": "0", "meaning": "详细原义"}]}
        validate_annotation_backfill_batch_result(template, old, normalize_simple_meanings=True)
        self.assertNotIn("simpleMeaning", old["items"][0])

    def test_runtime_selects_joint_only_for_short_context_and_saves_both(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            runtime = self.runtime(Path(directory), calls)
            try:
                result = runtime.run("job", {"template": self.template(2)})
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], ANNOTATION_BACKFILL_JOINT_PROMPT_PATH.read_text("utf8"))
                self.assertEqual(result["metadata"]["meaningStrategy"], "joint-short-context-v1")
                self.assertEqual(result["result"]["items"][0]["simpleMeaning"], "短义")
                self.assertEqual(result["result"]["items"][1]["simpleMeaning"], "")
                self.assertEqual(result["result"]["items"][1]["meaning"], "完整详细解释")
                long = runtime.run("job", {"template": self.template(2, "Earlier context. " * 60)})
                self.assertEqual(long["metadata"]["meaningStrategy"], "separate")
                self.assertEqual(calls[-1][0], ANNOTATION_BACKFILL_PROMPT_PATH.read_text("utf8"))
            finally:
                runtime.close()

    def test_independent_refinement_keeps_single_request_and_original_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            runtime = self.runtime(Path(directory), calls)
            template = self.template(61)
            template["source"] = "article-srs-meaning-refinement"
            try:
                result = runtime.run("job", {"template": template, "batchSize": 10})
                self.assertEqual(len(calls), 1)
                self.assertEqual(len(calls[0][1]["items"]), 61)
                self.assertEqual(calls[0][0], SRS_MEANING_REFINEMENT_PROMPT)
                self.assertEqual(result["result"]["items"][1]["simpleMeaning"], "长" * 17)
                self.assertEqual(result["metadata"]["retryCount"], 0)
            finally:
                runtime.close()


if __name__ == "__main__":
    unittest.main()
