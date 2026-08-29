import {
  ACQUISITION_STATUSES,
} from '../../services/vocabulary/vocabulary-learning-models.js'
import { createVocabularyService } from '../../services/vocabulary/vocabulary-service.js'
import {
  commitPassagePreviewOwnerRecords,
  isPassagePreviewOwnerAuthoritative,
} from './passage-preview-storage.js'

export const PASSAGE_PREVIEW_ACQUISITION_KEY = 'vocabulary.passage-preview.acquisition.v1'
export const PASSAGE_PREVIEW_ACQUISITION_SCHEMA = 'passage-preview.acquisition.v1'
export const PASSAGE_PREVIEW_ACQUISITION_SOURCE = 'cambridge-04-21-reading'
export const PASSAGE_PREVIEW_MINIMUM_DELAY_MS = 86_400_000

export function loadPassagePreviewAcquisitionRecords(storage = globalThis.localStorage) {
  const saved = readJson(storage, PASSAGE_PREVIEW_ACQUISITION_KEY, null)
  if (saved?.schemaVersion !== PASSAGE_PREVIEW_ACQUISITION_SCHEMA || !Array.isArray(saved.records)) return []
  return saved.records.map(normalizeRecord).filter(Boolean)
}

export function savePassagePreviewAcquisitionRecords(records = [], storage = globalThis.localStorage) {
  const normalized = uniqueRecords(records)
  const envelope = {
    schemaVersion: PASSAGE_PREVIEW_ACQUISITION_SCHEMA,
    records: normalized,
  }
  if (isPassagePreviewOwnerAuthoritative()) {
    return commitPassagePreviewOwnerRecords({
      [PASSAGE_PREVIEW_ACQUISITION_KEY]: envelope,
    }).then(() => normalized)
  }
  if (typeof storage?.setItem === 'function') {
    storage.setItem(PASSAGE_PREVIEW_ACQUISITION_KEY, JSON.stringify(envelope))
  }
  return normalized
}

export function createPassagePreviewAcquisitionCoordinator(options = {}) {
  const storage = options.storage || globalThis.localStorage
  const nowProvider = typeof options.now === 'function' ? options.now : () => new Date()
  const vocabularyService = options.vocabularyService || createVocabularyService({
    acquisitionEnabled: true,
    now: nowProvider,
  })
  if (typeof vocabularyService.queuePreviewVocabularyAcquisition !== 'function') {
    throw new Error('Preview acquisition coordinator requires the explicit preview acquisition service')
  }
  const acquisitionRepository = vocabularyService.getAcquisitionRepository?.()
  const acquisitionService = vocabularyService.getAcquisitionService?.()
  if (!acquisitionRepository || !acquisitionService) {
    throw new Error('Preview acquisition coordinator requires acquisition repositories')
  }
  const sourceScope = normalizeText(options.sourceScope) || PASSAGE_PREVIEW_ACQUISITION_SOURCE
  const registrationPromises = new Map()

  async function registerItem(item, inputOptions = {}) {
    const normalizedItem = normalizePreviewItem(item)
    if (!normalizedItem.lemma || !normalizedItem.primaryMeaningZh) return null
    const key = normalizedItem.id || normalizedItem.lemma
    if (registrationPromises.has(key)) return registrationPromises.get(key)
    const promise = registerItemInternal(normalizedItem, inputOptions)
    registrationPromises.set(key, promise)
    try {
      return await promise
    } finally {
      registrationPromises.delete(key)
    }
  }

  async function registerItemInternal(normalizedItem, inputOptions = {}) {
    const records = await rebuildRecordsFromCanonicalRepository()
    const previous = findRecord(records, normalizedItem)
    const introducedAt = previous?.introducedAt
      || normalizeIso(inputOptions.introducedAt)
      || nowIso(nowProvider)
    const context = buildContext(normalizedItem, sourceScope)
    const targetPartOfSpeech = previous ? previous.pos : normalizedItem.pos
    const targetId = `ielts-preview:${normalizedItem.lemma}`
    const result = await vocabularyService.queuePreviewVocabularyAcquisition({
      word: normalizedItem.word || normalizedItem.lemma,
      lemma: normalizedItem.lemma,
      language: 'en',
      meaning: previous?.primaryMeaningZh || normalizedItem.primaryMeaningZh,
      part_of_speech: targetPartOfSpeech || null,
      phonetic: normalizedItem.phonetic || null,
      createdAt: introducedAt,
      target_id: targetId,
      preview_item_id: normalizedItem.id,
      acquisition_identity: {
        source_id: sourceScope,
        target_id: targetId,
      },
      context,
    })
    const unitId = result.learningUnit?.learning_unit_id || previous?.learningUnitId || ''
    const state = unitId
      ? await acquisitionRepository.getState(unitId)
      : result.acquisitionState
    const record = normalizeRecord({
      ...(previous || {}),
      itemKey: itemKey(normalizedItem),
      previewItemId: normalizedItem.id,
      lemma: normalizedItem.lemma,
      word: normalizedItem.word || normalizedItem.lemma,
      primaryMeaningZh: previous?.primaryMeaningZh || normalizedItem.primaryMeaningZh,
      pos: normalizedItem.pos || previous?.pos,
      targetSenseKey: previous?.targetSenseKey || normalizedItem.targetSenseKey,
      learningUnitId: unitId,
      targetSenseId: result.learningUnit?.target_sense_id || previous?.targetSenseId || null,
      contextEvidenceId: state?.validated_anchor_id || previous?.contextEvidenceId || null,
      introducedAt: state?.introduced_at || previous?.introducedAt || introducedAt,
      status: state?.status || result.acquisitionState?.status || previous?.status || 'introduced',
      item: mergeItems(previous?.item, normalizedItem),
      updatedAt: nowIso(nowProvider),
    })
    return { record, result, state }
  }

  async function getDueChecks(inputOptions = {}) {
    if (typeof acquisitionRepository.loadSnapshot !== 'function') return []
    const now = Date.parse(normalizeIso(inputOptions.now) || nowIso(nowProvider))
    const snapshot = await acquisitionRepository.loadSnapshot()
    const records = rebuildRecordsFromSnapshot(snapshot)
    return records.map((record) => {
        const pair = snapshot.by_learning_unit_id?.[record.learningUnitId]
        const state = pair?.acquisition_state
        if (!pair || !state) return null
        if (![ACQUISITION_STATUSES.ACQUIRING, ACQUISITION_STATUSES.READY_FOR_CHECK].includes(state.status)) return null
        if (!state.validated_anchor_id || !state.introduced_at) return null
        if (now - Date.parse(state.introduced_at) < PASSAGE_PREVIEW_MINIMUM_DELAY_MS) return null
        return {
          ...record,
          item: mergeItems(record.item, {
            id: record.previewItemId,
            lemma: record.lemma,
            word: record.word,
            primaryMeaningZh: record.primaryMeaningZh,
            pos: record.pos,
            targetSenseKey: record.targetSenseKey,
          }),
          learningUnit: pair.learning_unit,
          acquisitionState: state,
        }
      })
      .filter(Boolean)
      .sort((left, right) => (
        String(left.acquisitionState.introduced_at).localeCompare(String(right.acquisitionState.introduced_at))
        || left.lemma.localeCompare(right.lemma)
      ))
      .slice(0, Math.max(1, Math.floor(Number(inputOptions.limit) || 50)))
  }

  async function recordDelayedCheck(check, inputOptions = {}) {
    const record = normalizeRecord(check)
    if (!record?.learningUnitId) throw new Error('待考察词缺少 learning unit')
    const occurredAt = normalizeIso(inputOptions.occurredAt) || nowIso(nowProvider)
    const rating = normalizeRating(inputOptions.rating)
    const answerRevealed = inputOptions.answerRevealedBeforeRating === true
    const state = await acquisitionRepository.getState(record.learningUnitId)
    const unit = await acquisitionRepository.getLearningUnit(record.learningUnitId)
    if (!state || !unit) throw new Error('待考察词的 acquisition 状态不存在')
    if (state.status === ACQUISITION_STATUSES.GRADUATED) {
      return { record, graduated: true, status: state.status, graduationEligibility: null }
    }
    if (![ACQUISITION_STATUSES.ACQUIRING, ACQUISITION_STATUSES.READY_FOR_CHECK].includes(state.status)) {
      throw new Error(`当前状态不能进行延迟考察：${state.status}`)
    }

    const commandBase = `ielts-preview:${unit.learning_unit_id}:check:${occurredAt}`
    if (state.status === ACQUISITION_STATUSES.ACQUIRING) {
      await acquisitionService.markReadyForCheck({
        command_id: `${commandBase}:ready`,
        correlation_id: commandBase,
        event_partition: occurredAt.slice(0, 7),
        payload: {
          learning_unit_id: unit.learning_unit_id,
          occurred_at: occurredAt,
        },
      })
    }

    const attemptId = `${commandBase}:attempt`
    const attemptResult = await acquisitionService.recordAcquisitionAttempt({
      command_id: `${commandBase}:attempt-command`,
      correlation_id: commandBase,
      event_partition: occurredAt.slice(0, 7),
      payload: {
        attempt: {
          attempt_id: attemptId,
          learning_unit_id: unit.learning_unit_id,
          target_sense_id: unit.target_sense_id,
          attempt_kind: 'delayed_check',
          episode_id: `${commandBase}:episode`,
          session_id: null,
          session_position: null,
          occurred_at: occurredAt,
          prompt_mode: 'original_context',
          cue_level: 'target_sentence',
          rating,
          answer_revealed_before_rating: answerRevealed,
          context_evidence_id: state.validated_anchor_id,
          duration_ms: normalizeDuration(inputOptions.durationMs),
          active_duration_ms: normalizeDuration(inputOptions.activeDurationMs ?? inputOptions.durationMs),
          extensions: {
            source: 'passage-preview-delayed-check.v1',
            preview_item_id: record.previewItemId,
          },
        },
        event_id: `${commandBase}:attempt-event`,
      },
    })

    let graduation = null
    if (attemptResult.graduation_eligibility?.eligible) {
      graduation = await acquisitionService.graduateLearningUnit({
        command_id: `${commandBase}:graduate-command`,
        correlation_id: commandBase,
        event_partition: occurredAt.slice(0, 7),
        payload: {
          learning_unit_id: unit.learning_unit_id,
          attempt_id: attemptResult.attempt_id,
          graduated_at: occurredAt,
          review_state_id: `vocabulary-review:${unit.learning_unit_id}`,
          scheduler_version: 'fsrs.v1',
          scheduler_parameters_version: 'fsrs-parameters.v1',
          event_id: `${commandBase}:graduated-event`,
        },
      })
    }

    const nextState = await acquisitionRepository.getState(unit.learning_unit_id)
    const updated = normalizeRecord({
      ...record,
      status: nextState?.status || record.status,
      contextEvidenceId: nextState?.validated_anchor_id || record.contextEvidenceId,
      updatedAt: nowIso(nowProvider),
    })
    return {
      record: updated,
      status: nextState?.status || record.status,
      graduated: Boolean(graduation),
      graduation,
      graduationEligibility: attemptResult.graduation_eligibility,
    }
  }

  return {
    registerItem,
    getDueChecks,
    recordDelayedCheck,
    getIntroducedLemmas: async () => (
      await rebuildRecordsFromCanonicalRepository()
    ).map((record) => record.lemma),
    loadRecords: rebuildRecordsFromCanonicalRepository,
    rebuildRecords: rebuildRecordsFromCanonicalRepository,
  }

  async function rebuildRecordsFromCanonicalRepository() {
    if (typeof acquisitionRepository.loadSnapshot !== 'function') return []
    return rebuildRecordsFromSnapshot(await acquisitionRepository.loadSnapshot())
  }

  function rebuildRecordsFromSnapshot(snapshot) {
    const legacyByUnit = new Map(loadPassagePreviewAcquisitionRecords(storage).map((record) => [record.learningUnitId, record]))
    return Object.values(snapshot?.by_learning_unit_id || {})
      .filter((pair) => pair?.learning_unit?.extensions?.source === 'ielts-preview')
      .map((pair) => recordFromCanonicalPair(pair, legacyByUnit.get(pair.learning_unit.learning_unit_id)))
      .filter(Boolean)
  }
}

function recordFromCanonicalPair(pair, legacy = null) {
  const unit = pair?.learning_unit
  const state = pair?.acquisition_state
  if (!unit || !state) return null
  const lemma = normalizeWord(unit.normalized_form)
  if (!lemma) return null
  const meaning = normalizeText(unit.target_sense?.gloss)
  const item = normalizePreviewItem(legacy?.item || {
    id: unit.extensions?.preview_item_id || '',
    lemma,
    word: lemma,
    primaryMeaningZh: meaning,
    pos: unit.target_sense?.part_of_speech || '',
    targetSenseKey: unit.target_sense_key || '',
  })
  return normalizeRecord({
    ...(legacy || {}),
    previewItemId: item.id,
    lemma,
    word: item.word || lemma,
    primaryMeaningZh: item.primaryMeaningZh || meaning,
    pos: item.pos || unit.target_sense?.part_of_speech || '',
    targetSenseKey: item.targetSenseKey || unit.target_sense_key || '',
    learningUnitId: unit.learning_unit_id,
    targetSenseId: unit.target_sense_id,
    contextEvidenceId: state.validated_anchor_id,
    introducedAt: state.introduced_at,
    status: state.status,
    updatedAt: unit.updated_at,
    item,
  })
}

function normalizePreviewItem(item = {}) {
  return {
    id: normalizeText(item.id),
    lemma: normalizeWord(item.lemma || item.word),
    word: normalizeText(item.word || item.lemma),
    primaryMeaningZh: normalizeText(item.primaryMeaningZh),
    pos: normalizeText(item.pos || item.partOfSpeech),
    phonetic: normalizeText(item.phonetic),
    targetSenseKey: normalizeText(item.targetSenseKey),
    previewContext: item.previewContext && typeof item.previewContext === 'object'
      ? clone(item.previewContext)
      : null,
    realSentence: item.realSentence && typeof item.realSentence === 'object'
      ? clone(item.realSentence)
      : null,
  }
}

function buildContext(item, sourceScope) {
  const source = item.previewContext || item.realSentence || null
  if (!source?.sentence) return null
  const sourceKind = normalizeText(source.source_kind || source.sourceKind)
  const isLocal = sourceKind === 'user_local_exam_material' || !sourceKind
  const context = {
    sentence: source.sentence,
    surrounding_text: source.surrounding_text || source.surroundingText || null,
    source_kind: isLocal ? 'user_local_exam_material' : sourceKind,
    source_id: normalizeText(source.source_id || source.sourceId || `${sourceScope}:${item.lemma}`),
    source_title: normalizeText(source.source_title || source.sourceTitle || source.source?.name)
      || '剑桥雅思阅读本地语料',
    source_locator: source.source_locator || source.sourceLocator || {
      locator_version: 'source-locator.v1',
      local_locator: `${sourceScope}:${item.lemma}`,
    },
    license_kind: source.license_kind || source.licenseKind || (isLocal ? 'user_owned' : 'licensed_open'),
    ownership: source.ownership || (isLocal ? 'private' : 'public'),
    quality_status: source.quality_status || source.qualityStatus || (isLocal ? 'validated' : 'pending'),
    quality_reason: source.quality_reason || source.qualityReason || '预习上下文已通过来源校验',
    validated_at: source.validated_at || source.validatedAt || null,
    extensions: {
      ...(source.extensions || {}),
      preview_item_id: item.id,
    },
  }
  return context
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null
  const lemma = normalizeWord(value.lemma || value.item?.lemma || value.item?.word)
  const learningUnitId = normalizeText(value.learningUnitId || value.learning_unit_id)
  if (!lemma || !learningUnitId) return null
  const item = normalizePreviewItem(value.item || value)
  return {
    schemaVersion: PASSAGE_PREVIEW_ACQUISITION_SCHEMA,
    itemKey: normalizeText(value.itemKey) || itemKey(item),
    previewItemId: normalizeText(value.previewItemId || item.id),
    lemma,
    word: normalizeText(value.word || item.word) || lemma,
    primaryMeaningZh: normalizeText(value.primaryMeaningZh || item.primaryMeaningZh),
    pos: normalizeText(value.pos || item.pos),
    targetSenseKey: normalizeText(value.targetSenseKey || item.targetSenseKey),
    learningUnitId,
    targetSenseId: normalizeText(value.targetSenseId) || null,
    contextEvidenceId: normalizeText(value.contextEvidenceId) || null,
    introducedAt: normalizeIso(value.introducedAt) || null,
    status: normalizeText(value.status) || 'introduced',
    updatedAt: normalizeIso(value.updatedAt) || null,
    item: mergeItems(item, {
      id: normalizeText(value.previewItemId || item.id),
      lemma,
      word: normalizeText(value.word || item.word) || lemma,
      primaryMeaningZh: normalizeText(value.primaryMeaningZh || item.primaryMeaningZh),
      pos: normalizeText(value.pos || item.pos),
      targetSenseKey: normalizeText(value.targetSenseKey || item.targetSenseKey),
    }),
  }
}

function uniqueRecords(records) {
  const byKey = new Map()
  ;(Array.isArray(records) ? records : []).forEach((record) => {
    const normalized = normalizeRecord(record)
    if (normalized) byKey.set(normalized.itemKey, normalized)
  })
  return [...byKey.values()]
}

function findRecord(records, item) {
  const key = itemKey(item)
  return records.find((record) => record.itemKey === key)
    || records.find((record) => record.lemma === item.lemma)
    || null
}

function itemKey(item) {
  return `${normalizeWord(item?.lemma || item?.word)}\u001f${normalizeText(item?.targetSenseKey) || normalizeText(item?.primaryMeaningZh)}`
}

function mergeItems(previous, next) {
  const left = previous && typeof previous === 'object' ? previous : {}
  const right = next && typeof next === 'object' ? next : {}
  return {
    ...left,
    ...right,
    id: normalizeText(right.id || left.id),
    lemma: normalizeWord(right.lemma || left.lemma),
    word: normalizeText(right.word || left.word),
    primaryMeaningZh: normalizeText(right.primaryMeaningZh || left.primaryMeaningZh),
    pos: normalizeText(right.pos || left.pos),
    phonetic: normalizeText(right.phonetic || left.phonetic),
    targetSenseKey: normalizeText(right.targetSenseKey || left.targetSenseKey),
    previewContext: right.previewContext || left.previewContext || null,
    realSentence: right.realSentence || left.realSentence || null,
  }
}

function normalizeRating(value) {
  const rating = normalizeText(value).toLowerCase()
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('无效的延迟考察评分')
  return rating
}

function normalizeDuration(value) {
  const duration = Math.floor(Number(value))
  return Number.isFinite(duration) && duration >= 0 ? duration : 0
}

function nowIso(nowProvider) {
  const value = nowProvider()
  return new Date(value).toISOString()
}

function normalizeIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
