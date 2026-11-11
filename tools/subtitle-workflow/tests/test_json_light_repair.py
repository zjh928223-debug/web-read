import json
import unittest

from language_service import lightly_repair_json_text, parse_json_with_light_repair
from youtube_workflow.annotation_backfill_template import (
    parse_annotation_backfill_response,
    validate_annotation_backfill_batch_result,
)


class JsonLightRepairTests(unittest.TestCase):
    def test_diff_marker_is_removed_without_rewriting_chinese_quotes(self):
        raw = '''{
  "items": [
    {"targetId": "appeared", "memoryHint": "指UI元素的“浮现”或“加载显示”。"},
    {
      "targetId": "stale",
      "meaning": "过时的数据",
-      "memoryHint": "stale 原义是‘不新鲜的’，这里指旧数据。"
    }
  ]
}'''
        parsed = parse_annotation_backfill_response(raw)
        self.assertEqual(parsed['items'][0]['memoryHint'], '指UI元素的“浮现”或“加载显示”。')
        self.assertEqual(parsed['items'][1]['memoryHint'], 'stale 原义是‘不新鲜的’，这里指旧数据。')
        validate_annotation_backfill_batch_result(
            {'items': [{'targetId': 'appeared'}, {'targetId': 'stale'}]}, parsed,
        )

    def test_other_repairs_do_not_change_json_examples_inside_strings(self):
        value = '示例 {name: value,}，他说“出现”，it’s ready；逗号 ,} 应保留。'
        raw = '{items: [{"targetId": "a", "memoryHint": ' + json.dumps(value, ensure_ascii=False) + ',}],}'
        self.assertEqual(parse_json_with_light_repair(raw)['items'][0]['memoryHint'], value)

    def test_escaped_quotes_and_backslashes_are_preserved(self):
        value = '显示 "hello"；路径 C:\\notes；“引用”'
        raw = '{items: [{"memoryHint": ' + json.dumps(value, ensure_ascii=False) + ',}],}'
        self.assertEqual(parse_json_with_light_repair(raw)['items'][0]['memoryHint'], value)

    def test_fenced_json_with_a_diff_marker(self):
        self.assertEqual(parse_json_with_light_repair('```json\n{\n- "items": []\n}\n```'), {'items': []})

    def test_structural_smart_quotes_still_work(self):
        self.assertEqual(parse_json_with_light_repair('{“items”: []}'), {'items': []})

    def test_valid_json_is_unchanged(self):
        value = {'items': [{'memoryHint': '- "meaning": “文字”', 'occurrenceIndex': -1}]}
        raw = json.dumps(value, ensure_ascii=False)
        self.assertEqual(lightly_repair_json_text(raw), raw)
        self.assertEqual(parse_json_with_light_repair(raw), value)

    def test_negative_numbers_are_not_diff_markers(self):
        self.assertEqual(parse_json_with_light_repair('{items: [\n-2,],}'), {'items': [-2]})

    def test_ambiguous_or_truncated_json_is_rejected(self):
        for raw in ['{"items": [{"targetId": "a" "meaning": "x"}]}', '{"items": [{"targetId": "a"}']:
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                parse_json_with_light_repair(raw)


if __name__ == '__main__':
    unittest.main()
