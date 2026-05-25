<template>
  <section v-if="__USE_VUE_RENDERING && hasData" class="cloze-quiz-section" id="cloze-quiz-section">
    <div class="cloze-quiz-header">
      <h3>文章填空</h3>
      <p>AI 切分内容读完后，可以直接在这里做题。无论回答对错，都会显示标准答案和解释。</p>
    </div>
    <div class="cloze-quiz-list">
      <ClozeCard
        v-for="(card, idx) in cards"
        :key="idx"
        :card="card"
        :index="idx"
        @check="onCheck"
      />
    </div>
  </section>
</template>

<script>
export default {
  name: 'ClozeQuizView',
  computed: {
    __USE_VUE_RENDERING() {
      return window.__USE_VUE_RENDERING || false
    },
    hasData() {
      return window.__hasClozeData || false
    },
    clozeItems() {
      return window.__clozeItems || []
    },
    answerState() {
      return window.__clozeAnswerState || []
    },
    cards() {
      var items = this.clozeItems
      var state = this.answerState
      if (!items.length) return []
      if (typeof window.ClozeViewModelHelpers !== 'undefined' && window.ClozeViewModelHelpers.buildClozeQuizViewModel) {
        var vm = window.ClozeViewModelHelpers.buildClozeQuizViewModel(items, state)
        return vm.cards || []
      }
      return []
    }
  },
  methods: {
    onCheck(index) {
      if (window.__clozeCheck) {
        window.__clozeCheck(index)
      }
    }
  }
}
</script>
