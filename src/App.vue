<template>
  <div>
    <ToastMessage />
    <YouTubeWorkflowPanel />
    <VideoPlayerFloat />
    <TranscriptContainer />
    <ChunkModeView />
    <Teleport to="#srs-review-entry-root">
      <span class="learning-entry-group">
        <button class="small-btn" type="button" title="复习当前已到期的单词" @click="isSrsReviewOpen = true">今日复习</button>
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
      <SrsReviewPage
        v-if="isSrsReviewOpen"
        :service="srsReviewUiService"
        :dictionary-client="dictionaryClient"
        @close="isSrsReviewOpen = false"
      />
      <PassagePreviewPage
        v-if="isPassagePreviewOpen && passagePreviewItems.length"
        :items="passagePreviewItems"
        @item-enriched="saveEnrichedPreviewItem"
        @close="isPassagePreviewOpen = false"
      />
    </Teleport>
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import ToastMessage from './components/ToastMessage.vue'
import YouTubeWorkflowPanel from './components/YouTubeWorkflowPanel.vue'
import VideoPlayerFloat from './components/VideoPlayerFloat.vue'
import TranscriptContainer from './components/TranscriptContainer.vue'
import ChunkModeView from './components/ChunkModeView.vue'
import SrsReviewPage from './features/srs-review/SrsReviewPage.vue'
import { createSrsReviewUiService } from './features/srs-review/srs-review-ui-service.js'
import { createSrsReviewSourceSelector } from './features/srs-review/srs-review-source-selector.js'
import PassagePreviewPage from './features/passage-preview/PassagePreviewPage.vue'
import {
  importVocabularyPreview,
  validatePassagePreviewItems,
} from './features/passage-preview/passage-preview-import.js'
import {
  createInitialPassagePreviewProgress,
  hasLegacyPassagePreviewData,
  loadPassagePreviewData,
  savePassagePreviewData,
  savePassagePreviewProgress,
} from './features/passage-preview/passage-preview-storage.js'
import { createVocabularyService } from './services/vocabulary/index.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import {
  createPersonalizationShadowSettings,
} from './services/vocabulary/personalization/personalization-shadow-settings.js'
import './features/srs-review/srs-review.css'
import './features/passage-preview/passage-preview.css'

const isSrsReviewOpen = ref(false)
const isPassagePreviewOpen = ref(false)
const passagePreviewFileInput = ref(null)
const passagePreviewItems = ref(loadPassagePreviewData())
const vocabularyService = createVocabularyService()
const personalizationShadowSettings = createPersonalizationShadowSettings()
const srsReviewV2Service = createSrsReviewUiService({
  managementService: vocabularyService,
  personalizationShadowEnabled: () => personalizationShadowSettings.isEnabled(),
})
const srsReviewUiService = createSrsReviewSourceSelector({
  v2Service: srsReviewV2Service,
  legacyService: vocabularyService,
  v2Enabled: import.meta.env.VITE_SRS_REVIEW_V2_ENABLED,
})
const dictionaryClient = createOptionalLocalDictionaryClient()

onMounted(() => {
  console.log('[vue] Phase 9 — Vue components active (__USE_VUE_RENDERING=' + window.__USE_VUE_RENDERING + ')')
})

function openPassagePreview() {
  if (validatePassagePreviewItems(passagePreviewItems.value)) {
    isPassagePreviewOpen.value = true
    return
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
      return
    } catch (_error) {}
  }
  if (hasLegacyPassagePreviewData()) {
    window.alert('已有旧版预习进度会保留。请导入新版首次接触词包。')
  }
  passagePreviewFileInput.value?.click()
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

function saveEnrichedPreviewItem({ id, realSentence }) {
  if (!id || !realSentence) return
  passagePreviewItems.value = passagePreviewItems.value.map((item) => (
    item.id === id ? { ...item, realSentence } : item
  ))
  savePassagePreviewData(passagePreviewItems.value)
}
</script>
