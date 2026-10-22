"""Rebind copied runtime paths through the existing durable envelope writers."""
import json
import sys
from pathlib import Path

daily_root = Path('E:/ReadWebDaily/N5-20261007')
sys.path.insert(0, str(daily_root / 'tools/subtitle-workflow'))
from youtube_workflow.durable_json import DurableJsonRepository
from youtube_workflow.history import _make_envelope, _validate_envelope
from youtube_workflow.reader_marks_activity import ReaderMarksActivityRepository

source = Path('E:/ReadWebData/SubtitleWorkflow-Optimization')
target = Path('E:/ReadWebData/SubtitleWorkflow-Daily-N5')
evidence = Path('C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007')
if (evidence / 'durable-data-path-rebinding.json').exists():
    raise RuntimeError('One-time relocation already completed; never rewrite live daily data')
old_prefix, new_prefix = str(source), str(target)
repository = DurableJsonRepository()
changes = []

def transform(value, reverse=False):
    before, after = (new_prefix, old_prefix) if reverse else (old_prefix, new_prefix)
    if isinstance(value, str):
        normalized = value.replace('/', '\\')
        if normalized.lower() == before.lower() or normalized.lower().startswith(before.lower() + '\\'):
            return after + normalized[len(before):]
        return value
    if isinstance(value, list):
        return [transform(item, reverse) for item in value]
    if isinstance(value, dict):
        return {key: transform(item, reverse) for key, item in value.items()}
    return value

for relative_root in ['.workflow_state', 'output']:
    for original_file in (source / relative_root).rglob('*.json'):
        original = json.loads(original_file.read_text(encoding='utf-8-sig'))
        rebound = transform(original)
        if rebound == original:
            continue
        assert transform(rebound, reverse=True) == original, 'Mapping must preserve all original fields'
        relative = original_file.relative_to(source)
        destination = target / relative
        if original.get('domain') in ['workflow.jobs', 'workflow.history'] and 'payload' in original:
            key = 'jobs' if original['domain'] == 'workflow.jobs' else 'items'
            rebound = _make_envelope(original['domain'], key, rebound['payload'], original['revision'] + 1)
            _validate_envelope(rebound, domain=original['domain'], key=key)
        elif original.get('domain') in ['reader-activity', 'reader-marks'] and 'payload' in original:
            kind = 'activity' if original['domain'] == 'reader-activity' else 'marks'
            rebound = ReaderMarksActivityRepository._make_envelope(
                original['schemaVersion'], kind, original['jobId'], original['revision'] + 1, rebound['payload'])
        repository.write(destination, rebound)
        reread = json.loads(destination.read_text(encoding='utf-8'))
        assert reread == rebound
        if original.get('domain') in ['reader-activity', 'reader-marks'] and 'payload' in original:
            reader_repository = ReaderMarksActivityRepository(repository)
            if kind == 'activity':
                reader_repository.read_activity(destination, original['jobId'])
            else:
                reader_repository.read_marks(destination, original['jobId'])
        changes.append({'path':str(relative), 'originalRevision':original.get('revision'),
                        'newRevision':rebound.get('revision'), 'payloadPreservedExceptPathPrefix':True})

(evidence / 'durable-data-path-rebinding.json').write_text(json.dumps({
    'passed':True, 'changes':changes, 'rule':'Original records preserved; envelope revisions/checksums written by existing module helpers',
}, indent=2), encoding='utf-8')
print(json.dumps({'passed':True, 'files':len(changes)}))
