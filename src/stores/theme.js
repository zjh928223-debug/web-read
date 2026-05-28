  var CUSTOM_THEME_STORAGE_KEY = 'themeCustomColors';
  var CUSTOM_THEME_DEFAULTS = {
    bg: '#eef2f7',
    text: '#1c1e21',
    sub: '#4b5563',
    border: '#cbd5e1',
    button: '#dbeafe'
  };
  var CUSTOM_THEME_VAR_NAMES = [
    '--bg-color', '--text-main', '--text-sub', '--border-color',
    '--input-bg', '--input-text', '--btn-bg', '--btn-hover', '--btn-text',
    '--btn-active-bg', '--btn-active-border', '--sidebar-bg', '--sidebar-border',
    '--card-bg', '--vocab-indicator-color', '--v-word-color', '--v-context-color',
    '--v-meaning-color', '--v-not-color', '--chunk-active-bg', '--chunk-cn-color',
    '--chunk-note-color', '--chunk-note-glass-bg', '--chunk-note-glass-border',
    '--chunk-note-connector-default', '--chunk-note-connector-shadow',
    '--chunk-annot-default', '--glass-bg-light', '--glass-bg-medium',
    '--glass-bg-strong', '--glass-border-light', '--glass-border-strong',
    '--glass-shadow', '--glass-shadow-soft', '--liquid-bg', '--liquid-border',
    '--liquid-specular', '--liquid-shadow', '--glass-panel-bg',
    '--glass-panel-bg-strong', '--glass-button-bg', '--glass-card-bg',
    '--glass-border', '--glass-highlight', '--glass-shadow-sm',
    '--glass-shadow-md', '--glass-shadow-lg', '--bg-gradient'
  ];

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function normalizeHexColor(value, fallback) {
    var raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      return '#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3];
    }
    return fallback;
  }

  function hexToRgb(hex) {
    var normalized = normalizeHexColor(hex, '#000000').slice(1);
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  }

  function rgbToHex(rgb) {
    return '#' + [rgb.r, rgb.g, rgb.b]
      .map(function (v) { return clampByte(v).toString(16).padStart(2, '0'); })
      .join('');
  }

  function mixHex(colorA, colorB, weight) {
    if (weight === undefined) weight = 0.5;
    var a = hexToRgb(colorA);
    var b = hexToRgb(colorB);
    var ratio = Math.max(0, Math.min(1, weight));
    return rgbToHex({
      r: a.r + ((b.r - a.r) * ratio),
      g: a.g + ((b.g - a.g) * ratio),
      b: a.b + ((b.b - a.b) * ratio)
    });
  }

  function hexToRgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
  }

  function getColorLuminance(hex) {
    var rgb = hexToRgb(hex);
    return ((rgb.r * 0.2126) + (rgb.g * 0.7152) + (rgb.b * 0.0722)) / 255;
  }

  function getStoredCustomThemeColors() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || '{}');
      return {
        bg: normalizeHexColor(parsed.bg, CUSTOM_THEME_DEFAULTS.bg),
        text: normalizeHexColor(parsed.text, CUSTOM_THEME_DEFAULTS.text),
        sub: normalizeHexColor(parsed.sub, CUSTOM_THEME_DEFAULTS.sub),
        border: normalizeHexColor(parsed.border, CUSTOM_THEME_DEFAULTS.border),
        button: normalizeHexColor(parsed.button, CUSTOM_THEME_DEFAULTS.button)
      };
    } catch (e) {
      return {
        bg: CUSTOM_THEME_DEFAULTS.bg,
        text: CUSTOM_THEME_DEFAULTS.text,
        sub: CUSTOM_THEME_DEFAULTS.sub,
        border: CUSTOM_THEME_DEFAULTS.border,
        button: CUSTOM_THEME_DEFAULTS.button
      };
    }
  }

  function setCustomThemeInputValues(colors) {
    var bg = document.getElementById('theme-custom-bg');
    var text = document.getElementById('theme-custom-text');
    var sub = document.getElementById('theme-custom-sub');
    var border = document.getElementById('theme-custom-border');
    var button = document.getElementById('theme-custom-button');
    if (!bg || !text || !sub || !border || !button) return;
    bg.value = colors.bg;
    text.value = colors.text;
    sub.value = colors.sub;
    border.value = colors.border;
    button.value = colors.button;
  }

  function clearCustomThemeVars() {
    CUSTOM_THEME_VAR_NAMES.forEach(function (name) {
      document.documentElement.style.removeProperty(name);
    });
  }

  function buildCustomThemeVars(colors) {
    var isDarkBase = getColorLuminance(colors.bg) < 0.45;
    var shadowColor = isDarkBase ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.12)';
    var shadowSoftColor = isDarkBase ? 'rgba(0, 0, 0, 0.26)' : 'rgba(15, 23, 42, 0.10)';
    var shadowStrongColor = isDarkBase ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.18)';
    var highlightColor = isDarkBase ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.78)';
    var sidebarBg = mixHex(colors.bg, colors.text, isDarkBase ? 0.12 : 0.04);
    var cardBg = mixHex(colors.bg, colors.button, 0.32);
    var chunkActiveBg = mixHex(colors.bg, colors.text, isDarkBase ? 0.18 : 0.1);
    var glassBgBase = isDarkBase ? mixHex(colors.bg, '#101418', 0.24) : mixHex(colors.bg, '#ffffff', 0.38);
    var panelBgBase = isDarkBase ? mixHex(colors.bg, colors.button, 0.2) : mixHex(colors.bg, colors.button, 0.42);
    var radialA = hexToRgba(mixHex(colors.button, '#ffffff', isDarkBase ? 0.08 : 0.45), isDarkBase ? 0.2 : 0.42);
    var radialB = hexToRgba(mixHex(colors.border, colors.button, 0.4), isDarkBase ? 0.18 : 0.3);
    return {
      '--bg-color': colors.bg,
      '--text-main': colors.text,
      '--text-sub': colors.sub,
      '--border-color': colors.border,
      '--input-bg': mixHex(colors.bg, colors.text, isDarkBase ? 0.12 : 0.05),
      '--input-text': colors.text,
      '--btn-bg': colors.button,
      '--btn-hover': mixHex(colors.button, colors.text, isDarkBase ? 0.18 : 0.12),
      '--btn-text': colors.text,
      '--btn-active-bg': mixHex(colors.button, colors.text, isDarkBase ? 0.3 : 0.2),
      '--btn-active-border': mixHex(colors.border, colors.text, isDarkBase ? 0.22 : 0.08),
      '--sidebar-bg': sidebarBg, '--sidebar-border': colors.border,
      '--card-bg': cardBg, '--vocab-indicator-color': colors.sub,
      '--v-word-color': colors.text, '--v-context-color': colors.sub,
      '--v-meaning-color': colors.sub,
      '--v-not-color': mixHex(colors.sub, colors.bg, 0.22),
      '--chunk-active-bg': chunkActiveBg, '--chunk-cn-color': colors.sub,
      '--chunk-note-color': colors.text,
      '--chunk-note-glass-bg': hexToRgba(panelBgBase, isDarkBase ? 0.82 : 0.84),
      '--chunk-note-glass-border': hexToRgba(colors.border, isDarkBase ? 0.28 : 0.4),
      '--chunk-note-connector-default': hexToRgba(colors.text, isDarkBase ? 0.48 : 0.32),
      '--chunk-note-connector-shadow': hexToRgba(isDarkBase ? '#000000' : '#ffffff', isDarkBase ? 0.22 : 0.55),
      '--chunk-annot-default': hexToRgba(colors.text, isDarkBase ? 0.42 : 0.3),
      '--glass-bg-light': hexToRgba(glassBgBase, 0.56),
      '--glass-bg-medium': hexToRgba(glassBgBase, 0.62),
      '--glass-bg-strong': hexToRgba(glassBgBase, 0.72),
      '--glass-border-light': hexToRgba(colors.border, isDarkBase ? 0.16 : 0.58),
      '--glass-border-strong': hexToRgba(colors.border, isDarkBase ? 0.24 : 0.72),
      '--glass-shadow': '0 8px 24px ' + shadowColor,
      '--glass-shadow-soft': '0 2px 10px ' + shadowSoftColor,
      '--liquid-bg': hexToRgba(glassBgBase, isDarkBase ? 0.28 : 0.25),
      '--liquid-border': hexToRgba(colors.border, isDarkBase ? 0.2 : 0.36),
      '--liquid-specular': isDarkBase
        ? 'inset 1px 1px 0 rgba(255, 255, 255, 0.18), inset 0 0 5px rgba(255, 255, 255, 0.12)'
        : 'inset 1px 1px 0 rgba(255, 255, 255, 0.75), inset 0 0 5px rgba(255, 255, 255, 0.75)',
      '--liquid-shadow': isDarkBase
        ? '0 6px 6px rgba(0, 0, 0, 0.32), 0 0 20px rgba(0, 0, 0, 0.20)'
        : '0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)',
      '--glass-panel-bg': hexToRgba(panelBgBase, isDarkBase ? 0.56 : 0.34),
      '--glass-panel-bg-strong': hexToRgba(panelBgBase, isDarkBase ? 0.64 : 0.42),
      '--glass-button-bg': hexToRgba(colors.button, isDarkBase ? 0.52 : 0.26),
      '--glass-card-bg': hexToRgba(cardBg, isDarkBase ? 0.66 : 0.48),
      '--glass-border': hexToRgba(colors.border, isDarkBase ? 0.22 : 0.52),
      '--glass-highlight': highlightColor,
      '--glass-shadow-sm': '0 2px 8px ' + shadowSoftColor,
      '--glass-shadow-md': '0 6px 22px ' + shadowColor,
      '--glass-shadow-lg': '0 16px 34px ' + shadowStrongColor,
      '--bg-gradient': 'radial-gradient(1200px 520px at -8% -16%, ' + radialA + ', transparent 60%), radial-gradient(900px 500px at 108% 4%, ' + radialB + ', transparent 56%), linear-gradient(180deg, ' + mixHex(colors.bg, '#ffffff', isDarkBase ? 0.04 : 0.16) + ' 0%, ' + mixHex(colors.bg, '#000000', isDarkBase ? 0.12 : 0.04) + ' 100%)'
    };
  }

  function updateThemeToggleUi(theme) {
    var labels = {
      light: { icon: '\u2600', title: '\u5F53\u524D\u6D45\u8272\uFF0C\u70B9\u51FB\u5207\u6362\u5230\u6DF1\u8272' },
      dark: { icon: '\u263E', title: '\u5F53\u524D\u6DF1\u8272\uFF0C\u70B9\u51FB\u5207\u6362\u5230\u81EA\u5B9A\u4E49' },
      custom: { icon: '\u2726', title: '\u5F53\u524D\u81EA\u5B9A\u4E49\uFF0C\u70B9\u51FB\u5207\u6362\u5230\u6D45\u8272' }
    };
    var config = labels[theme] || labels.light;
    var toggleBtn = document.getElementById('theme-toggle');
    var panel = document.getElementById('theme-custom-panel');
    if (toggleBtn) {
      toggleBtn.textContent = config.icon;
      toggleBtn.title = config.title;
    }
    if (panel && theme !== 'custom') {
      panel.hidden = true;
    }
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(panel && !panel.hidden));
    }
  }

  function openCustomThemePanel() {
    var panel = document.getElementById('theme-custom-panel');
    if (!panel) return;
    panel.hidden = false;
    var toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
  }

  function closeCustomThemePanel() {
    var panel = document.getElementById('theme-custom-panel');
    if (!panel) return;
    panel.hidden = true;
    var toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function applyThemeDefaults(theme) {
    if (localStorage.getItem('sentenceColor') || localStorage.getItem('highlightColor')) {
      return;
    }
    var defaults = theme === 'dark'
      ? { sentence: '#2d3748', highlight: '#b7950b' }
      : { sentence: '#e5e7eb', highlight: '#ffeb3b' };
    var sentenceInput = document.getElementById('sentence-color-input');
    var highlightInput = document.getElementById('highlight-color-input');
    if (sentenceInput) sentenceInput.value = defaults.sentence;
    if (highlightInput) highlightInput.value = defaults.highlight;
  }

  function applyCustomTheme(colors, persist) {
    if (persist === undefined) persist = true;
    var vars = buildCustomThemeVars(colors);
    var isDarkBase = getColorLuminance(colors.bg) < 0.45;
    document.documentElement.setAttribute('data-theme', isDarkBase ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-mode', 'custom');
    var names = Object.keys(vars);
    for (var i = 0; i < names.length; i++) {
      document.documentElement.style.setProperty(names[i], vars[names[i]]);
    }
    setCustomThemeInputValues(colors);
    if (persist) {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(colors));
      localStorage.setItem('theme', 'custom');
    }
    applyThemeDefaults(isDarkBase ? 'dark' : 'light');
    updateThemeToggleUi('custom');
  }

  function applyThemeMode(theme, persist) {
    if (persist === undefined) persist = true;
    clearCustomThemeVars();
    document.documentElement.removeAttribute('data-theme-mode');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (persist) localStorage.setItem('theme', 'dark');
      applyThemeDefaults('dark');
    } else if (theme === 'custom') {
      applyCustomTheme(getStoredCustomThemeColors(), persist);
      return;
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (persist) localStorage.setItem('theme', 'light');
      applyThemeDefaults('light');
    }
    updateThemeToggleUi(theme);
  }

  function initTheme() {
    setCustomThemeInputValues(getStoredCustomThemeColors());
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'custom') {
      applyThemeMode(savedTheme, false);
    } else {
      applyThemeMode('light', false);
    }
  }

  window.__themeStore = {
    init: initTheme,
    applyThemeMode: applyThemeMode,
    applyCustomTheme: applyCustomTheme,
    closeCustomThemePanel: closeCustomThemePanel,
    openCustomThemePanel: openCustomThemePanel,
    getStoredCustomThemeColors: getStoredCustomThemeColors,
    CUSTOM_THEME_DEFAULTS: CUSTOM_THEME_DEFAULTS
  };
