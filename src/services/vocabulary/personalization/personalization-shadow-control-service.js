export const PERSONALIZATION_SHADOW_CONTROL_VERSION = 'personalization-shadow-control.v1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function localDayAt(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolveContext(input = {}) {
  const now = input.now ?? new Date().toISOString();
  const timezone = input.timezone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    ?? 'UTC';
  const localDay = input.local_day ?? localDayAt(now, timezone);
  return {
    now,
    timezone,
    local_day: localDay,
    session_id: input.session_id ?? `srs-review-ui:${localDay}`,
  };
}

function candidatesFromFrozenLedger(ledger) {
  return ledger.entries.map((entry) => ({
    learning_unit_id: entry.learning_unit_id,
    queue_kind: entry.queue_kind,
    due_at: entry.planned_due_at,
    estimated_duration_ms: entry.estimated_duration_ms,
    enqueue_reason: entry.enqueue_reason,
  }));
}

export function createPersonalizationShadowControlService(options = {}) {
  const {
    acquisitionRepository,
    learningEventRepository,
    sessionLedgerRepository,
    reportRepository,
    shadowRunner,
  } = options;
  const runner = typeof shadowRunner === 'function'
    ? shadowRunner
    : shadowRunner?.run?.bind(shadowRunner);

  async function getCurrentStatus(input = {}) {
    const context = resolveContext(input);
    const [ledger, report] = await Promise.all([
      sessionLedgerRepository.getBySessionId(context.session_id),
      reportRepository.getBySessionId(context.session_id),
    ]);
    return {
      schema_version: PERSONALIZATION_SHADOW_CONTROL_VERSION,
      ...context,
      v2_session_available: Boolean(ledger),
      report_available: Boolean(report),
      session_status: ledger?.status ?? null,
    };
  }

  async function rebuildCurrentReport(input = {}) {
    const context = resolveContext(input);
    const ledger = await sessionLedgerRepository.getBySessionId(context.session_id);
    if (!ledger) {
      return {
        status: 'no_v2_session',
        session_id: context.session_id,
        report: null,
      };
    }
    if (!runner) throw new TypeError('personalization shadow runner is unavailable');

    const [snapshot, events] = await Promise.all([
      acquisitionRepository.loadSnapshot(),
      learningEventRepository.query({}),
    ]);
    const report = await runner({
      session_id: ledger.session_id,
      now: context.now,
      candidates: candidatesFromFrozenLedger(ledger),
      acquisition_snapshot: snapshot,
      baseline_ledger: clone(ledger),
      events,
    });
    return {
      status: 'rebuilt',
      session_id: ledger.session_id,
      report,
    };
  }

  return {
    getCurrentStatus,
    rebuildCurrentReport,
  };
}
