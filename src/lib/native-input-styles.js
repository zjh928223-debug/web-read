import { inputVariants } from '../components/ui/input/input-styles.js'
import { buttonVariants } from '../components/ui/button/button-variants.js'
import { cn } from './utils.js'

const DEFAULT_NATIVE_INPUT_OPTIONS = Object.freeze({
  owner: 'reader',
  size: 'default',
  interaction: 'hotkey',
})

function addClasses(element, className) {
  if (!className || !element?.classList?.add) return
  className.split(/\s+/).filter(Boolean).forEach((classToken) => {
    element.classList.add(classToken)
  })
}

export function applyNativeInputStyles(element, options = {}) {
  if (!element?.classList?.add) return element

  const settings = { ...DEFAULT_NATIVE_INPUT_OPTIONS, ...options }
  if (settings.owner) element.setAttribute('data-ui-owner', settings.owner)
  const interactionClasses = settings.interaction === 'text'
    ? 'rw:cursor-text'
    : 'rw:text-center rw:cursor-pointer rw:select-none'
  addClasses(element, cn(
    settings.variant === 'floating'
      ? buttonVariants({ variant: 'floating', size: settings.size })
      : inputVariants({ size: settings.size }),
    interactionClasses,
    settings.className,
  ))
  return element
}
