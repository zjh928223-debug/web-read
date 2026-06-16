<template>
  <section :class="['cloze-card', card.statusClass]" :data-cloze-card="index">
    <div class="cloze-card-head">
      <span class="cloze-index">{{ card.indexLabel }}</span>
      <div v-if="card.wordType" class="cloze-meta">{{ card.wordType }}</div>
    </div>
    <div class="cloze-sentence" v-html="escapedSentence"></div>
    <div class="cloze-answer-row">
      <input
        type="text"
        class="cloze-answer-input"
        :data-cloze-input="index"
        :value="card.userAnswer"
        placeholder="输入答案"
        @input="onInput"
        @keydown.enter="onCheck"
      >
      <button type="button" class="small-btn cloze-check-btn" :data-cloze-check="index" @click="onCheck">
        检查答案
      </button>
    </div>
    <div v-if="card.resultKind === 'hint'" class="cloze-result-hint">填写后点击"检查答案"。</div>
    <div v-else-if="card.resultKind === 'ok'" class="cloze-result-ok">
      回答正确。标准答案：<strong>{{ card.targetWord }}</strong>
      <div v-if="card.reasoning" class="cloze-result-reason">{{ card.reasoning }}</div>
    </div>
    <div v-else class="cloze-result-error">
      不匹配。标准答案：<strong>{{ card.targetWord }}</strong>
      <div v-if="card.reasoning" class="cloze-result-reason">{{ card.reasoning }}</div>
    </div>
  </section>
</template>

<script>
import { computed } from 'vue'
import { useClozeStore } from '../pinia-stores/cloze.js'
import { updateClozeDraftAnswer } from '../composables/cloze-interactions.js'

export default {
  name: 'ClozeCard',
  props: {
    card: { type: Object, required: true },
    index: { type: Number, required: true }
  },
  emits: ['check'],
  setup(props, { emit }) {
    const cloze = useClozeStore()

    const escapedSentence = computed(function () {
      return htmlEscape(props.card.clozeSentence || '')
    })

    function htmlEscape(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    }

    function onInput(e) {
      updateClozeDraftAnswer(cloze, props.index, e.target.value)
    }

    function onCheck() {
      emit('check', props.index)
    }

    return { escapedSentence, onInput, onCheck }
  }
}
</script>
