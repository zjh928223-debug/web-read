import { buttonVariants } from '../components/ui/button/button-variants.js'
import { cn } from './utils.js'

const DEFAULT_NATIVE_BUTTON_OPTIONS = Object.freeze({
  variant: 'outline',
  size: 'default',
})

function addClasses(element, className) {
  if (!className || !element?.classList?.add) return
  className.split(/\s+/).filter(Boolean).forEach((classToken) => {
    element.classList.add(classToken)
  })
}

export function applyNativeControlStyles(element, options = {}) {
  if (!element?.classList?.add) return element

  const settings = { ...DEFAULT_NATIVE_BUTTON_OPTIONS, ...options }
  if (settings.owner) element.setAttribute('data-ui-owner', settings.owner)
  addClasses(element, cn(
    buttonVariants({ variant: settings.variant, size: settings.size }),
    settings.className,
  ))
  return element
}
