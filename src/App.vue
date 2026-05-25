<template>
  <div>
    <ToastMessage />
    <ClozeQuizView />
    <SentenceNoteSidebar />
    <TranscriptContainer />
    <ChunkModeView />
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import ToastMessage from './components/ToastMessage.vue'
import ClozeQuizView from './components/ClozeQuizView.vue'
import SentenceNoteSidebar from './components/SentenceNoteSidebar.vue'
import TranscriptContainer from './components/TranscriptContainer.vue'
import ChunkModeView from './components/ChunkModeView.vue'

onMounted(() => {
  console.log('[vue] Phase 4 — components ready, old path running (__USE_VUE_RENDERING=false)')
})
</script>
