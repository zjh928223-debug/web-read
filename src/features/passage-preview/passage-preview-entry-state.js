export const PASSAGE_PREVIEW_ENTRY_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  NO_CANDIDATES: 'no-candidates',
  LEGACY_FORMAT: 'legacy-format',
  READ_ERROR: 'read-error',
  WRITE_UNAVAILABLE: 'write-unavailable',
})

const SOURCE_KIND_LABELS = Object.freeze({
  user_local_exam_material: '本地导入材料',
  article: '文章语料',
  subtitle: '字幕语料',
  open_corpus: '开放语料',
  dictionary_example: '词典例句',
  ai_generated: 'AI 辅助例句',
  ai_candidate: 'AI 辅助候选',
})

export function getPassagePreviewEntryCopy(
  state,
  { message = '', itemCount = 0, waitingCount = null, waitingKnown = false } = {},
) {
  const count = Math.max(0, Number(itemCount) || 0)
  const waiting = waitingKnown && Number.isFinite(Number(waitingCount))
    ? `等待池：${Math.max(0, Number(waitingCount))} 个词`
    : '等待池：未知（当前无法读取 Host 汇总）'
  const copy = {
    [PASSAGE_PREVIEW_ENTRY_STATES.IDLE]: {
      label: '待预习',
      title: '待预习面板已打开',
      description: message || '正在等待可用的预习批次。',
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.LOADING]: {
      label: '待预习',
      title: '正在读取待预习内容',
      description: message || '正在读取已保存批次和当前候选。',
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.READY]: {
      label: '本组摘要',
      title: `${count} 个词已准备好`,
      description: `${waiting}。以下来源、定位和选择依据只展示当前记录明确提供的内容。`,
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.NO_CANDIDATES]: {
      label: '待预习',
      title: '当前没有可用待预习词',
      description: message || `${waiting}。已保存数据不会因本次读取失败被清空；可以稍后重试或显式导入新版词包。`,
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.LEGACY_FORMAT]: {
      label: '旧格式数据',
      title: '发现旧版预习数据',
      description: message || '旧版数据仍保留。请显式导入新版首次接触词包，或稍后重试读取。',
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.READ_ERROR]: {
      label: '读取失败',
      title: '待预习内容暂时不可读',
      description: message || 'Host 读取失败；已保存批次不会被清空，请修复连接后重试。',
    },
    [PASSAGE_PREVIEW_ENTRY_STATES.WRITE_UNAVAILABLE]: {
      label: '只读查看',
      title: '内容可查看，但当前不可保存',
      description: message || '当前保存通道不可用。已显示的数据只读，恢复保存后再继续接触登记。',
    },
  }
  return copy[state] || copy[PASSAGE_PREVIEW_ENTRY_STATES.IDLE]
}

export function buildPassagePreviewGroupSummary(items = []) {
  const normalized = Array.isArray(items) ? items : []
  const rows = normalized.map((item, index) => {
    const context = item?.previewContext && typeof item.previewContext === 'object'
      ? item.previewContext
      : null
    const source = item?.realSentence?.source && typeof item.realSentence.source === 'object'
      ? item.realSentence.source
      : null
    const sourceKind = normalizeText(context?.source_kind || context?.sourceKind || source?.kind)
    const sourceName = normalizeText(
      context?.source_title
      || context?.sourceTitle
      || source?.name
      || item?.source,
    )
    const locator = formatLocator(
      context?.source_locator
      || context?.sourceLocator
      || context?.source_id
      || context?.sourceId
      || source?.recordId,
    )
    const book = Number(item?.ieltsDifficultyBook || item?.difficultyBook)
    const sourceParts = [
      sourceKind ? (SOURCE_KIND_LABELS[sourceKind] || sourceKind) : '',
      sourceName,
      Number.isInteger(book) && book > 0 ? `Book ${book}（仅表示现有来源范围）` : '',
    ].filter(Boolean)
    const reason = normalizeText(
      item?.selectionReason
      || item?.selection_reason
      || item?.candidateReason
      || item?.candidate_reason
      || item?.previewReason
      || item?.preview_reason,
    )
    return {
      id: normalizeText(item?.id) || `row-${index}`,
      word: normalizeText(item?.word || item?.lemma) || '未命名词',
      source: sourceParts.join(' · ') || '来源未记录',
      locator: locator || '定位缺失',
      reason: reason || '当前记录未提供选择依据；不据此推断熟悉程度或 N+1。',
      sourceKnown: Boolean(sourceParts.length),
      locatorKnown: Boolean(locator),
    }
  })
  return {
    count: rows.length,
    rows,
    sourceKnownCount: rows.filter((row) => row.sourceKnown).length,
    locatorKnownCount: rows.filter((row) => row.locatorKnown).length,
  }
}

function formatLocator(value) {
  if (typeof value === 'string') return normalizeText(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return normalizeText(
    value.local_locator
    || value.localLocator
    || value.sentence_id
    || value.sentenceId
    || value.record_id
    || value.recordId
    || value.url,
  )
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
