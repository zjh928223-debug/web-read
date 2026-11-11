import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import language_service
from youtube_workflow.annotation_output_contract import annotation_output_schema


class AnnotationSchemaTransportTests(unittest.TestCase):
    def test_native_sdk_receives_schema_and_invalid_cache_can_be_replaced(self):
        schema = annotation_output_schema({'items': [{'targetId': 'a'}]})
        generate = Mock(side_effect=[SimpleNamespace(text='{bad json'), SimpleNamespace(text='{"items": []}')])
        sdk = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
        config = {'api_key': 'test-only', 'response_json_schema': schema}
        with tempfile.TemporaryDirectory() as tmp, patch.object(language_service.genai, 'Client', return_value=sdk), \
                patch.object(language_service._GEMINI_RATE_LIMITER, 'reserve'):
            request = lambda options: language_service.request_gemini_with_cache(Path(tmp), 'model', 'prompt', {}, extra_config=options)
            self.assertEqual(request(config), '{bad json')
            self.assertEqual(request(config), '{bad json')
            self.assertEqual(generate.call_count, 1)
            self.assertEqual(request({**config, 'bypass_cache': True}), '{"items": []}')
            self.assertEqual(request(config), '{"items": []}')
            self.assertEqual(generate.call_count, 2)
            actual = generate.call_args.kwargs['config']
            self.assertEqual(actual.response_json_schema, schema)
            self.assertEqual(actual.response_mime_type, 'application/json')


if __name__ == '__main__':
    unittest.main()
