const ANSWER_REQUIRED_MESSAGE = '请先显示答案'
const CARD_ADVANCE_DELAY_MS = 1500

export function createSrsReviewFlow(options = {}) {
  const state = options.state || {
    answerRevealed: false,
    ratingCommitted: false,
    transitioning: false,
    committedTone: '',
    advanced: false,
  }
  let cardGeneration = 0

  async function advanceOnce(generation = cardGeneration) {
    if (generation !== cardGeneration || state.advanced) return false
    state.advanced = true
    if (typeof options.advance === 'function') await options.advance()
    return true
  }

  async function waitBeforeAutomaticAdvance(tone, generation) {
    if (generation !== cardGeneration) return false
    if (typeof options.waitBeforeAdvance === 'function') {
      await options.waitBeforeAdvance({
        delayMs: CARD_ADVANCE_DELAY_MS,
        tone,
      })
    }
    return generation === cardGeneration
  }

  function revealAnswer() {
    state.answerRevealed = true
    return true
  }

  async function rate(action) {
    if (!action || state.ratingCommitted || state.transitioning) return false
    const answerRevealedBeforeRating = state.answerRevealed
    if (!state.answerRevealed && action.tone !== 'again') {
      if (typeof options.revealHint === 'function') {
        options.revealHint(ANSWER_REQUIRED_MESSAGE)
      }
      return false
    }
    const generation = cardGeneration
    state.transitioning = true
    if (action.tone === 'again') state.answerRevealed = true
    try {
      const saved = typeof options.submitAction === 'function'
        ? await options.submitAction(action, { answerRevealedBeforeRating })
        : false
      if (!saved || generation !== cardGeneration) return false
      state.ratingCommitted = true
      state.committedTone = action.tone
      if (action.tone === 'good') {
        if (await waitBeforeAutomaticAdvance(action.tone, generation)) {
          await advanceOnce(generation)
        }
      } else if (action.tone === 'easy') {
        await advanceOnce(generation)
      } else if (action.tone === 'again') {
        if (typeof options.playWordAndTargetSentence === 'function') {
          await options.playWordAndTargetSentence({ maxDurationMs: 12000 })
        } else if (typeof options.playTargetSentence === 'function') {
          await options.playTargetSentence({ maxDurationMs: 12000 })
        }
      } else if (action.tone === 'hard') {
        if (typeof options.playWordAndTargetSentence === 'function') {
          await options.playWordAndTargetSentence({ maxDurationMs: 12000 })
        } else if (typeof options.playTargetSentence === 'function') {
          await options.playTargetSentence({ maxDurationMs: 12000 })
        }
        if (await waitBeforeAutomaticAdvance(action.tone, generation)) {
          await advanceOnce(generation)
        }
      }
      return true
    } finally {
      if (generation === cardGeneration) state.transitioning = false
    }
  }

  async function handleSpace() {
    if (!state.answerRevealed) return revealAnswer()
    if (state.ratingCommitted && (state.committedTone === 'again' || state.committedTone === 'hard')) {
      const generation = cardGeneration
      if (typeof options.stopAudio === 'function') options.stopAudio()
      await advanceOnce(generation)
      return true
    }
    return false
  }

  function resetCard() {
    cardGeneration += 1
    state.answerRevealed = false
    state.ratingCommitted = false
    state.transitioning = false
    state.committedTone = ''
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
