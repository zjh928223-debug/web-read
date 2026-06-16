<template>
  <section v-if="cloze.hasData && ts.useVueRendering" class="cloze-quiz-section" id="cloze-quiz-section">
    <div class="cloze-quiz-header">
      <h3>文章填空</h3>
      <p>AI 切分内容读完后，可以直接在这里做题。无论回答对错，都会显示标准答案和解释。</p>
    </div>
    <div class="cloze-quiz-list">
      <ClozeCard
        v-for="(card, idx) in cardList"
        :key="idx"
        :card="card"
        :index="idx"
        @check="onCheck"
      />
    </div>
  </section>
</template>

<script>
import { computed } from 'vue'
import { useClozeStore } from '../pinia-stores/cloze.js'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { buildClozeCards, checkClozeStoreAnswer } from '../composables/cloze-interactions.js'
import ClozeCard from './ClozeCard.vue'

export default {
  name: 'ClozeQuizView',
  components: { ClozeCard },
  setup() {
    const cloze = useClozeStore()
    const ts = useTranscriptStore()

    const cardList = computed(function () {
      var items = cloze.items
      var state = cloze.answerState
      return buildClozeCards(items, state)
    })

    function onCheck(index) {
      checkClozeStoreAnswer(cloze, index)
    }

    return { cloze, ts, cardList, onCheck }
  }
}
</script>
