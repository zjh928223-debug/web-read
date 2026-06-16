function callWindowHandler(name, ...args) {
  var handler = window[name]
  if (typeof handler === 'function') return handler.apply(window, args)
  return undefined
}

function bindClick(id, handlerName, ...args) {
  var el = document.getElementById(id)
  if (!el || el.dataset.legacyControlBound === '1') return
  el.dataset.legacyControlBound = '1'
  el.addEventListener('click', function () {
    callWindowHandler(handlerName, ...args)
  })
}

function bindInput(id, handlerName) {
  var el = document.getElementById(id)
  if (!el || el.dataset.legacyControlBound === '1') return
  el.dataset.legacyControlBound = '1'
  el.addEventListener('input', function () {
    callWindowHandler(handlerName)
  })
}

function bindSpeedButtons() {
  Array.from(document.querySelectorAll('.speed-btn[data-speed]')).forEach(function (button) {
    if (!button || button.dataset.legacyControlBound === '1') return
    button.dataset.legacyControlBound = '1'
    button.addEventListener('click', function () {
      callWindowHandler('changeSpeed', parseFloat(button.dataset.speed || '1'))
    })
  })
}

export function bindLegacyControlHandlers() {
  bindClick('btn-prev-sentence', 'handleBackwardClick')
  bindClick('btn-next-sentence', 'handleForwardClick')
  bindSpeedButtons()
  bindClick('highlight-mode-btn', 'cycleHighlightMode')
  bindClick('toggle-chunk-btn', 'toggleChunkMode')
  bindClick('btn-chunk-style', 'openChunkStyleModal')
  bindClick('btn-chunk-focus', 'toggleChunkFocusMode')
  bindClick('btn-chunk-note-style', 'openChunkNoteStyleModal')
  bindClick('btn-close-chunk-style-modal', 'closeChunkStyleModal')
  bindClick('btn-toggle-shadow-manual', 'toggleChunkShadowManual')
  bindClick('btn-close-chunk-note-style-modal', 'closeChunkNoteStyleModal')

  ;[
    'chunk-en-size-input',
    'chunk-cn-size-input',
    'chunk-gap-input',
    'chunk-cn-color-input',
    'chunk-bg-color-input'
  ].forEach(function (id) {
    bindInput(id, 'updateChunkStyle')
  })

  ;[
    'chunk-note-size-input',
    'chunk-note-color-input',
    'chunk-note-width-input',
    'chunk-note-min-height-input',
    'chunk-note-arrow-size-input'
  ].forEach(function (id) {
    bindInput(id, 'updateChunkNoteStyle')
  })
}

bindLegacyControlHandlers()

window.__legacyControlBindings = {
  bind: bindLegacyControlHandlers
}
