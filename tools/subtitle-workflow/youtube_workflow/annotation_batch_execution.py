"""Validate and durably retain good targets before retrying the remainder."""

import time

from .annotation_backfill_progress import AnnotationBackfillProgress
from .annotation_output_contract import annotation_output_schema, inspect_annotation_output
from .annotation_backfill_template import (
    is_transient_annotation_backfill_error, parse_annotation_backfill_response,
    scope_annotation_backfill_template,
)


def execute_annotation_batches(template, batches, *, directory, run_id, model, base_url,
                               prompt, joint_meanings, api_key, requester, cache_dir,
                               max_retries, retry_delay, retry_jitter, check_control,
                               cancel_event, deadline, write_json, log):
    progress = AnnotationBackfillProgress(directory, template, model, base_url, prompt, joint_meanings, batches)
    resumed = len(progress.items)
    retries = 0
    total = len(template['items'])
    if resumed:
        log(f'已恢复解释进度 {resumed}/{total} 条，仅处理未完成目标。')
    try:
        for batch_index, batch in enumerate(batches, start=1):
            pending = [row for row in batch['items'] if row['targetId'] not in progress.items]
            bypass_cache = False
            for attempt in range(max_retries + 1):
                check_control()
                if not pending:
                    break
                scoped = scope_annotation_backfill_template(batch, pending)
                write_json(directory/'runs'/f'{run_id}-batch-{batch_index}-attempt-{attempt}-template.json', scoped)
                log(f'request batch {batch_index}/{len(batches)} attempt={attempt + 1} items={len(pending)}')
                config = {
                    'api_key': api_key, 'base_url': base_url, 'temperature': 0.1,
                    'response_mime_type': 'application/json',
                    'response_json_schema': annotation_output_schema(scoped, joint_meanings=joint_meanings),
                    'bypass_cache': bypass_cache,
                    'deadline': time.time() + max(0.0, deadline - time.monotonic()) if deadline else None,
                }
                try:
                    response_text = requester(cache_dir, model, prompt, scoped,
                                              extra_config=config, log_func=log, log_prefix='annotation-backfill')
                except Exception as exc:
                    check_control()
                    if not is_transient_annotation_backfill_error(exc):
                        raise
                    reason = str(exc)
                else:
                    check_control()
                    try:
                        parsed = parse_annotation_backfill_response(response_text, log_func=log)
                        accepted, missing, issues = inspect_annotation_output(scoped, parsed, joint_meanings=joint_meanings)
                    except (RuntimeError, ValueError) as exc:
                        # Preserve the response for diagnosis, but do not publish it.
                        (directory/'latest-result.raw.txt').write_text(str(response_text or ''), encoding='utf8')
                        (directory/'runs'/f'{run_id}-batch-{batch_index}-attempt-{attempt}-result.raw.txt').write_text(
                            str(response_text or ''), encoding='utf8')
                        reason = str(exc)
                    else:
                        if accepted['items']:
                            progress.accept(accepted)
                            log(f'已保存解释进度 {len(progress.items)}/{total} 条。')
                        pending = missing
                        if not pending:
                            write_json(directory/'runs'/f'{run_id}-batch-{batch_index}-result.json', {
                                'items': [progress.items[row['targetId']] for row in batch['items']],
                            })
                            break
                        reason = f'本地校验：{", ".join(sorted(issues))}；剩余 {len(pending)} 条'
                    # A syntax/contract retry must not replay the same cached bad response.
                    bypass_cache = True
                if attempt >= max_retries:
                    raise RuntimeError(reason)
                retries += 1
                log(f'仅重试未完成部分 {len(pending)} 条，retry {attempt + 1}/{max_retries}。')
                wait = retry_delay * (2 ** attempt)
                wait += retry_jitter(wait)
                if deadline is not None:
                    wait = min(wait, max(0.0, deadline - time.monotonic()))
                if cancel_event is not None:
                    cancel_event.wait(wait)
                elif wait:
                    time.sleep(wait)
                check_control()
        check_control()
    except Exception as exc:
        check_control()  # Preserve cancellation/deadline classification.
        raise RuntimeError(
            f'AI解释未完成：已保存 {len(progress.items)}/{total} 条，剩余 {total - len(progress.items)} 条。'
            f'再次开始会继续未完成部分。原因：{exc}'
        ) from exc
    return progress.result(), retries, resumed
