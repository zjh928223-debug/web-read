"""Constrain generated fields; keep source identity owned by the reader."""

from collections import Counter

from .annotation_backfill_template import normalize_annotation_simple_meanings

CONTRACT_VERSION = 'annotation-output.v1'
GENERATED_FIELDS = ('boundary', 'type', 'meaning', 'memoryHint')
SOURCE_FIELDS = ('markedText', 'sourceSentence', 'occurrenceIndex')


def validate_annotation_template(template: dict) -> None:
    rows = template.get('items')
    if not isinstance(rows, list):
        raise ValueError('template with items array is required')
    seen = set()
    for row in rows:
        target = row.get('targetId') if isinstance(row, dict) else None
        if not isinstance(target, str) or not target.strip() or target != target.strip() or target in seen:
            raise ValueError('annotation template requires unique nonempty targetId strings')
        seen.add(target)
        for field in SOURCE_FIELDS[:2]:
            if field in row and not isinstance(row[field], str):
                raise ValueError(f'annotation template {field} must be a string')
        if 'occurrenceIndex' in row and (type(row['occurrenceIndex']) is not int or row['occurrenceIndex'] < 0):
            raise ValueError('annotation template occurrenceIndex must be a nonnegative integer')


def annotation_output_schema(template: dict, *, joint_meanings=False) -> dict:
    properties = {field: {'type': 'string'} for field in GENERATED_FIELDS}
    properties = {'targetId': {'type': 'string', 'enum': [row['targetId'] for row in template['items']]}, **properties}
    if joint_meanings:
        properties['simpleMeaning'] = {'type': 'string'}
    return {
        'type': 'object', 'additionalProperties': False, 'required': ['items'],
        'properties': {'items': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['targetId', *GENERATED_FIELDS], 'properties': properties,
        }}},
    }


def inspect_annotation_output(template: dict, result: dict, *, joint_meanings=False):
    rows = result.get('items') if isinstance(result, dict) else None
    if not isinstance(rows, list):
        raise ValueError('annotation response requires an items array')
    requested = {row['targetId']: row for row in template['items']}
    counts = Counter(row.get('targetId') for row in rows
                     if isinstance(row, dict) and isinstance(row.get('targetId'), str))
    valid = {}
    issues = set()
    for row in rows:
        target = row.get('targetId') if isinstance(row, dict) else None
        if not isinstance(target, str) or target not in requested:
            issues.add('unknown')
            continue
        if counts[target] != 1:
            issues.add('duplicate')
            continue
        if any(not isinstance(row.get(field), str) for field in GENERATED_FIELDS):
            issues.add('field-type')
            continue
        if any(not row[field].strip() for field in ('boundary', 'type', 'meaning')):
            issues.add('empty-field')
            continue
        normalized = {'targetId': target, **{field: row[field].strip() for field in GENERATED_FIELDS}}
        normalized.update({field: requested[target][field] for field in SOURCE_FIELDS if field in requested[target]})
        if joint_meanings and 'simpleMeaning' in row:
            normalized['simpleMeaning'] = row['simpleMeaning']
        valid[target] = normalized
    accepted = {'items': [valid[row['targetId']] for row in template['items'] if row['targetId'] in valid]}
    if joint_meanings:
        normalize_annotation_simple_meanings(template, accepted)
    pending = [row for row in template['items'] if row['targetId'] not in valid]
    if pending:
        issues.add('missing-or-invalid')
    return accepted, pending, issues
