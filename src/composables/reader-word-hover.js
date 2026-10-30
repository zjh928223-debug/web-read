const hoverMediaQuery = '(hover: hover) and (pointer: fine)'
let notifyBubbleWordHover = null

export function configureReaderWordHover({ notifyAnnotationBubbleWordHover } = {}) {
  notifyBubbleWordHover = typeof notifyAnnotationBubbleWordHover === 'function'
    ? notifyAnnotationBubbleWordHover : null
}

export function prepareReaderWordHover(event) {
  const element = event.currentTarget
  const view = element?.ownerDocument?.defaultView
  if (event.pointerType === 'touch' || !view?.matchMedia(hoverMediaQuery).matches) return
  const fontSize = parseFloat(view.getComputedStyle(element).fontSize)
  if (fontSize > 0) {
    element.style.setProperty('--reader-word-hover-scale', String((fontSize + 1) / fontSize))
  }
  notifyBubbleWordHover?.(element)
}

export function getHoveredReaderWordIndex(documentObject) {
  if (!documentObject?.defaultView?.matchMedia(hoverMediaQuery).matches) return -1
  const element = documentObject.querySelector(
    '.reading-area:not(.reader-view-hidden) span[data-word-index]:hover'
  )
  if (!element) return -1
  const index = Number(element.dataset.wordIndex)
  return Number.isInteger(index) && index >= 0 ? index : -1
}
