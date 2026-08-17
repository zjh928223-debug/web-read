<template>
  <div>
    <ToastMessage />
    <YouTubeWorkflowPanel />
    <VideoPlayerFloat />
    <TranscriptContainer />
    <ChunkModeView />
    <Teleport to="#srs-review-entry-root">
      <span class="learning-entry-group">
        <button class="small-btn" type="button" title="复习当前已到期的单词" @click="openSrsReview">今日复习</button>
        <button class="small-btn" type="button" title="首次接触：一个主要义和一条可追溯真实短句" @click="openPassagePreview">待预习</button>
        <a
          class="small-btn learning-model-entry"
          href="/personalization-shadow.html"
          title="查看正式复习队列与个性化模型建议的只读对照"
        >模型观察</a>
        <input
          ref="passagePreviewFileInput"
          class="passage-preview-file-input"
          type="file"
          accept="application/json,.json"
          @change="importPassagePreviewFile"
        />
      </span>
    </Teleport>
    <Teleport to="body">
      <KeepAlive>
        <SrsReviewPage
          v-if="isSrsReviewMounted"
          v-show="isSrsReviewOpen"
          :key="srsReviewCacheVersion"
          :service="srsReviewUiService"
          :legacy-migration="legacyVocabularyMigration"
          :dictionary-client="dictionaryClient"
          :active="isSrsReviewOpen"
          @close="closeSrsReview"
        />
      </KeepAlive>
      <PassagePreviewPage
        v-if="isPassagePreviewOpen && passagePreviewItems.length"
        :items="passagePreviewItems"
        :preloaded-sentences="passagePreviewPreloaded.sentences"
        :preloaded-translations="passagePreviewPreloaded.translations"
        @item-revealed="registerPreviewItem"
        @item-enriched="saveEnrichedPreviewItem"
        @close="closePassagePreview"
      />
      <div v-if="passagePreviewPreparing" class="passage-preview-preparing" role="status">
        {{ passagePreviewPreparationMessage }}
      </div>
      <PassagePreviewCheckPage
        v-if="isPassagePreviewCheckOpen && passagePreviewCheckItems.length"
        :items="passagePreviewCheckItems"
        :coordinator="passagePreviewAcquisition"
        @close="closePassagePreviewCheck"
      />
    </Teleport>
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ToastMessage from './components/ToastMessage.vue'
import YouTubeWorkflowPanel from './components/YouTubeWorkflowPanel.vue'
import VideoPlayerFloat from './components/VideoPlayerFloat.vue'
import TranscriptContainer from './components/TranscriptContainer.vue'
import ChunkModeView from './components/ChunkModeView.vue'
import SrsReviewPage from './features/srs-review/SrsReviewPage.vue'
import { createSrsReviewUiService } from './features/srs-review/srs-review-ui-service.js'
import { createSrsReviewSourceSelector } from './features/srs-review/srs-review-source-selector.js'
import PassagePreviewPage from './features/passage-preview/PassagePreviewPage.vue'
import PassagePreviewCheckPage from './features/passage-preview/PassagePreviewCheckPage.vue'
import {
  importVocabularyPreview,
  validatePassagePreviewItems,
} from './features/passage-preview/passage-preview-import.js'
import {
  createInitialPassagePreviewProgress,
  hasLegacyPassagePreviewData,
  loadPassagePreviewData,
  loadPassagePreviewProgress,
  savePassagePreviewData,
  savePassagePreviewProgress,
} from './features/passage-preview/passage-preview-storage.js'
import {
  generateIeltsDailyPreviewBatch,
  getPreviewBatchDate,
  loadIeltsDailyPreviewAllocations,
  loadIeltsDailyPreviewContinuation,
  loadIeltsPreviewCandidateWords,
  materializeIeltsDailyPreviewBatch,
  saveIeltsDailyPreviewArchive,
  saveIeltsDailyPreviewAllocations,
  saveIeltsDailyPreviewContinuation,
  selectNextIeltsDailyPreviewBatch,
} from './features/passage-preview/passage-preview-daily-continuation.js'
import { createPassagePreviewAcquisitionCoordinator } from './features/passage-preview/passage-preview-acquisition.js'
import { preloadPassagePreviewBatch } from './features/passage-preview/passage-preview-preload.mjs'
import {
  loadPassagePreviewSessionCache,
  savePassagePreviewSessionCache,
} from './features/passage-preview/passage-preview-session-cache.js'
import {
  createLegacyReviewServiceAdapter,
  createLegacyVocabularyMigration,
  createVocabularyService,
} from './services/vocabulary/index.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import {
  createPersonalizationShadowSettings,
} from './services/vocabulary/personalization/personalization-shadow-settings.js'
import './features/srs-review/srs-review.css'
import './features/passage-preview/passage-preview.css'

const isSrsReviewOpen = ref(false)
const isSrsReviewMounted = ref(false)
const srsReviewCacheVersion = ref(0)
const isPassagePreviewOpen = ref(false)
const passagePreviewFileInput = ref(null)
const passagePreviewItems = ref(loadPassagePreviewData())
const passagePreviewOpening = ref(false)
const passagePreviewPreparing = ref(false)
const passagePreviewPreparationMessage = ref('正在准备预习句子…')
const passagePreviewPreloaded = ref({ sentences: {}, translations: {} })
const isPassagePreviewCheckOpen = ref(false)
const passagePreviewCheckItems = ref([])
const vocabularyService = createVocabularyService({ acquisitionEnabled: true })
const legacyVocabularyMigration = createLegacyVocabularyMigration()
const legacyReviewService = createLegacyReviewServiceAdapter(
  vocabularyService,
  legacyVocabularyMigration,
)
const passagePreviewAcquisition = createPassagePreviewAcquisitionCoordinator({ vocabularyService })
const personalizationShadowSettings = createPersonalizationShadowSettings()
const srsReviewV2Service = createSrsReviewUiService({
  managementService: vocabularyService,
  personalizationShadowEnabled: () => personalizationShadowSettings.isEnabled(),
})
const srsReviewUiService = createSrsReviewSourceSelector({
  v2Service: srsReviewV2Service,
  legacyService: legacyReviewService,
  v2Enabled: import.meta.env.VITE_SRS_REVIEW_V2_ENABLED,
})
const dictionaryClient = createOptionalLocalDictionaryClient()
let legacyMigrationTimer = null
let legacyMigrationStopped = false
let reviewWarmupTimer = null

function openSrsReview() {
  isSrsReviewMounted.value = true
  isSrsReviewOpen.value = true
}

function closeSrsReview() {
  isSrsReviewOpen.value = false
}

function scheduleLegacyVocabularyMigration(delay = 1000) {
  if (legacyMigrationStopped || !document.hidden) return
  if (legacyMigrationTimer !== null) window.clearTimeout(legacyMigrationTimer)
  legacyMigrationTimer = window.setTimeout(() => {
    legacyMigrationTimer = null
    void migrateLegacyVocabularyInBackground()
  }, delay)
}

async function migrateLegacyVocabularyInBackground() {
  if (legacyMigrationStopped || !document.hidden) return
  if (isSrsReviewOpen.value) {
    scheduleLegacyVocabularyMigration(5000)
    return
  }
  try {
    const status = await legacyVocabularyMigration.getStatus()
    if (!status.remaining) return
    const batch = await legacyVocabularyMigration.migrateNextBatch({
      batchSize: 1,
      yieldBetweenCandidates: true,
    })
    if (batch.remaining) scheduleLegacyVocabularyMigration(250)
  } catch (error) {
    console.warn('[legacy-vocabulary-migration] background migration paused', error)
    scheduleLegacyVocabularyMigration(30000)
  }
}

function handleLegacyMigrationVisibilityChange() {
  if (document.hidden) {
    scheduleLegacyVocabularyMigration(1000)
    return
  }
  if (legacyMigrationTimer !== null) {
    window.clearTimeout(legacyMigrationTimer)
    legacyMigrationTimer = null
  }
}

onMounted(() => {
  console.log('[vue] Phase 9 — Vue components active')
  document.addEventListener('visibilitychange', handleLegacyMigrationVisibilityChange)
  if (document.hidden) scheduleLegacyVocabularyMigration(1000)
  reviewWarmupTimer = window.setTimeout(() => {
    reviewWarmupTimer = null
    void vocabularyService.completePendingArticleLearning?.({ limit: 100 })
      .then((result) => {
        if (result?.completed) srsReviewCacheVersion.value += 1
        return srsReviewV2Service.warmReviewData?.()
      })
      .catch((error) => {
        console.warn('[article-learning] background reconciliation paused', error)
        return srsReviewV2Service.warmReviewData?.().catch(() => {})
      })
  }, 0)
})

onBeforeUnmount(() => {
  legacyMigrationStopped = true
  document.removeEventListener('visibilitychange', handleLegacyMigrationVisibilityChange)
  if (legacyMigrationTimer !== null) window.clearTimeout(legacyMigrationTimer)
  if (reviewWarmupTimer !== null) window.clearTimeout(reviewWarmupTimer)
})

function openStoredPassagePreviewLegacy() {
  if (validatePassagePreviewItems(passagePreviewItems.value)) {
    isPassagePreviewOpen.value = true
    return true
  }
  if (passagePreviewItems.value.length) {
    try {
      const migrated = importVocabularyPreview({
        title: '首次接触',
        answers: passagePreviewItems.value,
      })
      savePassagePreviewData(migrated)
      passagePreviewItems.value = migrated
      isPassagePreviewOpen.value = true
      return true
    } catch (_error) {}
  }
  return false
}

async function openStoredPassagePreview() {
  if (passagePreviewOpening.value) return true
  passagePreviewOpening.value = true
  try {
    try {
      const dueChecks = await passagePreviewAcquisition.getDueChecks()
      if (dueChecks.length) {
        passagePreviewCheckItems.value = dueChecks
        isPassagePreviewCheckOpen.value = true
        return true
      }
    } catch (error) {
      console.warn('[passage-preview] delayed-check probe unavailable', error)
    }
    passagePreviewItems.value = loadPassagePreviewData()
    if (validatePassagePreviewItems(passagePreviewItems.value)) {
      const progress = loadPassagePreviewProgress()
      const currentBatchDate = getPreviewBatchDate(passagePreviewItems.value)
      if (progress.status === 'completed' && currentBatchDate) {
        await advanceCompletedIeltsPreviewBatch(currentBatchDate, progress)
      }
      passagePreviewItems.value = await preparePassagePreviewItems(passagePreviewItems.value)
      savePassagePreviewData(passagePreviewItems.value)
      isPassagePreviewOpen.value = true
      return true
    }
    if (openStoredPassagePreviewLegacy()) return true
    const started = await openFirstAvailableIeltsPreviewBatch()
    return started
  } finally {
    passagePreviewOpening.value = false
  }
}

async function openPassagePreview() {
  if (await openStoredPassagePreview()) return
  if (hasLegacyPassagePreviewData()) {
    window.alert('已有旧版预习进度会保留。请导入新版首次接触词包。')
  }
  passagePreviewFileInput.value?.click()
}

async function advanceCompletedIeltsPreviewBatch(currentBatchDate, progress) {
  const continuation = loadIeltsDailyPreviewContinuation()
  const allocations = loadIeltsDailyPreviewAllocations()
  const nextBatch = selectNextIeltsDailyPreviewBatch({
    allocations,
    currentBatchDate,
    consumedBatchDates: continuation.consumedBatchDates,
    today: formatLocalDate(new Date()),
  })
  let resolvedNextBatch = nextBatch
  if (!resolvedNextBatch) {
    const generated = await generateTodayIeltsPreviewBatch()
    if (generated?.date > currentBatchDate) resolvedNextBatch = generated
  }
  if (!resolvedNextBatch) {
    saveIeltsDailyPreviewContinuation({
      ...continuation,
      consumedBatchDates: addDate(continuation.consumedBatchDates, currentBatchDate),
      lastLoadedBatchDate: currentBatchDate,
      updatedAt: new Date().toISOString(),
    })
    return false
  }

  try {
    const nextItems = await materializeIeltsDailyPreviewBatch({
      batch: resolvedNextBatch,
      fallbackItems: passagePreviewItems.value,
    })
    saveIeltsDailyPreviewArchive({
      date: currentBatchDate,
      items: passagePreviewItems.value,
      completedAt: progress.completedAt,
    })
    savePassagePreviewData(nextItems)
    savePassagePreviewProgress(createInitialPassagePreviewProgress())
    passagePreviewItems.value = nextItems
    saveIeltsDailyPreviewContinuation({
      ...continuation,
      consumedBatchDates: addDate(continuation.consumedBatchDates, currentBatchDate),
      lastLoadedBatchDate: resolvedNextBatch.date,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    console.warn('[passage-preview] daily continuation unavailable', error)
    return false
  }
}

async function openFirstAvailableIeltsPreviewBatch() {
  const allocations = loadIeltsDailyPreviewAllocations()
  const continuation = loadIeltsDailyPreviewContinuation()
  const nextBatch = selectNextIeltsDailyPreviewBatch({
    allocations,
    consumedBatchDates: continuation.consumedBatchDates,
    today: formatLocalDate(new Date()),
  })
  const resolvedNextBatch = nextBatch || await generateTodayIeltsPreviewBatch()
  if (!resolvedNextBatch) return false
  try {
    const items = await materializeIeltsDailyPreviewBatch({ batch: resolvedNextBatch })
    const preparedItems = await preparePassagePreviewItems(items)
    savePassagePreviewData(preparedItems)
    savePassagePreviewProgress(createInitialPassagePreviewProgress())
    passagePreviewItems.value = preparedItems
    saveIeltsDailyPreviewContinuation({
      ...continuation,
      lastLoadedBatchDate: resolvedNextBatch.date,
      updatedAt: new Date().toISOString(),
    })
    isPassagePreviewOpen.value = true
    return true
  } catch (error) {
    console.warn('[passage-preview] daily allocation unavailable', error)
    return false
  }
}

async function preparePassagePreviewItems(items) {
  const source = Array.isArray(items) ? items : []
  if (!source.length) {
    passagePreviewPreloaded.value = { sentences: {}, translations: {} }
    return source
  }
  const cached = loadPassagePreviewSessionCache(source)
  if (cached) {
    passagePreviewPreloaded.value = {
      sentences: cached.preloadedSentences || {},
      translations: cached.translations || {},
    }
    passagePreviewPreparationMessage.value = '已复用本次浏览器会话的预习材料。'
    return cached.items
  }
  passagePreviewPreparing.value = true
  passagePreviewPreparationMessage.value = `正在准备 ${source.length} 条短句…`
  try {
    const prepared = await preloadPassagePreviewBatch(source, {
      onProgress(progress) {
        if (progress.phase === 'sentences') {
          passagePreviewPreparationMessage.value = `正在准备短句 ${progress.completed}/${progress.total}…`
        } else if (progress.phase === 'ai') {
          passagePreviewPreparationMessage.value = `正在补充 AI 辅助句 ${progress.completed}/${progress.total}…`
        } else {
          passagePreviewPreparationMessage.value = progress.total
            ? `正在整理中文 ${progress.completed}/${progress.total}…`
            : '短句已准备完成。'
        }
      },
    })
    passagePreviewPreloaded.value = {
      sentences: prepared.preloadedSentences,
      translations: prepared.translations,
    }
    savePassagePreviewSessionCache({
      items: prepared.items,
      preloadedSentences: prepared.preloadedSentences,
      translations: prepared.translations,
    })
    return prepared.items
  } catch (error) {
    console.warn('[passage-preview] batch preload unavailable', error)
    passagePreviewPreloaded.value = { sentences: {}, translations: {} }
    return source
  } finally {
    passagePreviewPreparing.value = false
  }
}

function closePassagePreview() {
  isPassagePreviewOpen.value = false
  passagePreviewPreloaded.value = { sentences: {}, translations: {} }
}

function closePassagePreviewCheck() {
  isPassagePreviewCheckOpen.value = false
  srsReviewCacheVersion.value += 1
}

async function generateTodayIeltsPreviewBatch() {
  const date = formatLocalDate(new Date())
  const allocations = loadIeltsDailyPreviewAllocations()
  const candidateWords = await loadIeltsPreviewCandidateWords()
  const generated = generateIeltsDailyPreviewBatch({
    allocations,
    date,
    candidateWords,
  })
  if (!generated.created) return null
  saveIeltsDailyPreviewAllocations(generated.allocations)
  return generated.batch
}

async function importPassagePreviewFile(event) {
  const file = event.target?.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const items = importVocabularyPreview(JSON.parse(await file.text()))
    savePassagePreviewData(items)
    savePassagePreviewProgress(createInitialPassagePreviewProgress())
    passagePreviewItems.value = items
    isPassagePreviewOpen.value = true
  } catch (error) {
    window.alert(error?.message || '预习结果导入失败。')
  }
}

function saveEnrichedPreviewItem({
  id,
  realSentence,
  primaryMeaningZh,
  pos,
  primarySenseStatus,
  primarySenseReason,
  targetSenseKey,
}) {
  if (!id || !realSentence) return
  passagePreviewItems.value = passagePreviewItems.value.map((item) => (
    item.id === id ? {
      ...item,
      realSentence,
      ...(primaryMeaningZh ? { primaryMeaningZh } : {}),
      ...(pos ? { pos } : {}),
      ...(primarySenseStatus ? { primarySenseStatus } : {}),
      ...(primarySenseReason ? { primarySenseReason } : {}),
      ...(targetSenseKey ? { targetSenseKey } : {}),
    } : item
  ))
  savePassagePreviewData(passagePreviewItems.value)
  savePassagePreviewSessionCache({
    items: passagePreviewItems.value,
    preloadedSentences: passagePreviewPreloaded.value.sentences,
    translations: passagePreviewPreloaded.value.translations,
  })
  const enriched = passagePreviewItems.value.find((item) => item.id === id)
  if (enriched) void registerPreviewItem({ item: enriched })
}

function registerPreviewItem(payload = {}) {
  const item = payload.item || payload
  if (!item?.lemma && !item?.word) return
  void passagePreviewAcquisition.registerItem(item).catch((error) => {
    console.warn('[passage-preview] acquisition registration unavailable', error)
  })
}

function addDate(dates, date) {
  return [...new Set([...(Array.isArray(dates) ? dates : []), date].filter(Boolean))]
}

function formatLocalDate(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
</script>
