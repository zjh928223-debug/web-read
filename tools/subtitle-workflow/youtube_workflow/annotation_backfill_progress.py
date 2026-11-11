"""Atomic, input-scoped checkpoints, separate from published complete versions."""

import hashlib
import json

from .annotation_output_contract import CONTRACT_VERSION, inspect_annotation_output
from .durable_json import DurableJsonRepository


class AnnotationBackfillProgress:
    def __init__(self, directory, template, model, base_url, prompt, joint_meanings, batches):
        identity = {'contract': CONTRACT_VERSION, 'template': template, 'model': model,
                    'baseUrl': base_url, 'prompt': prompt, 'jointMeanings': joint_meanings, 'batches': batches}
        self.fingerprint = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode('utf8')).hexdigest()
        self.path = directory / 'progress' / f'{self.fingerprint}.json'
        self.template = template
        self.joint_meanings = joint_meanings
        self.repository = DurableJsonRepository()
        self.items = {}
        outcome = self.repository.read(self.path)
        if outcome.status == 'missing':
            if any(self.path.parent.glob(f'{self.path.name}.corrupt-*')):
                raise RuntimeError('解释进度存在待恢复文件，未重新请求或覆盖。')
            return
        if outcome.status not in {'ok', 'recovered'}:
            raise RuntimeError(f'解释进度读取失败（{outcome.status}），已保留恢复文件。')
        saved = outcome.value
        if not isinstance(saved, dict) or saved.get('fingerprint') != self.fingerprint or saved.get('schemaVersion') != 1:
            raise RuntimeError('解释进度格式不匹配，未覆盖已有文件。')
        validated, _, issues = inspect_annotation_output(template, saved.get('result'), joint_meanings=joint_meanings)
        if issues - {'missing-or-invalid'}:
            raise RuntimeError('已保存解释进度未通过校验，未覆盖已有文件。')
        if len(validated['items']) != len(saved.get('result', {}).get('items', [])):
            raise RuntimeError('已保存解释进度存在无效条目，未覆盖已有文件。')
        self.items = {row['targetId']: row for row in validated['items']}

    def accept(self, result):
        next_items = {**self.items, **{row['targetId']: row for row in result['items']}}
        ordered = [next_items[row['targetId']] for row in self.template['items'] if row['targetId'] in next_items]
        self.repository.write(self.path, {
            'schemaVersion': 1, 'fingerprint': self.fingerprint,
            'result': {'items': ordered},
            'pendingTargetIds': [row['targetId'] for row in self.template['items'] if row['targetId'] not in next_items],
        })
        # A failed atomic write must not be reported as saved in memory either.
        self.items = next_items

    def result(self):
        return {'items': [self.items[row['targetId']] for row in self.template['items'] if row['targetId'] in self.items]}
