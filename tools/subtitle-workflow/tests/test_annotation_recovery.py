import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from youtube_workflow.annotation_backfill_runtime import AnnotationBackfillRuntime, AnnotationBackfillCanceled


def response(rows):
    return json.dumps({'items': [dict(targetId=row['targetId'], boundary='word', type='word',
                                    meaning='“原文”含义', memoryHint='记忆提示') for row in rows]}, ensure_ascii=False)


class AnnotationRecoveryTests(unittest.TestCase):
    template = {'items': [{'targetId': 'a', 'markedText': 'first'}, {'targetId': 'b', 'markedText': 'second'}]}

    def runtime(self, root, requester):
        def write(path, data):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding='utf8')
        return AnnotationBackfillRuntime(manifest_for_job=lambda _: {'outputDir': str(root)},
            require_writer_open=lambda: None, load_config=lambda: {}, read_secret=lambda: 'test-only',
            log=lambda _: None, write_json=write, redact=lambda t, _: t, requester=requester,
            retry_jitter=lambda _: 0)

    def run_with(self, root, requester, **options):
        runtime = self.runtime(root, requester)
        try:
            return runtime.run('job', {'template': self.template, 'retryDelaySeconds': 0, **options})
        finally:
            runtime.close()

    def test_schema_partial_success_and_only_missing_target_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, calls = Path(tmp), []
            def request(_c, _m, _p, payload, **kwargs):
                calls.append([r['targetId'] for r in payload['items']])
                schema = kwargs['extra_config']['response_json_schema']
                self.assertEqual(schema['properties']['items']['items']['properties']['targetId']['enum'], calls[-1])
                if len(calls) == 1:
                    return response(payload['items'][:1])
                saved = json.loads(next((root/'_workflow/annotation-backfill/progress').glob('*.json')).read_text('utf8'))
                self.assertEqual([r['targetId'] for r in saved['result']['items']], ['a'])
                return response(payload['items'])
            result = self.run_with(root, request)
            self.assertEqual(calls, [['a', 'b'], ['b']])
            self.assertEqual([r['markedText'] for r in result['result']['items']], ['first', 'second'])
            self.assertEqual(result['metadata']['retryCount'], 1)

    def test_failed_batch_keeps_previous_version_and_recreated_runtime_resumes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, calls = Path(tmp), []
            latest = root/'_workflow/annotation-backfill/latest-result.json'
            latest.parent.mkdir(parents=True)
            latest.write_text('{"items": [{"targetId": "previous"}]}', 'utf8')
            before = latest.read_bytes()
            def fail(_c, _m, _p, payload, **kwargs):
                calls.append([r['targetId'] for r in payload['items']])
                if calls[-1] == ['a']:
                    return response(payload['items'])
                raise RuntimeError('503 unavailable')
            with self.assertRaises(HTTPException) as error:
                self.run_with(root, fail, batchSize=1, maxRetries=0)
            self.assertIn('1/2', error.exception.detail)
            self.assertEqual(latest.read_bytes(), before)
            calls.clear()
            def resume(_c, _m, _p, payload, **kwargs):
                calls.append([r['targetId'] for r in payload['items']])
                return response(payload['items'])
            result = self.run_with(root, resume, batchSize=1)
            self.assertEqual(calls, [['b']])
            self.assertEqual([r['targetId'] for r in result['result']['items']], ['a', 'b'])
            self.assertEqual(result['metadata']['resumedItemCount'], 1)
            self.assertEqual(result['metadata']['requestItemCount'], 1)

    def test_bad_json_retry_bypasses_bad_cache_and_exhaustion_is_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            configs = []
            def request(_c, _m, _p, payload, **kwargs):
                configs.append(kwargs['extra_config'])
                return '{broken response'
            with self.assertRaises(HTTPException):
                self.run_with(Path(tmp), request)
            self.assertEqual(len(configs), 3)
            self.assertFalse(configs[0].get('bypass_cache', False))
            self.assertTrue(all(c['bypass_cache'] for c in configs[1:]))

    def test_duplicate_target_retries_only_that_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def request(_c, _m, _p, payload, **kwargs):
                calls.append([r['targetId'] for r in payload['items']])
                rows = payload['items']
                return response(rows + rows[:1]) if len(calls) == 1 else response(rows)
            result = self.run_with(Path(tmp), request)
            self.assertEqual(calls, [['a', 'b'], ['a']])
            self.assertEqual([r['targetId'] for r in result['result']['items']], ['a', 'b'])

    def test_permanent_error_does_not_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def request(*args, **kwargs):
                calls.append(1)
                raise RuntimeError('401 invalid API key')
            with self.assertRaises(HTTPException):
                self.run_with(Path(tmp), request)
            self.assertEqual(len(calls), 1)

    def test_temporary_network_timeout_retries_current_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def request(_c, _m, _p, payload, **kwargs):
                calls.append([r['targetId'] for r in payload['items']])
                if len(calls) == 1:
                    raise TimeoutError('network timed out')
                return response(payload['items'])
            result = self.run_with(Path(tmp), request)
            self.assertEqual(calls, [['a', 'b'], ['a', 'b']])
            self.assertEqual(result['metadata']['retryCount'], 1)

    def test_checkpoint_identity_changes_and_complete_checkpoint_reuses_without_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def request(_c, model, _p, payload, **kwargs):
                calls.append(model)
                return response(payload['items'])
            self.run_with(Path(tmp), request, model='model-a')
            self.run_with(Path(tmp), request, model='model-a')
            self.assertEqual(calls, ['model-a'])
            self.run_with(Path(tmp), request, model='model-b')
            changed = {'items': [dict(self.template['items'][0], sourceSentence='New context.')]}
            self.run_with(Path(tmp), request, model='model-a', template=changed)
            self.assertEqual(calls, ['model-a', 'model-b', 'model-a'])

    def test_cancel_and_storage_failure_do_not_publish_or_retry_storage(self):
        with tempfile.TemporaryDirectory() as tmp:
            event, calls = threading.Event(), []
            def request(_c, _m, _p, payload, **kwargs):
                calls.append(payload['items'][0]['targetId'])
                if calls[-1] == 'b':
                    event.set()
                return response(payload['items'])
            with self.assertRaises(AnnotationBackfillCanceled):
                self.run_with(Path(tmp), request, batchSize=1, _operationControl={'cancelEvent': event})
            self.assertFalse((Path(tmp)/'_workflow/annotation-backfill/latest-result.json').exists())
            saved = json.loads(next(Path(tmp).glob('_workflow/annotation-backfill/progress/*.json')).read_text('utf8'))
            self.assertEqual([r['targetId'] for r in saved['result']['items']], ['a'])
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def request(_c, _m, _p, payload, **kwargs):
                calls.append(1)
                return response(payload['items'])
            with patch('youtube_workflow.annotation_backfill_progress.DurableJsonRepository.write', side_effect=OSError('disk full')):
                with self.assertRaises(HTTPException):
                    self.run_with(Path(tmp), request)
            self.assertEqual(len(calls), 1)
            self.assertFalse((Path(tmp)/'_workflow/annotation-backfill/latest-result.json').exists())


if __name__ == '__main__':
    unittest.main()
