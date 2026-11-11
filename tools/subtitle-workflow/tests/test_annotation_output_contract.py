import unittest

from youtube_workflow.annotation_output_contract import (
    annotation_output_schema, inspect_annotation_output, validate_annotation_template,
)


def item(target, **overrides):
    return dict(targetId=target, boundary='word', type='word', meaning='本文意思', memoryHint='记忆提示', **overrides)


class AnnotationOutputContractTests(unittest.TestCase):
    def setUp(self):
        self.template = {'items': [
            {'targetId': 'a', 'markedText': 'appeared', 'sourceSentence': 'It appeared.', 'occurrenceIndex': 0},
            {'targetId': 'b', 'markedText': 'stale'},
        ]}

    def test_schema_limits_fields_and_target_ids(self):
        schema = annotation_output_schema(self.template, joint_meanings=True)
        row = schema['properties']['items']['items']
        self.assertEqual(row['properties']['targetId']['enum'], ['a', 'b'])
        self.assertFalse(row['additionalProperties'])
        self.assertNotIn('markedText', row['properties'])
        self.assertIn('meaning', row['required'])
        self.assertIn('simpleMeaning', row['properties'])

    def test_local_source_wins_and_unknown_fields_are_dropped(self):
        result = item('a')
        result.update(markedText='WRONG', sourceSentence='WRONG', occurrenceIndex=9, surprise='ignored')
        valid, pending, issues = inspect_annotation_output(self.template, {'items': [result, item('alien')]})
        self.assertEqual(valid['items'][0]['markedText'], 'appeared')
        self.assertEqual(valid['items'][0]['sourceSentence'], 'It appeared.')
        self.assertEqual(valid['items'][0]['occurrenceIndex'], 0)
        self.assertNotIn('surprise', valid['items'][0])
        self.assertEqual([i['targetId'] for i in pending], ['b'])
        self.assertIn('unknown', issues)

    def test_duplicate_wrong_type_and_blank_meaning_are_pending(self):
        for rows in [[item('a'), item('a')], [dict(item('a'), meaning={})], [dict(item('a'), meaning='  ')], [dict(item('a'), memoryHint=None)]]:
            with self.subTest(rows=rows):
                valid, pending, _ = inspect_annotation_output(self.template, {'items': rows + [item('b')]})
                self.assertEqual([i['targetId'] for i in valid['items']], ['b'])
                self.assertEqual([i['targetId'] for i in pending], ['a'])

    def test_invalid_optional_short_does_not_discard_detail(self):
        result = dict(item('a'), simpleMeaning={})
        valid, _, _ = inspect_annotation_output(self.template, {'items': [result]}, joint_meanings=True)
        self.assertEqual(valid['items'][0]['simpleMeaning'], '')

    def test_template_requires_unique_nonempty_ids(self):
        for rows in [[{'targetId': 'a'}, {'targetId': 'a'}], [{'targetId': ''}], [None]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                validate_annotation_template({'items': rows})


if __name__ == '__main__':
    unittest.main()
