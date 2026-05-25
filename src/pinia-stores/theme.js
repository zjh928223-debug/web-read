import { defineStore } from 'pinia'
import { ref } from 'vue'

const CUSTOM_THEME_STORAGE_KEY = 'themeCustomColors'
const CUSTOM_THEME_DEFAULTS = {
  bg: '#eef2f7', text: '#1c1e21', sub: '#4b5563',
  border: '#cbd5e1', button: '#dbeafe'
}
const CUSTOM_THEME_VAR_NAMES = [
  '--bg-color','--text-main','--text-sub','--border-color','--input-bg','--input-text',
  '--btn-bg','--btn-hover','--btn-text','--btn-active-bg','--btn-active-border',
  '--sidebar-bg','--sidebar-border','--card-bg','--vocab-indicator-color',
  '--v-word-color','--v-context-color','--v-meaning-color','--v-not-color',
  '--chunk-active-bg','--chunk-cn-color','--chunk-note-color','--chunk-note-glass-bg',
  '--chunk-note-glass-border','--chunk-note-connector-default','--chunk-note-connector-shadow',
  '--chunk-annot-default','--glass-bg-light','--glass-bg-medium','--glass-bg-strong',
  '--glass-border-light','--glass-border-strong','--glass-shadow','--glass-shadow-soft',
  '--liquid-bg','--liquid-border','--liquid-specular','--liquid-shadow',
  '--glass-panel-bg','--glass-panel-bg-strong','--glass-button-bg','--glass-card-bg',
  '--glass-border','--glass-highlight','--glass-shadow-sm','--glass-shadow-md',
  '--glass-shadow-lg','--bg-gradient'
]

function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))) }
function normalizeHexColor(value, fallback) {
  var raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return '#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3]
  }
  return fallback
}
function hexToRgb(hex) {
  var n = normalizeHexColor(hex, '#000000').slice(1)
  return { r: parseInt(n.slice(0,2),16), g: parseInt(n.slice(2,4),16), b: parseInt(n.slice(4,6),16) }
}
function rgbToHex(rgb) {
  return '#' + [rgb.r,rgb.g,rgb.b].map(function(v){return clampByte(v).toString(16).padStart(2,'0')}).join('')
}
function mixHex(a, b, w) {
  if (w === undefined) w = 0.5
  var ca = hexToRgb(a), cb = hexToRgb(b), r = Math.max(0,Math.min(1,w))
  return rgbToHex({ r: ca.r + ((cb.r-ca.r)*r), g: ca.g + ((cb.g-ca.g)*r), b: ca.b + ((cb.b-ca.b)*r) })
}
function hexToRgba(hex, alpha) {
  var rgb = hexToRgb(hex)
  return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')'
}
function getColorLuminance(hex) {
  var rgb = hexToRgb(hex)
  return ((rgb.r*0.2126)+(rgb.g*0.7152)+(rgb.b*0.0722))/255
}

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref('light')

  function getStoredCustomThemeColors() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || '{}')
      return {
        bg: normalizeHexColor(parsed.bg, CUSTOM_THEME_DEFAULTS.bg),
        text: normalizeHexColor(parsed.text, CUSTOM_THEME_DEFAULTS.text),
        sub: normalizeHexColor(parsed.sub, CUSTOM_THEME_DEFAULTS.sub),
        border: normalizeHexColor(parsed.border, CUSTOM_THEME_DEFAULTS.border),
        button: normalizeHexColor(parsed.button, CUSTOM_THEME_DEFAULTS.button)
      }
    } catch(e) { return Object.assign({}, CUSTOM_THEME_DEFAULTS) }
  }

  function setCustomThemeInputValues(colors) {
    var inputs = ['bg','text','sub','border','button']
    inputs.forEach(function(k) {
      var el = document.getElementById('theme-custom-' + k)
      if (el) el.value = colors[k]
    })
  }

  function clearCustomThemeVars() {
    CUSTOM_THEME_VAR_NAMES.forEach(function(name) {
      document.documentElement.style.removeProperty(name)
    })
  }

  function buildCustomThemeVars(colors) {
    var isDark = getColorLuminance(colors.bg) < 0.45
    var sc = isDark ? 'rgba(0,0,0,0.34)' : 'rgba(15,23,42,0.12)'
    var ssc = isDark ? 'rgba(0,0,0,0.26)' : 'rgba(15,23,42,0.10)'
    var ssc2 = isDark ? 'rgba(0,0,0,0.42)' : 'rgba(15,23,42,0.18)'
    var hc = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.78)'
    var sb = mixHex(colors.bg, colors.text, isDark ? 0.12 : 0.04)
    var cb = mixHex(colors.bg, colors.button, 0.32)
    var cab = mixHex(colors.bg, colors.text, isDark ? 0.18 : 0.1)
    var gb = isDark ? mixHex(colors.bg, '#101418', 0.24) : mixHex(colors.bg, '#ffffff', 0.38)
    var pb = isDark ? mixHex(colors.bg, colors.button, 0.2) : mixHex(colors.bg, colors.button, 0.42)
    var ra = hexToRgba(mixHex(colors.button, '#ffffff', isDark ? 0.08 : 0.45), isDark ? 0.2 : 0.42)
    var rb = hexToRgba(mixHex(colors.border, colors.button, 0.4), isDark ? 0.18 : 0.3)
    return {
      '--bg-color': colors.bg, '--text-main': colors.text, '--text-sub': colors.sub,
      '--border-color': colors.border,
      '--input-bg': mixHex(colors.bg, colors.text, isDark ? 0.12 : 0.05),
      '--input-text': colors.text, '--btn-bg': colors.button,
      '--btn-hover': mixHex(colors.button, colors.text, isDark ? 0.18 : 0.12),
      '--btn-text': colors.text,
      '--btn-active-bg': mixHex(colors.button, colors.text, isDark ? 0.3 : 0.2),
      '--btn-active-border': mixHex(colors.border, colors.text, isDark ? 0.22 : 0.08),
      '--sidebar-bg': sb, '--sidebar-border': colors.border, '--card-bg': cb,
      '--vocab-indicator-color': colors.sub, '--v-word-color': colors.text,
      '--v-context-color': colors.sub, '--v-meaning-color': colors.sub,
      '--v-not-color': mixHex(colors.sub, colors.bg, 0.22),
      '--chunk-active-bg': cab, '--chunk-cn-color': colors.sub,
      '--chunk-note-color': colors.text,
      '--chunk-note-glass-bg': hexToRgba(pb, isDark ? 0.82 : 0.84),
      '--chunk-note-glass-border': hexToRgba(colors.border, isDark ? 0.28 : 0.4),
      '--chunk-note-connector-default': hexToRgba(colors.text, isDark ? 0.48 : 0.32),
      '--chunk-note-connector-shadow': hexToRgba(isDark ? '#000' : '#fff', isDark ? 0.22 : 0.55),
      '--chunk-annot-default': hexToRgba(colors.text, isDark ? 0.42 : 0.3),
      '--glass-bg-light': hexToRgba(gb, 0.56), '--glass-bg-medium': hexToRgba(gb, 0.62),
      '--glass-bg-strong': hexToRgba(gb, 0.72),
      '--glass-border-light': hexToRgba(colors.border, isDark ? 0.16 : 0.58),
      '--glass-border-strong': hexToRgba(colors.border, isDark ? 0.24 : 0.72),
      '--glass-shadow': '0 8px 24px ' + sc, '--glass-shadow-soft': '0 2px 10px ' + ssc,
      '--liquid-bg': hexToRgba(gb, isDark ? 0.28 : 0.25),
      '--liquid-border': hexToRgba(colors.border, isDark ? 0.2 : 0.36),
      '--liquid-specular': isDark
        ? 'inset 1px 1px 0 rgba(255,255,255,0.18), inset 0 0 5px rgba(255,255,255,0.12)'
        : 'inset 1px 1px 0 rgba(255,255,255,0.75), inset 0 0 5px rgba(255,255,255,0.75)',
      '--liquid-shadow': isDark
        ? '0 6px 6px rgba(0,0,0,0.32), 0 0 20px rgba(0,0,0,0.20)'
        : '0 6px 6px rgba(0,0,0,0.2), 0 0 20px rgba(0,0,0,0.1)',
      '--glass-panel-bg': hexToRgba(pb, isDark ? 0.56 : 0.34),
      '--glass-panel-bg-strong': hexToRgba(pb, isDark ? 0.64 : 0.42),
      '--glass-button-bg': hexToRgba(colors.button, isDark ? 0.52 : 0.26),
      '--glass-card-bg': hexToRgba(cb, isDark ? 0.66 : 0.48),
      '--glass-border': hexToRgba(colors.border, isDark ? 0.22 : 0.52),
      '--glass-highlight': hc, '--glass-shadow-sm': '0 2px 8px ' + ssc,
      '--glass-shadow-md': '0 6px 22px ' + sc, '--glass-shadow-lg': '0 16px 34px ' + ssc2,
      '--bg-gradient': 'radial-gradient(1200px 520px at -8% -16%, ' + ra + ', transparent 60%), radial-gradient(900px 500px at 108% 4%, ' + rb + ', transparent 56%), linear-gradient(180deg, ' + mixHex(colors.bg, '#fff', isDark ? 0.04 : 0.16) + ' 0%, ' + mixHex(colors.bg, '#000', isDark ? 0.12 : 0.04) + ' 100%)'
    }
  }

  function updateToggleUi(theme) {
    var labels = { light: { icon: '\u2600' }, dark: { icon: '\u263E' }, custom: { icon: '\u2726' } }
    var config = labels[theme] || labels.light
    var btn = document.getElementById('theme-toggle')
    var panel = document.getElementById('theme-custom-panel')
    if (btn) { btn.textContent = config.icon }
    if (panel && theme !== 'custom') { panel.hidden = true }
    if (btn) { btn.setAttribute('aria-expanded', String(panel && !panel.hidden)) }
  }

  function openCustomPanel() {
    var panel = document.getElementById('theme-custom-panel')
    if (!panel) return
    panel.hidden = false
    var btn = document.getElementById('theme-toggle')
    if (btn) btn.setAttribute('aria-expanded', 'true')
  }

  function closeCustomPanel() {
    var panel = document.getElementById('theme-custom-panel')
    if (!panel) return
    panel.hidden = true
    var btn = document.getElementById('theme-toggle')
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }

  function applyDefaults(theme) {
    if (localStorage.getItem('sentenceColor') || localStorage.getItem('highlightColor')) return
    var d = theme === 'dark' ? { s: '#2d3748', h: '#b7950b' } : { s: '#e5e7eb', h: '#ffeb3b' }
    var si = document.getElementById('sentence-color-input')
    var hi = document.getElementById('highlight-color-input')
    if (si) si.value = d.s
    if (hi) hi.value = d.h
  }

  function applyCustom(colors, persist) {
    if (persist === undefined) persist = true
    var vars = buildCustomThemeVars(colors)
    var isDark = getColorLuminance(colors.bg) < 0.45
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme-mode', 'custom')
    Object.keys(vars).forEach(function(k) { document.documentElement.style.setProperty(k, vars[k]) })
    setCustomThemeInputValues(colors)
    if (persist) {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(colors))
      localStorage.setItem('theme', 'custom')
    }
    applyDefaults(isDark ? 'dark' : 'light')
    updateToggleUi('custom')
    currentTheme.value = 'custom'
  }

  function applyMode(theme, persist) {
    if (persist === undefined) persist = true
    clearCustomThemeVars()
    document.documentElement.removeAttribute('data-theme-mode')
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
      if (persist) localStorage.setItem('theme', 'dark')
      applyDefaults('dark')
    } else if (theme === 'custom') {
      applyCustom(getStoredCustomThemeColors(), persist)
      return
    } else {
      document.documentElement.removeAttribute('data-theme')
      if (persist) localStorage.setItem('theme', 'light')
      applyDefaults('light')
    }
    currentTheme.value = theme
    updateToggleUi(theme)
  }

  function init() {
    setCustomThemeInputValues(getStoredCustomThemeColors())
    var saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'custom') { applyMode(saved, false) }
    else { applyMode('light', false) }
  }

  return { currentTheme, CUSTOM_THEME_DEFAULTS, init, applyMode, applyCustom, getStoredCustomThemeColors, openCustomPanel, closeCustomPanel }
})
