export function createInitialClozeAnswerState(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map(() => ({ checked: false, correct: false, userAnswer: '' }));
}

export function getClozeCardStateViewModel(state) {
  const normalizedState = state || { checked: false, correct: false, userAnswer: '' };
  const checked = !!normalizedState.checked;
  const correct = !!normalizedState.correct;
  return {
    checked,
    correct,
    userAnswer: normalizedState.userAnswer || '',
    statusClass: checked ? (correct ? 'correct' : 'wrong') : 'idle',
    resultKind: checked ? (correct ? 'ok' : 'error') : 'hint'
  };
}

export function buildClozeCardViewModel(item, state, index) {
  const stateVm = getClozeCardStateViewModel(state);
  return {
    index,
    indexLabel: `填空 ${index + 1}`,
    clozeSentence: item && item.clozeSentence ? item.clozeSentence : '',
    targetWord: item && item.targetWord ? item.targetWord : '',
    reasoning: item && item.reasoning ? item.reasoning : '',
    wordType: item && item.wordType ? item.wordType : '',
    ...stateVm
  };
}

export function buildClozeQuizViewModel(items, answerState) {
  if (!Array.isArray(items) || items.length === 0) {
    return { hasItems: false, cards: [] };
  }
  return {
    hasItems: true,
    cards: items.map((item, index) => buildClozeCardViewModel(item, answerState && answerState[index], index))
  };
}

window.ClozeViewModelHelpers = { createInitialClozeAnswerState, getClozeCardStateViewModel, buildClozeCardViewModel, buildClozeQuizViewModel };
