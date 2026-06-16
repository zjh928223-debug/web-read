import { normalizeClozeAnswer } from '../utils/cloze-utils.js'
import { createInitialClozeAnswerState, buildClozeQuizViewModel } from '../utils/cloze-view-model.js'

function normalizeIndex(index) {
  var numeric = Number(index)
  if (!Number.isInteger(numeric) || numeric < 0) return -1
  return numeric
}

function createAnswerEntry(userAnswer) {
  return {
    checked: false,
    correct: false,
    userAnswer: userAnswer == null ? '' : String(userAnswer)
  }
}

function cloneAnswerState(answerState) {
  return Array.isArray(answerState) ? answerState.slice() : []
}

function getUserAnswer(value) {
  return value == null ? '' : String(value)
}

export function createClozeAnswerState(items) {
  return createInitialClozeAnswerState(items)
}

export function buildClozeCards(items, answerState) {
  if (!Array.isArray(items) || !items.length) return []
  var quizVm = buildClozeQuizViewModel(items, Array.isArray(answerState) ? answerState : [])
  return quizVm && Array.isArray(quizVm.cards) ? quizVm.cards : []
}

export function updateClozeDraftAnswer(clozeStore, index, value) {
  if (!clozeStore) return false
  var normalizedIndexValue = normalizeIndex(index)
  if (normalizedIndexValue < 0) return false

  var answerState = cloneAnswerState(clozeStore.answerState)
  var previous = answerState[normalizedIndexValue] || createAnswerEntry('')
  answerState[normalizedIndexValue] = {
    checked: !!previous.checked,
    correct: !!previous.correct,
    userAnswer: getUserAnswer(value)
  }
  clozeStore.answerState = answerState
  return true
}

export function checkClozeAnswerState(options) {
  var config = options || {}
  var items = Array.isArray(config.items) ? config.items : []
  var normalizedIndexValue = normalizeIndex(config.index)
  if (normalizedIndexValue < 0) return null

  var item = items[normalizedIndexValue]
  if (!item) return null

  var answerState = cloneAnswerState(config.answerState)
  var previous = answerState[normalizedIndexValue] || createAnswerEntry('')
  var userAnswer = Object.prototype.hasOwnProperty.call(config, 'userAnswer')
    ? getUserAnswer(config.userAnswer)
    : getUserAnswer(previous.userAnswer)
  var correct = normalizeClozeAnswer(userAnswer) === normalizeClozeAnswer(item.targetWord)

  answerState[normalizedIndexValue] = {
    checked: true,
    correct: correct,
    userAnswer: userAnswer
  }

  return {
    answerState: answerState,
    correct: correct,
    userAnswer: userAnswer,
    index: normalizedIndexValue
  }
}

export function checkClozeStoreAnswer(clozeStore, index) {
  if (!clozeStore) return null
  var result = checkClozeAnswerState({
    items: clozeStore.items,
    answerState: clozeStore.answerState,
    index: index
  })
  if (!result) return null

  clozeStore.answerState = result.answerState
  return result
}
