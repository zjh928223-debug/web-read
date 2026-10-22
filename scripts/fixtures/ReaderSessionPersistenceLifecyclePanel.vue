<template>
  <RealPanel v-if="mounted" />
  <Teleport to="body">
    <section id="reader-lifecycle-fixture" :data-job="persistence.currentJobId.value" :data-loading="String(persistence.loading.value)">
      <button id="fixture-panel-remove" @click="mounted = false">Remove panel fixture</button>
      <button id="fixture-panel-mount" @click="mounted = true">Mount panel fixture</button>
      <button id="fixture-root-remove" @click="application.unmount()">Remove application fixture</button>
      <button id="fixture-missing-provider" @click="checkMissingProvider">Check missing provider fixture</button>
      <output id="fixture-provider-error">{{ providerError }}</output>
    </section>
  </Teleport>
</template>

<script setup>
// Test build only: App's Panel import resolves here. The real Panel and App
// persistence lifecycle are used without stubs or private unmount hooks.
import { createApp, getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import RealPanel from '../../src/components/YouTubeWorkflowPanel.vue'
import { useReaderSessionPersistenceContext } from '../../src/composables/reader-session-persistence-context.js'

const persistence = useReaderSessionPersistenceContext()
const application = getCurrentInstance().appContext.app
const mounted = ref(true)
const providerError = ref('')

function checkMissingProvider() {
  const host = document.createElement('div')
  const isolatedApp = createApp(RealPanel)
  isolatedApp.config.errorHandler = (error) => { providerError.value = error.message }
  isolatedApp.config.warnHandler = () => {}
  isolatedApp.mount(host)
  isolatedApp.unmount()
}

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('reader-lifecycle-fixture-disposing', {
    detail: { jobId: persistence.currentJobId.value, loading: persistence.loading.value },
  }))
})
</script>
