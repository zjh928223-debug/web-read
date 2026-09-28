import { applyNativeControlStyles } from '../../../src/lib/native-control-styles.js'
import { applyNativeInputStyles } from '../../../src/lib/native-input-styles.js'

const root = document.documentElement
const body = document.body
const toast = document.querySelector('#preview-toast')
const previewSwitches = [...document.querySelectorAll('[data-preview-mode]')]
let toastTimer = null
let activeSentenceIndex = 0

function applyExistingControlRecipes() {
  document.querySelectorAll('.reader-button[data-ui-owner="reader"]').forEach((control) => {
    const compact = control.id === 'btn-chunk-cn-hold' || control.id === 'btn-chunk-style'
    applyNativeControlStyles(control, {
      owner: 'reader',
      variant: 'outline',
      size: compact ? 'xs' : 'sm',
    })
  })

  document.querySelectorAll('.file-btn[data-ui-owner="reader"]').forEach((control) => {
    applyNativeControlStyles(control, {
      owner: 'reader',
      variant: 'outline',
      size: 'sm',
    })
  })

  const materialEntry = document.querySelector('#material-entry')
  if (materialEntry) {
    applyNativeControlStyles(materialEntry, {
      owner: 'workflow',
      variant: 'outline',
      size: 'sm',
    })
  }

  const themeToggle = document.querySelector('#theme-toggle')
  if (themeToggle) {
    applyNativeControlStyles(themeToggle, {
      owner: 'reader',
      variant: 'outline',
      size: 'icon-sm',
      className: 'rw:rounded-full rw:p-0',
    })
  }

  document.querySelectorAll('input[type="text"]').forEach((input) => {
    applyNativeInputStyles(input, {
      owner: 'reader',
      size: 'sm',
      interaction: 'hotkey',
      className: 'rw:bg-input rw:text-foreground',
    })
  })
}

applyExistingControlRecipes()

function syncRecipeUtilities(mode) {
  const restyled = mode === 'restyled'
  const readerControls = document.querySelectorAll(
    '[data-ui-owner="reader"].reader-button, [data-ui-owner="reader"].file-btn',
  )
  readerControls.forEach((control) => {
    control.classList.toggle('rw:rounded-full', restyled)
    control.classList.toggle('rw:rounded-md', !restyled)
    control.classList.toggle('rw:shadow-sm', restyled)
    control.classList.toggle('rw:shadow-xs', !restyled)
    control.classList.toggle('rw:dark:bg-input/30', !restyled)
    control.classList.toggle('rw:dark:border-input', !restyled)
    control.classList.toggle('rw:dark:hover:bg-input/50', !restyled)
  })

  const materialEntry = document.querySelector('#material-entry')
  if (materialEntry) {
    materialEntry.classList.toggle('rw:rounded-full', restyled)
    materialEntry.classList.toggle('rw:rounded-md', !restyled)
    materialEntry.classList.toggle('rw:shadow-sm', restyled)
    materialEntry.classList.toggle('rw:shadow-xs', !restyled)
    materialEntry.classList.toggle('rw:dark:bg-input/30', !restyled)
    materialEntry.classList.toggle('rw:dark:border-input', !restyled)
    materialEntry.classList.toggle('rw:dark:hover:bg-input/50', !restyled)
  }

  document.querySelectorAll('input[type="text"]').forEach((input) => {
    input.classList.toggle('rw:rounded-lg', restyled)
    input.classList.toggle('rw:rounded-md', !restyled)
    input.classList.toggle('rw:dark:bg-input/30', !restyled)
  })
}

function showToast(message) {
  if (!toast) return
  toast.textContent = message
  toast.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.hidden = true
  }, 2400)
}

function setPreviewMode(mode) {
  const nextMode = mode === 'restyled' ? 'restyled' : 'original'
  body.dataset.previewStyle = nextMode
  syncRecipeUtilities(nextMode)
  previewSwitches.forEach((button) => {
    const selected = button.dataset.previewMode === nextMode
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
}

function setTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light'
  root.dataset.theme = nextTheme
  const themeToggle = document.querySelector('#theme-toggle')
  const toolbarToggle = document.querySelector('[data-preview-action="toggle-theme"]')
  const dark = nextTheme === 'dark'
  if (themeToggle) {
    themeToggle.textContent = dark ? '☾' : '☀'
    themeToggle.setAttribute('aria-label', dark ? '切换浅色预览' : '切换深色预览')
    themeToggle.title = dark ? '切换浅色预览' : '切换深色预览'
  }
  if (toolbarToggle) toolbarToggle.textContent = dark ? '深色' : '浅色'
}

function toggleTheme() {
  setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
  showToast(`已切换${root.dataset.theme === 'dark' ? '深色' : '浅色'}控件主题；仅在本页演示。`)
}

function updateSentence(nextIndex) {
  const sentences = [...document.querySelectorAll('.transcript-line[data-sentence-index]')]
  if (!sentences.length) return
  activeSentenceIndex = Math.max(0, Math.min(sentences.length - 1, nextIndex))
  sentences.forEach((sentence, index) => {
    const active = index === activeSentenceIndex
    sentence.classList.toggle('sentence-active', active)
    if (active) sentence.setAttribute('aria-current', 'true')
    else sentence.removeAttribute('aria-current')
  })
  const previous = document.querySelector('#btn-prev-sentence')
  const next = document.querySelector('#btn-next-sentence')
  if (previous) previous.disabled = activeSentenceIndex === 0
  if (next) next.disabled = activeSentenceIndex === sentences.length - 1
}

function togglePressed(button, labelOn, labelOff) {
  const selected = button.getAttribute('aria-pressed') === 'true'
  const nextSelected = !selected
  button.setAttribute('aria-pressed', String(nextSelected))
  button.classList.toggle('on', nextSelected)
  button.classList.toggle('active', nextSelected)
  if (labelOn && labelOff) button.textContent = nextSelected ? labelOn : labelOff
  return nextSelected
}

previewSwitches.forEach((button) => {
  button.addEventListener('click', () => setPreviewMode(button.dataset.previewMode))
})

document.querySelector('[data-preview-action="toggle-theme"]')?.addEventListener('click', toggleTheme)
document.querySelector('#theme-toggle')?.addEventListener('click', toggleTheme)

document.querySelectorAll('.speed-btn').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach((speedButton) => {
      const selected = speedButton === button
      speedButton.classList.toggle('speed-button-active', selected)
      speedButton.setAttribute('aria-pressed', String(selected))
    })
    showToast(`倍速已切换为 ${button.textContent}；仅更新本地假状态。`)
  })
})

document.querySelector('#btn-prev-sentence')?.addEventListener('click', () => {
  updateSentence(activeSentenceIndex - 1)
})

document.querySelector('#btn-next-sentence')?.addEventListener('click', () => {
  updateSentence(activeSentenceIndex + 1)
})

document.querySelector('#toggle-follow')?.addEventListener('click', (event) => {
  const selected = togglePressed(event.currentTarget, '跟随:开', '跟随:关')
  showToast(`跟随${selected ? '已开启' : '已关闭'}；仅更新本地假状态。`)
})

document.querySelector('#highlight-mode-btn')?.addEventListener('click', (event) => {
  const selected = togglePressed(event.currentTarget, '高亮:句', '高亮:词')
  document.body.classList.toggle('highlight-word-mode', !selected)
})

document.querySelector('#btn-chunk-cn-hold')?.addEventListener('click', (event) => {
  togglePressed(event.currentTarget, '按住', '常开')
})

document.querySelector('#btn-chunk-focus')?.addEventListener('click', (event) => {
  togglePressed(event.currentTarget, '聚焦', '全局')
})

document.querySelector('#toggle-chunk-btn')?.addEventListener('click', (event) => {
  const selected = togglePressed(event.currentTarget, 'AI切分', '逐句')
  showToast(`${selected ? 'AI切分' : '逐句'}状态仅在本地预览中演示。`)
})

document.querySelectorAll('.reader-button, .file-btn').forEach((control) => {
  control.addEventListener('click', (event) => {
    if (event.currentTarget.matches('#btn-prev-sentence, #btn-next-sentence, #toggle-follow, #highlight-mode-btn, #btn-chunk-cn-hold, #btn-chunk-focus, #toggle-chunk-btn, .speed-btn, #theme-toggle')) return
    if (event.currentTarget.matches('.learning-entry-button, #material-entry, #btn-annotation-backfill-ai, #btn-preview-vocabulary, #btn-toggle-preview-vocabulary, #btn-settle-article-vocabulary')) {
      showToast(`${event.currentTarget.textContent.trim()}：只展示按钮状态，不连接业务运行时。`)
    }
  })
})

document.querySelectorAll('label.file-btn').forEach((label) => {
  label.addEventListener('click', (event) => {
    event.preventDefault()
    showToast('文件入口保留原位置；独立预览不会读取本地文件。')
  })
})

document.querySelectorAll('input[type="text"]').forEach((input) => {
  input.addEventListener('focus', () => input.classList.add('is-focused'))
  input.addEventListener('blur', () => input.classList.remove('is-focused'))
})

const query = new URLSearchParams(window.location.search)
if (query.get('mode')) setPreviewMode(query.get('mode'))
if (query.get('theme') === 'dark') setTheme('dark')
if (query.has('capture')) body.classList.add('capture-mode')
updateSentence(0)
