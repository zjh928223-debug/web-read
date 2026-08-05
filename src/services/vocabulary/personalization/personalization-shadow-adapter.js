import { normalizeSkillTags } from './skill-taxonomy.js';

export const PERSONALIZATION_SHADOW_ADAPTER_VERSION = 'personalization-shadow-adapter.v1';
export const PERSONALIZATION_SHADOW_INPUT_SCHEMA_VERSION = 'personalization-shadow-input.v1';

const DEFAULT_PRESENTATIONS = Object.freeze(['word_only', 'original_context']);
const POS_SKILL_IDS = Object.freeze({
  noun: 'pos.noun',
  verb: 'pos.verb',
  adjective: 'pos.adjective',
  adverb: 'pos.adverb',
});

export class PersonalizationShadowContractError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PersonalizationShadowContractError';
    this.code = code;
    this.details = clone(details);
  }
}

function fail(code, message, details = {}) {
  throw new PersonalizationShadowContractError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function object(value) {
  return isPlainObject(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function nestedValue(source, names) {
  const input = object(source);
  const payload = object(input.payload);
  const extensions = object(input.extensions);
  for (const name of names) {
    if (input[name] !== undefined && input[name] !== null) return input[name];
    if (payload[name] !== undefined && payload[name] !== null) return payload[name];
    if (extensions[name] !== undefined && extensions[name] !== null) return extensions[name];
  }
  return undefined;
}

function pairSkillTags(pair) {
  const source = object(pair);
  const unit = object(source.learning_unit);
  const state = object(source.acquisition_state);
  const unitExtensions = object(unit.extensions);
  const stateExtensions = object(state.extensions);
  const declared = [
    ...stringArray(unitExtensions.skill_tags),
    ...stringArray(stateExtensions.skill_tags),
  ];
  const partOfSpeech = text(object(unit.target_sense).part_of_speech)?.toLowerCase();
  if (partOfSpeech && POS_SKILL_IDS[partOfSpeech]) declared.push(POS_SKILL_IDS[partOfSpeech]);
  return normalizeSkillTags(declared).known_skill_tags;
}

function eventSkillTags(event, fallback = []) {
  const declared = nestedValue(event, ['skill_tags', 'skillTags', 'skills', 'skill_ids']);
  const normalized = normalizeSkillTags(Array.isArray(declared) ? declared : fallback);
  return normalized.skill_tags;
}

function eventContentStatus(event, fallback = 'unknown') {
  const value = text(nestedValue(event, [
    'content_status',
    'contentStatus',
    'content_quality_status',
  ]));
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (['valid', 'validated', 'available', 'authentic', 'usable', 'ok'].includes(normalized)) return 'valid';
  if (['invalid', 'rejected', 'unavailable', 'unusable'].includes(normalized)) return 'invalid';
  return 'unknown';
}

function presentationVariant(event) {
  return text(nestedValue(event, [
    'presentation_variant',
    'presentationVariant',
    'variant_id',
    'prompt_mode',
  ]));
}

function buildUnitMetadata(acquisitionSnapshot) {
  const snapshot = object(acquisitionSnapshot);
  const pairs = object(snapshot.by_learning_unit_id);
  return Object.fromEntries(Object.entries(pairs).map(([learningUnitId, pair]) => {
    const source = object(pair);
    const state = object(source.acquisition_state);
    const unit = object(source.learning_unit);
    const explicitPresentations = stringArray(object(unit.extensions).allowed_presentations);
    const graduated = state.status === 'graduated';
    return [learningUnitId, {
      learning_unit_id: learningUnitId,
      display_label: text(unit.normalized_form) ?? learningUnitId,
      skill_tags: pairSkillTags(source),
      allowed_presentations: explicitPresentations.length > 0
        ? explicitPresentations
        : [...DEFAULT_PRESENTATIONS],
      content_status: graduated && text(state.validated_anchor_id) ? 'available' : 'missing',
      maturity: object(source.review_state).state === 'review' ? 'mature' : 'not_mature',
    }];
  }));
}

export function adaptLearningEventsForPersonalization(events, options = {}) {
  if (!Array.isArray(events)) {
    fail('INVALID_FIELD_TYPE', 'events must be an array', { field: 'events' });
  }
  const unitMetadata = object(options.unit_metadata);
  const diagnostics = {
    event_count: events.length,
    missing_skill_tag_count: 0,
    unknown_content_status_count: 0,
    missing_presentation_variant_count: 0,
  };
  const skillEvents = [];
  const preferenceEvents = [];

  for (const rawEvent of events) {
    const event = object(rawEvent);
    const learningUnitId = text(event.learning_unit_id);
    const metadata = learningUnitId ? object(unitMetadata[learningUnitId]) : {};
    const skillTags = eventSkillTags(event, stringArray(metadata.skill_tags));
    const contentStatus = eventContentStatus(
      event,
      metadata.content_status === 'available' ? 'valid' : 'unknown',
    );
    const variant = presentationVariant(event);
    if (skillTags.length === 0) diagnostics.missing_skill_tag_count += 1;
    if (contentStatus === 'unknown') diagnostics.unknown_content_status_count += 1;
    if (!variant) diagnostics.missing_presentation_variant_count += 1;

    skillEvents.push({
      ...clone(event),
      skill_tags: skillTags,
      content_status: contentStatus,
      payload: {
        ...clone(object(event.payload)),
        skill_tags: skillTags,
        content_status: contentStatus,
      },
    });
    preferenceEvents.push({
      ...clone(event),
      presentation_variant: variant,
      content_status: contentStatus,
      active_duration_reliable: nestedValue(event, [
        'active_duration_reliable',
        'activeDurationReliable',
      ]),
    });
  }

  return {
    schema_version: PERSONALIZATION_SHADOW_INPUT_SCHEMA_VERSION,
    adapter_version: PERSONALIZATION_SHADOW_ADAPTER_VERSION,
    skill_events: skillEvents,
    preference_events: preferenceEvents,
    diagnostics,
  };
}

function candidateUrgency(candidate) {
  const kind = text(candidate.queue_kind);
  if (kind === 'relearning') return 1;
  if (kind === 'revisit') return 0.95;
  if (kind === 'due_review') return 0.9;
  return 0.5;
}

export function buildPersonalizationShadowInput(input) {
  if (!isPlainObject(input)) {
    fail('INVALID_FIELD_TYPE', 'shadow input must be a plain object', { field: 'input' });
  }
  if (!Array.isArray(input.candidates)) {
    fail('INVALID_FIELD_TYPE', 'candidates must be an array', { field: 'candidates' });
  }
  if (!Array.isArray(input.events)) {
    fail('INVALID_FIELD_TYPE', 'events must be an array', { field: 'events' });
  }
  const baselineLedger = object(input.baseline_ledger);
  const unitMetadata = buildUnitMetadata(input.acquisition_snapshot);
  const adaptedEvents = adaptLearningEventsForPersonalization(input.events, {
    unit_metadata: unitMetadata,
  });
  const variantsSeenByUnit = new Map();
  const recentPresentationByUnit = new Map();
  for (const event of adaptedEvents.preference_events) {
    const unitId = text(event.learning_unit_id);
    const variant = text(event.presentation_variant);
    if (!unitId || !variant) continue;
    if (!variantsSeenByUnit.has(unitId)) variantsSeenByUnit.set(unitId, new Set());
    variantsSeenByUnit.get(unitId).add(variant);
    recentPresentationByUnit.set(unitId, variant);
  }

  const candidates = input.candidates.map((rawCandidate, index) => {
    if (!isPlainObject(rawCandidate)) {
      fail('INVALID_FIELD_TYPE', 'candidate must be a plain object', { field: `candidates[${index}]` });
    }
    const learningUnitId = text(rawCandidate.learning_unit_id);
    if (!learningUnitId) {
      fail('MISSING_REQUIRED_FIELD', 'candidate learning_unit_id is required', {
        field: `candidates[${index}].learning_unit_id`,
      });
    }
    const metadata = object(unitMetadata[learningUnitId]);
    const observedVariants = [...(variantsSeenByUnit.get(learningUnitId) ?? [])];
    const allowedPresentations = stringArray([
      ...stringArray(metadata.allowed_presentations),
      ...observedVariants,
    ]);
    return {
      learning_unit_id: learningUnitId,
      due_at: rawCandidate.due_at ?? null,
      eligible: true,
      memory_priority: candidateUrgency(rawCandidate),
      importance: 0.5,
      skill_tags: stringArray(metadata.skill_tags),
      estimated_duration_ms: rawCandidate.estimated_duration_ms,
      allowed_presentations: allowedPresentations.length > 0
        ? allowedPresentations
        : [...DEFAULT_PRESENTATIONS],
      content_status: metadata.content_status ?? 'missing',
      queue_kind: rawCandidate.queue_kind === 'revisit' ? 'relearning' : rawCandidate.queue_kind,
      maturity: metadata.maturity ?? 'not_mature',
      extensions: {
        baseline_queue_kind: rawCandidate.queue_kind ?? null,
        baseline_enqueue_reason: rawCandidate.enqueue_reason ?? null,
      },
    };
  });

  return {
    schema_version: PERSONALIZATION_SHADOW_INPUT_SCHEMA_VERSION,
    adapter_version: PERSONALIZATION_SHADOW_ADAPTER_VERSION,
    session_id: text(baselineLedger.session_id) ?? text(input.session_id),
    as_of: text(input.now) ?? text(baselineLedger.created_at),
    time_budget_ms: baselineLedger.budget_ms,
    baseline_ledger: clone(baselineLedger),
    unit_labels: Object.fromEntries(Object.entries(unitMetadata).map(([unitId, metadata]) => [
      unitId,
      text(metadata.display_label) ?? unitId,
    ])),
    recent_presentations: Object.fromEntries(recentPresentationByUnit),
    candidates,
    skill_events: adaptedEvents.skill_events,
    preference_events: adaptedEvents.preference_events,
    diagnostics: adaptedEvents.diagnostics,
  };
}

export function compareShadowPlanWithBaseline(baselineLedger, shadowPlan) {
  const baselineEntries = Array.isArray(baselineLedger?.entries) ? baselineLedger.entries : [];
  const shadowEntries = Array.isArray(shadowPlan?.decisions) ? shadowPlan.decisions : [];
  const baselineIds = baselineEntries.map((entry) => entry.learning_unit_id);
  const shadowIds = shadowEntries.map((entry) => entry.learning_unit_id);
  const baselinePositions = new Map(baselineIds.map((id, index) => [id, index]));
  const shadowPositions = new Map(shadowIds.map((id, index) => [id, index]));
  const allIds = [...new Set([...baselineIds, ...shadowIds])].sort((a, b) => a.localeCompare(b));
  const moved = allIds
    .map((learningUnitId) => ({
      learning_unit_id: learningUnitId,
      baseline_position: baselinePositions.has(learningUnitId)
        ? baselinePositions.get(learningUnitId)
        : null,
      shadow_position: shadowPositions.has(learningUnitId)
        ? shadowPositions.get(learningUnitId)
        : null,
    }))
    .filter((row) => row.baseline_position !== row.shadow_position);
  const sameMembership = baselineIds.length === shadowIds.length
    && baselineIds.every((id) => shadowPositions.has(id));
  return {
    schema_version: 'personalization-shadow-comparison.v1',
    baseline_learning_unit_ids: baselineIds,
    shadow_learning_unit_ids: shadowIds,
    same_membership: sameMembership,
    same_order: sameMembership && baselineIds.every((id, index) => shadowIds[index] === id),
    moved,
    baseline_count: baselineIds.length,
    shadow_count: shadowIds.length,
  };
}
