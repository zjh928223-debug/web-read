<template>
  <div>
    <div v-if="vocabularySrsNotReady" class="vocabulary-owner-not-ready" data-vocabulary-owner-status="not-ready" role="status" aria-live="polite">
      本机词汇/SRS Host 暂不可用，学习记录暂不保存；恢复后会自动重试。
    </div>
    <ToastMessage />
    <YouTubeWorkflowPanel />
    <VideoPlayerFloat />
    <TranscriptContainer />
    <ChunkModeView />
    <Teleport to="#srs-review-entry-root">
      <span class="learning-entry-group">
        <button class="small-btn" type="button" title="复习当前已到期的单词" @click="openSrsReview">今日复习</button>
        <button class="small-btn" type="button" title="首次接触：一个主要义和一条可追溯真实短句" @click="openPassagePreview">待预习</button>
        <button class="small-btn" type="button" title="设置每组固定的预习单词数量" @click="openPassagePreviewSettings">预习设置</button>
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
      <LearningPageLoadNotice
        v-if="isSrsReviewOpen && srsPageLoad.status"
        page-name="复习页"
        :failed="srsPageLoad.status === 'failed'"
        :retry-failed="srsPageLoad.retryFailed"
        @retry="srsPageLoad.retry()"
        @close="closeSrsReview"
      />
      <LearningPageLoadNotice
        v-if="isPassagePreviewOpen && passagePreviewItems.length && previewPageLoad.status"
        page-name="预习页"
        :failed="previewPageLoad.status === 'failed'"
        :retry-failed="previewPageLoad.retryFailed"
        @retry="previewPageLoad.retry()"
        @close="closePassagePreview"
      />
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
        :pending-preview-count="passagePreviewWaitingCount"
        :preloaded-sentences="passagePreviewPreloaded.sentences"
        :preloaded-translations="passagePreviewPreloaded.translations"
        @item-revealed="registerPreviewItem"
        @preview-completed="completePreviewLearningSession"
        @item-enriched="saveEnrichedPreviewItem"
        @open-settings="openPassagePreviewSettings"
        @open-review="openSrsReviewFromPassagePreview"
        @close="closePassagePreview"
      />
      <PassagePreviewSettingsDialog
        v-if="isPassagePreviewSettingsOpen"
        @close="closePassagePreviewSettings"
      />
      <div v-if="passagePreviewPreparing" class="passage-preview-preparing" role="status">
        {{ passagePreviewPreparationMessage }}
      </div>
      <div v-if="isPassagePreviewOpen && passagePreviewQueueNotice" class="passage-preview-queue-notice" role="status" aria-live="polite">
        {{ passagePreviewQueueNotice }}
      </div>
    </Teleport>
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import ToastMessage from './components/ToastMessage.vue'
import YouTubeWorkflowPanel from './components/YouTubeWorkflowPanel.vue'
import VideoPlayerFloat from './components/VideoPlayerFloat.vue'
import TranscriptContainer from './components/TranscriptContainer.vue'
import ChunkModeView from './components/ChunkModeView.vue'
import LearningPageLoadNotice from './components/LearningPageLoadNotice.vue'
import { createSrsReviewUiService } from './features/srs-review/srs-review-ui-service.js'
import { createSrsReviewSourceSelector } from './features/srs-review/srs-review-source-selector.js'
import PassagePreviewSettingsDialog from './features/passage-preview/PassagePreviewSettingsDialog.vue'
import { usePassagePreview } from './features/passage-preview/use-passage-preview.js'
import {
  createLegacyReviewServiceAdapter,
  createLegacyVocabularyMigration,
  createVocabularyService,
} from './services/vocabulary/index.js'
import { createIndexedDbReviewStateReader } from './services/vocabulary/srs-review-session-ledger.js'
import { getWindowsOwnerVocabularySrsIntegration } from './services/vocabulary/windows-owner-vocabulary-srs.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import './features/srs-review/srs-review.css'
import './features/passage-preview/passage-preview.css'

function createLearningPage(loader) {
  const state = reactive({ status: '', retry: null, retryFailed: false })
  const component = defineAsyncComponent({
    loader: async () => {
      state.status = 'loading'
      const page = await loader()
      state.status = ''
      state.retry = null
      return page
    },
    onError(_error, retry, _fail, attempts) {
      state.status = 'failed'
      state.retryFailed = attempts > 1
      state.retry = () => {
        state.status = 'loading'
        state.retry = null
        retry()
      }
    },
  })
  return { component, state }
}

const { component: SrsReviewPage, state: srsPageLoad } = createLearningPage(
  () => import('./features/srs-review/SrsReviewPage.vue'),
)
const { component: PassagePreviewPage, state: previewPageLoad } = createLearningPage(
  () => import('./features/passage-preview/PassagePreviewPage.vue'),
)

const isSrsReviewOpen = ref(false)
const isSrsReviewMounted = ref(false)
const srsReviewCacheVersion = ref(0)
const passagePreviewFileInput = ref(null)
const vocabularySrsIntegration = getWindowsOwnerVocabularySrsIntegration()
const vocabularySrsNotReady = ref(Boolean(
  vocabularySrsIntegration?.owner && vocabularySrsIntegration.owner.ownerReady !== true,
))
const vocabularyService = createVocabularyService({
  acquisitionEnabled: true,
  reviewStateRepository: vocabularySrsIntegration?.reviewStateRepository
    || createIndexedDbReviewStateReader(),
  ownerIntegration: vocabularySrsIntegration,
})
const {
  isPassagePreviewOpen,
  passagePreviewItems,
  passagePreviewPreparing,
  passagePreviewPreparationMessage,
  passagePreviewPreloaded,
  isPassagePreviewSettingsOpen,
  passagePreviewWaitingCount,
  passagePreviewQueueNotice,
  openPassagePreview,
  importPassagePreviewFile,
  registerPreviewItem,
  completePreviewLearningSession,
  saveEnrichedPreviewItem,
  closePassagePreview,
  openPassagePreviewSettings,
  closePassagePreviewSettings,
  refreshPendingPreviewSummary,
  replayPersistedPassagePreviewAcquisitions,
} = usePassagePreview({
  vocabularyService,
  requestImportFile: () => passagePreviewFileInput.value?.click(),
})
const legacyVocabularyMigration = vocabularySrsIntegration?.legacyMigration
  || createLegacyVocabularyMigration()
const legacyReviewService = createLegacyReviewServiceAdapter(
  vocabularyService,
  legacyVocabularyMigration,
)
const srsReviewV2Service = createSrsReviewUiService({
  managementService: vocabularyService,
  ownerIntegration: vocabularySrsIntegration,
})
const srsReviewUiService = createSrsReviewSourceSelector({
  v2Service: srsReviewV2Service,
  legacyService: legacyReviewService,
  v2Enabled: vocabularySrsIntegration ? true : import.meta.env.VITE_SRS_REVIEW_V2_ENABLED,
})
const dictionaryClient = createOptionalLocalDictionaryClient()
let legacyMigrationTimer = null
let legacyMigrationStopped = false
let vocabularyOwnerRecoveryTimer = null
let reviewWarmupTimer = null
let articleReconciliationTimer = null
let articleReconciliationStopped = false
let articleReconciledSinceRefresh = false
function refreshVocabularyOwnerReadiness() {
  if (!vocabularySrsIntegration?.owner) return false
  try {
    const current = getWindowsOwnerVocabularySrsIntegration(window)
    const owner = current?.owner || vocabularySrsIntegration.owner
    const wasNotReady = vocabularySrsNotReady.value
    vocabularySrsNotReady.value = owner.ownerReady !== true
    if (wasNotReady && !vocabularySrsNotReady.value) {
      void srsReviewV2Service.warmReviewData?.().catch(() => {})
      void replayPersistedPassagePreviewAcquisitions()
    }
    return !vocabularySrsNotReady.value
  } catch (_error) {
    vocabularySrsNotReady.value = true
    return false
  }
}

function startVocabularyOwnerRecovery() {
  if (!vocabularySrsNotReady.value || !vocabularySrsIntegration?.owner) return
  refreshVocabularyOwnerReadiness()
  vocabularyOwnerRecoveryTimer = window.setInterval(() => {
    if (refreshVocabularyOwnerReadiness() && vocabularyOwnerRecoveryTimer !== null) {
      window.clearInterval(vocabularyOwnerRecoveryTimer)
      vocabularyOwnerRecoveryTimer = null
    }
  }, 250)
}

function openSrsReview() {
  if (articleReconciledSinceRefresh) {
    articleReconciledSinceRefresh = false
    srsReviewCacheVersion.value += 1
  }
  isSrsReviewMounted.value = true
  isSrsReviewOpen.value = true
}

function closeSrsReview() {
  isSrsReviewOpen.value = false
}

function scheduleLegacyVocabularyMigration(delay = 1000) {
  if (vocabularySrsIntegration) return
  if (legacyMigrationStopped || !document.hidden) return
  if (legacyMigrationTimer !== null) window.clearTimeout(legacyMigrationTimer)
  legacyMigrationTimer = window.setTimeout(() => {
    legacyMigrationTimer = null
    void migrateLegacyVocabularyInBackground()
  }, delay)
}

async function migrateLegacyVocabularyInBackground() {
  if (vocabularySrsIntegration) return
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

function scheduleArticleLearningReconciliation(delay = 0) {
  if (articleReconciliationStopped) return
  if (articleReconciliationTimer !== null) window.clearTimeout(articleReconciliationTimer)
  articleReconciliationTimer = window.setTimeout(() => {
    articleReconciliationTimer = null
    void reconcileArticleLearningInBackground()
  }, delay)
}

async function reconcileArticleLearningInBackground() {
  if (articleReconciliationStopped) return
  if (isSrsReviewOpen.value) {
    scheduleArticleLearningReconciliation(5000)
    return
  }
  try {
    const result = await vocabularyService.completePendingArticleLearning?.({ limit: 1 })
    if (result?.completed) {
      articleReconciledSinceRefresh = true
    }
    if (result?.remaining) {
      scheduleArticleLearningReconciliation(250)
    } else if (articleReconciledSinceRefresh && !isSrsReviewOpen.value) {
      articleReconciledSinceRefresh = false
      srsReviewCacheVersion.value += 1
      await srsReviewV2Service.warmReviewData?.()
    }
  } catch (error) {
    console.warn('[article-learning] background reconciliation paused', error)
    scheduleArticleLearningReconciliation(30000)
  }
}

onMounted(() => {
  console.log('[vue] Phase 9 — Vue components active')
  void refreshPendingPreviewSummary().catch((error) => {
    console.warn('[passage-preview] initial pending preview summary unavailable', error)
  })
  document.addEventListener('visibilitychange', handleLegacyMigrationVisibilityChange)
  startVocabularyOwnerRecovery()
  if (!vocabularySrsNotReady.value) {
    void replayPersistedPassagePreviewAcquisitions()
  }
  if (document.hidden) scheduleLegacyVocabularyMigration(1000)
  reviewWarmupTimer = window.setTimeout(() => {
    reviewWarmupTimer = null
    void srsReviewV2Service.warmReviewData?.().catch(() => {})
  }, 0)
  scheduleArticleLearningReconciliation(0)
})

onBeforeUnmount(() => {
  legacyMigrationStopped = true
  articleReconciliationStopped = true
  document.removeEventListener('visibilitychange', handleLegacyMigrationVisibilityChange)
  if (legacyMigrationTimer !== null) window.clearTimeout(legacyMigrationTimer)
  if (vocabularyOwnerRecoveryTimer !== null) window.clearInterval(vocabularyOwnerRecoveryTimer)
  if (reviewWarmupTimer !== null) window.clearTimeout(reviewWarmupTimer)
  if (articleReconciliationTimer !== null) window.clearTimeout(articleReconciliationTimer)
})

async function openSrsReviewFromPassagePreview() {
  await closePassagePreview()
  openSrsReview()
}
</script>
