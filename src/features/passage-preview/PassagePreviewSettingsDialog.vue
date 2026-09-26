<template>
  <div class="passage-preview-shortcut-backdrop" @pointerdown.self="close">
    <section
      class="passage-preview-shortcut-dialog passage-preview-learning-settings-dialog"
      data-ui-theme="light"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passage-preview-learning-settings-title"
    >
      <header>
        <div>
          <p>首次接触</p>
          <h2 id="passage-preview-learning-settings-title">预习设置</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="rw:text-xl"
          data-ui-owner="learning"
          aria-label="关闭预习设置"
          @click="close"
        >×</Button>
      </header>
      <p class="passage-preview-shortcut-intro">
        每组使用固定数量；设置只影响下一组新生成的预习词，不会改变当前批次。
      </p>
      <div class="passage-preview-learning-settings-row">
        <div>
          <span>每组预习数量</span>
          <small>可设置 {{ PASSAGE_PREVIEW_MIN_BATCH_SIZE }}–{{ PASSAGE_PREVIEW_MAX_BATCH_SIZE }} 词</small>
        </div>
        <label class="passage-preview-learning-settings-input">
          <input
            v-model.number="batchSizeDraft"
            type="number"
            :min="PASSAGE_PREVIEW_MIN_BATCH_SIZE"
            :max="PASSAGE_PREVIEW_MAX_BATCH_SIZE"
            step="1"
            inputmode="numeric"
            data-ui-owner="learning"
            class="rw:text-foreground"
            :class="inputVariants({ size: 'sm' })"
            aria-label="每组预习数量"
            :disabled="loading || saving"
            @keydown.enter.prevent="save"
          >
          <span>词</span>
        </label>
      </div>
      <p class="passage-preview-shortcut-notice" role="status" aria-live="polite">
        {{ notice || (loading ? '正在读取设置…' : '') }}
      </p>
      <footer>
        <Button type="button" variant="outline" size="sm" data-ui-owner="learning" :disabled="saving" @click="close">取消</Button>
        <Button type="button" variant="default" size="sm" data-ui-owner="learning" :disabled="loading || saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </Button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { Button } from '../../components/ui/button/index.js'
import { inputVariants } from '../../components/ui/input/input-styles.js'
import {
  loadPassagePreviewLearningSettings,
  PASSAGE_PREVIEW_MAX_BATCH_SIZE,
  PASSAGE_PREVIEW_MIN_BATCH_SIZE,
  PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE,
  savePassagePreviewLearningSettings,
} from './passage-preview-learning-history.js'

const emit = defineEmits(['close', 'saved'])
const batchSizeDraft = ref(PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE)
const loading = ref(true)
const saving = ref(false)
const notice = ref('')

async function loadSettings() {
  try {
    const settings = await loadPassagePreviewLearningSettings()
    batchSizeDraft.value = settings.batchSize
  } catch (error) {
    notice.value = error?.message || '预习设置读取失败，请检查 Windows Host。'
  } finally {
    loading.value = false
  }
}

function close() {
  if (!saving.value) emit('close')
}

async function save() {
  const batchSize = Number(batchSizeDraft.value)
  if (!Number.isInteger(batchSize) || batchSize < PASSAGE_PREVIEW_MIN_BATCH_SIZE || batchSize > PASSAGE_PREVIEW_MAX_BATCH_SIZE) {
    notice.value = `请输入 ${PASSAGE_PREVIEW_MIN_BATCH_SIZE}–${PASSAGE_PREVIEW_MAX_BATCH_SIZE} 之间的整数。`
    return
  }
  saving.value = true
  notice.value = ''
  try {
    const settings = await savePassagePreviewLearningSettings({ batchSize })
    emit('saved', settings)
    emit('close')
  } catch (error) {
    notice.value = error?.message || '预习设置保存失败，请检查 Windows Host。'
  } finally {
    saving.value = false
  }
}

onMounted(loadSettings)
</script>
