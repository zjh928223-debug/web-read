import './preview.css'
import { applyNativeControlStyles } from '../../../src/lib/native-control-styles.js'
import { applyNativeInputStyles } from '../../../src/lib/native-input-styles.js'

// Isolated visual prototype: no reader runtime, Host, network requests or storage.
document.querySelectorAll('button:not(.timestamp):not(.marked-word)').forEach(button => {
  applyNativeControlStyles(button, { owner: 'preview', variant: button.dataset.variant || 'ghost', size: 'sm' })
})
document.querySelectorAll('[data-key]').forEach(input => applyNativeInputStyles(input, { owner: 'preview' }))
const $ = selector => document.querySelector(selector)
const rows = [...document.querySelectorAll('.passage')]
const defaults = { backward: 'ArrowLeft', forward: 'ArrowRight', play: 'Space', translation: 'C' }
let keys = { ...defaults }, playing = false, position = 18, active = 1, held = false, capturing = null, toastTimer
let lastTick = performance.now()
const time = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`
const pressed = id => $(id).getAttribute('aria-pressed') === 'true'
const setPressed = (id, value) => $(id).setAttribute('aria-pressed', String(value))
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true }, 4500) }
function syncTranslation() {
  document.body.classList.toggle('show-translation', $('#translation').value === 'show' || ($('#translation').value === 'hold' && held))
  document.body.classList.toggle('focus-translation', pressed('#focus'))
}
function syncPosition(scroll = false) {
  active = Math.max(0, rows.findLastIndex(row => Number(row.dataset.start) <= position))
  rows.forEach((row, index) => { row.classList.toggle('is-current', index === active); if (index === active) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current') })
  $('#progress').value = String(position); $('#current-time').textContent = time(position)
  $('#progress').setAttribute('aria-valuetext', `${time(position)}，共 02:12`)
  if (scroll && pressed('#follow')) {
    const bounds = rows[active].getBoundingClientRect()
    if (bounds.top < 110 || bounds.bottom > innerHeight - 90) rows[active].scrollIntoView({ block: 'center', behavior: 'instant' })
  }
}
function setPlaying(value) {
  playing = value; lastTick = performance.now(); document.body.classList.toggle('is-playing', value)
  $('#play').setAttribute('aria-label', value ? '暂停演示' : '播放演示')
  $('#play use').setAttribute('href', value ? '#i-pause' : '#i-play')
}
function jump(delta) { position = Number(rows[Math.max(0, Math.min(rows.length - 1, active + delta))].dataset.start); syncPosition(true) }
$('#play').onclick = () => { if (position >= 132) position = 0; setPlaying(!playing); syncPosition() }
$('#previous').onclick = () => jump(-1); $('#next').onclick = () => jump(1)
$('#progress').oninput = event => { position = Number(event.target.value); syncPosition(true) }
rows.forEach(row => { row.querySelector('.timestamp').onclick = () => { position = Number(row.dataset.start); syncPosition() } })
setInterval(() => {
  const now = performance.now(), elapsed = (now - lastTick) / 1000; lastTick = now
  if (!playing || document.hidden) return
  const prior = active; position = Math.min(132, position + elapsed * Number($('#speed').value)); syncPosition()
  if (prior !== active) syncPosition(true)
  if (position === 132) setPlaying(false)
}, 100)
$('#follow').onclick = () => setPressed('#follow', !pressed('#follow'))
$('#focus').onclick = () => { setPressed('#focus', !pressed('#focus')); syncTranslation() }
$('#translation').onchange = syncTranslation
$('#mute').onclick = () => { setPressed('#mute', !pressed('#mute')); notify(pressed('#mute') ? '静音状态演示；样稿没有音频。' : '已取消静音演示。') }
function setMode(chunk) { setPressed('#mode-chunk', chunk); setPressed('#mode-sentence', !chunk); document.body.classList.toggle('sentence-mode', !chunk) }
$('#mode-chunk').onclick = () => setMode(true); $('#mode-sentence').onclick = () => setMode(false)
$('#theme').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  $('#theme').setAttribute('aria-label', dark ? '切换浅色' : '切换深色'); $('#theme').title = dark ? '切换浅色' : '切换深色'
  document.documentElement.style.removeProperty('--current'); document.documentElement.style.removeProperty('--mark')
  $('#sentence-color').value = dark ? '#2c3b2f' : '#eaf1ec'; $('#word-color').value = dark ? '#66552a' : '#f0dfa7'
}
function showTab(keysTab) { setPressed('#tab-display', !keysTab); setPressed('#tab-keys', keysTab); $('#display-panel').hidden = keysTab; $('#keys-panel').hidden = !keysTab }
function openSettings(keysTab) { showTab(keysTab); $('#settings-dialog').showModal() }
$('#appearance').onclick = () => openSettings(false); $('#hotkeys').onclick = () => openSettings(true)
$('#tab-display').onclick = () => showTab(false); $('#tab-keys').onclick = () => showTab(true)
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close() })
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { const r = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close() })
  dialog.addEventListener('close', () => { cancelCapture(); document.body.style.overflow = '' })
  new MutationObserver(() => { document.body.style.overflow = document.querySelector('dialog[open]') ? 'hidden' : '' }).observe(dialog, { attributes: true, attributeFilter: ['open'] })
})
$('#font-size').onchange = event => document.documentElement.style.setProperty('--en-size', `${event.target.value}px`)
$('#highlight').onchange = event => document.body.classList.toggle('no-highlight', event.target.value === 'none')
$('#show-vocab').onclick = () => { const show = !pressed('#show-vocab'); setPressed('#show-vocab', show); $('#show-vocab span:last-child').textContent = show ? '开启' : '关闭'; document.body.classList.toggle('show-vocab', show) }
$('#sentence-color').oninput = event => document.documentElement.style.setProperty('--current', event.target.value)
$('#word-color').oninput = event => document.documentElement.style.setProperty('--mark', event.target.value)
const displayKey = key => ({ ArrowLeft: '←', ArrowRight: '→' })[key] || key
function syncKeys() {
  document.querySelectorAll('[data-key]').forEach(input => { input.value = keys[input.dataset.key] })
  $('#backward-hint').textContent = displayKey(keys.backward); $('#forward-hint').textContent = displayKey(keys.forward); $('#play-hint').textContent = keys.play
  $('#previous').title = `上一句 · ${keys.backward}`; $('#next').title = `下一句 · ${keys.forward}`; $('#play').title = `播放 / 暂停 · ${keys.play}`
  $('#translation option[value="hold"]').textContent = `按住 ${displayKey(keys.translation)}`
}
function cancelCapture() { if (capturing) capturing.classList.remove('is-capturing'); capturing = null; syncKeys() }
document.querySelectorAll('[data-key]').forEach(input => {
  input.onclick = () => { cancelCapture(); capturing = input; input.classList.add('is-capturing'); input.value = '请按新键…' }
  input.onblur = cancelCapture
})
document.addEventListener('keydown', event => {
  const key = event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  if (capturing) {
    event.preventDefault()
    if (key === 'Escape') { event.stopPropagation(); cancelCapture(); return }
    if (event.ctrlKey || event.altKey || event.metaKey || ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Enter'].includes(key)) return
    if (Object.entries(keys).some(([name, value]) => name !== capturing.dataset.key && value === key) || ['M', 'B', 'S'].includes(key)) { notify('这个按键已有用途，请换一个。'); return }
    keys[capturing.dataset.key] = key; cancelCapture(); return
  }
  if (document.querySelector('dialog[open]') || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return
  if (key === keys.translation) { event.preventDefault(); held = true; syncTranslation(); return }
  if (event.repeat) return
  if (key === keys.play) { event.preventDefault(); $('#play').click() }
  if (key === keys.backward) { event.preventDefault(); jump(-1) }
  if (key === keys.forward) { event.preventDefault(); jump(1) }
})
document.addEventListener('keyup', event => { const key = event.key.length === 1 ? event.key.toUpperCase() : event.key; if (key === keys.translation) { held = false; syncTranslation() } })
window.addEventListener('blur', () => { held = false; syncTranslation() })
$('#reset').onclick = () => {
  keys = { ...defaults }; cancelCapture(); $('#font-size').value = '21'; document.documentElement.style.removeProperty('--en-size')
  document.documentElement.style.removeProperty('--current'); document.documentElement.style.removeProperty('--mark')
  const dark = document.documentElement.dataset.theme === 'dark'; $('#sentence-color').value = dark ? '#2c3b2f' : '#eaf1ec'; $('#word-color').value = dark ? '#66552a' : '#f0dfa7'
  $('#highlight').value = 'sentence'; document.body.classList.remove('no-highlight', 'show-vocab'); setPressed('#show-vocab', false); $('#show-vocab span:last-child').textContent = '关闭'
  setPressed('#focus', true); setPressed('#follow', true); $('#translation').value = 'hold'; held = false; syncTranslation()
}
const definitions = { ordinary: 'adj. 普通的；平常的。这里指那些容易被忽略的日常小事。', rhythm: 'n. 节奏；规律。这里指熟悉的地方所具有的日常节奏。' }
document.querySelectorAll('[data-word]').forEach(button => { button.onclick = () => { $('#word-title').textContent = button.dataset.word; $('#word-definition').textContent = definitions[button.dataset.word]; $('#word-dialog').showModal() } })
document.querySelectorAll('[data-demo]').forEach(button => { button.onclick = () => notify(button.dataset.demo) })
syncPosition(); syncTranslation(); syncKeys()
