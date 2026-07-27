<template>
  <div>
    <ToastMessage />
    <YouTubeWorkflowPanel />
    <VideoPlayerFloat />
    <TranscriptContainer />
    <ChunkModeView />
    <Teleport to="#srs-review-entry-root">
      <button class="small-btn" type="button" title="复习当前已到期的单词" @click="isSrsReviewOpen = true">今日复习</button>
    </Teleport>
    <Teleport to="body">
      <SrsReviewPage
        v-if="isSrsReviewOpen"
        :service="vocabularyService"
        :dictionary-client="dictionaryClient"
        @close="isSrsReviewOpen = false"
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
import { createVocabularyService } from './services/vocabulary/index.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import './features/srs-review/srs-review.css'

const isSrsReviewOpen = ref(false)
const vocabularyService = createVocabularyService()
const dictionaryClient = createOptionalLocalDictionaryClient()

onMounted(() => {
  console.log('[vue] Phase 9 — Vue components active (__USE_VUE_RENDERING=' + window.__USE_VUE_RENDERING + ')')
})
</script>
