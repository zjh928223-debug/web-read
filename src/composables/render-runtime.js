var runtime = {
  bridgeToPinia: null,
  getTranscriptContainer: null,
  getClozeMarkup: null,
  checkCloze: null,
  tryRestoreChunkNoteDraft: null
}

export function configureRenderRuntime(deps) {
  var config = deps || {}
  runtime.bridgeToPinia = typeof config.bridgeToPinia === 'function' ? config.bridgeToPinia : null
  runtime.getTranscriptContainer = typeof config.getTranscriptContainer === 'function' ? config.getTranscriptContainer : null
  runtime.getClozeMarkup = typeof config.getClozeMarkup === 'function' ? config.getClozeMarkup : null
  runtime.checkCloze = typeof config.checkCloze === 'function' ? config.checkCloze : null
  runtime.tryRestoreChunkNoteDraft = typeof config.tryRestoreChunkNoteDraft === 'function'
    ? config.tryRestoreChunkNoteDraft
    : null
  return runtime
}

export function renderTranscript() {
  if (typeof runtime.bridgeToPinia !== 'function') return undefined
  runtime.bridgeToPinia()
  return undefined
}

export function renderChunkMode() {
  if (typeof runtime.bridgeToPinia === 'function') runtime.bridgeToPinia()
  var clozeMarkup = getClozeMarkup()
  var transcriptContainer = getTranscriptContainer()
  if (clozeMarkup && transcriptContainer) {
    transcriptContainer.insertAdjacentHTML('beforeend', clozeMarkup)
    bindClozeQuiz(transcriptContainer)
  }
  if (typeof runtime.tryRestoreChunkNoteDraft === 'function') {
    runtime.tryRestoreChunkNoteDraft()
  }
  return undefined
}

function getTranscriptContainer() {
  if (typeof runtime.getTranscriptContainer !== 'function') return null
  return runtime.getTranscriptContainer() || null
}

function getClozeMarkup() {
  if (typeof runtime.getClozeMarkup !== 'function') return ''
  return runtime.getClozeMarkup() || ''
}

function bindClozeQuiz(container) {
  container.querySelectorAll('[data-cloze-check]').forEach((btn) => {
    btn.addEventListener('click', () => checkCloze(Number(btn.dataset.clozeCheck)))
  })
  container.querySelectorAll('[data-cloze-input]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        checkCloze(Number(input.dataset.clozeInput))
      }
    })
  })
}

function checkCloze(index) {
  if (typeof runtime.checkCloze !== 'function') return undefined
  return runtime.checkCloze(index)
}
