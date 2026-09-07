const ANSWER_REQUIRED_MESSAGE = '请先显示答案'
export function createSrsReviewFlow(options = {}) {
  const state = options.state || {
    answerRevealed: false,
    ratingCommitted: false,
    transitioning: false,
    committedTone: '',
    pendingTone: '',
    advanced: false,
  }
  let cardGeneration = 0

  async function advanceOnce(generation = cardGeneration) {
    if (generation !== cardGeneration || state.advanced) return false
    state.advanced = true
    if (typeof options.advance === 'function') await options.advance()
    return true
  }

  function revealAnswer() {
    state.answerRevealed = true
    return true
  }

  async function rate(action) {
    if (!action || state.ratingCommitted || state.transitioning) return false
    const answerRevealedBeforeRating = state.answerRevealed
    if (!state.answerRevealed) {
      if (typeof options.revealHint === 'function') {
        options.revealHint(ANSWER_REQUIRED_MESSAGE)
      }
      return false
    }
    const generation = cardGeneration
    state.transitioning = true
    state.pendingTone = action.tone
    try {
      const saved = typeof options.submitAction === 'function'
        ? await options.submitAction(action, { answerRevealedBeforeRating })
        : false
      if (!saved || generation !== cardGeneration) return false
      state.ratingCommitted = true
      state.committedTone = action.tone
      await advanceOnce(generation)
      return true
    } finally {
      if (generation === cardGeneration) {
        state.transitioning = false
        state.pendingTone = ''
      }
    }
  }

  async function handleSpace() {
    if (!state.answerRevealed) return revealAnswer()
    return false
  }

  function resetCard() {
    cardGeneration += 1
    state.answerRevealed = false
    state.ratingCommitted = false
    state.transitioning = false
    state.committedTone = ''
    state.pendingTone = ''
    state.advanced = false
  }

  return {
    get answerRevealed() {
      return state.answerRevealed
    },
    get ratingCommitted() {
      return state.ratingCommitted
    },
    get transitioning() {
      return state.transitioning
    },
    revealAnswer,
    rate,
    handleSpace,
    resetCard,
  }
}
