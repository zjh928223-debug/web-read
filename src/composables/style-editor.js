  function init(deps) {
    var safeParseLocalJSON = deps.safeParseLocalJSON;
    var adjustChunkNoteArrowSizeByGap = deps.adjustChunkNoteArrowSizeByGap;
    var renderAllChunkNoteTags = deps.renderAllChunkNoteTags;
    var scheduleChunkNoteConnectorRedraw = deps.scheduleChunkNoteConnectorRedraw;
    var getIsChunkMode = deps.getIsChunkMode;
    var closeChunkNotePopover = deps.closeChunkNotePopover;
    var closeAnnotationPromptPanel = deps.closeAnnotationPromptPanel;
    var updateShadowBtnText = deps.updateShadowBtnText;

    var styleSettings = {
      word: { prefix: '--v-word-', label: 'Word (单词)' },
      context: { prefix: '--v-context-', label: 'Context (语境)' },
      meaning: { prefix: '--v-meaning-', label: 'Meaning (释义)' },
      not: { prefix: '--v-not-', label: 'Not Meaning (非释义)' },
      global: { prefix: '--v-', label: 'Global (全局)' }
    };

    var defaultStyles = {
      '--v-word-size': '28px', '--v-word-color': '#1c1e21', '--v-word-weight': '900', '--v-word-style': 'normal', '--v-word-spacing': '-0.5px',
      '--v-context-size': '14px', '--v-context-color': '#555555', '--v-context-weight': '400', '--v-context-style': 'italic', '--v-context-spacing': '0px',
      '--v-meaning-size': '15px', '--v-meaning-color': '#4b5563', '--v-meaning-weight': '700', '--v-meaning-style': 'normal', '--v-meaning-spacing': '0px',
      '--v-not-size': '12px', '--v-not-color': '#999999', '--v-not-weight': '400', '--v-not-style': 'normal', '--v-not-spacing': '0px',
      '--v-word-display': 'block', '--v-context-display': 'block', '--v-meaning-display': 'block', '--v-not-display': 'block', '--v-gap': '8px'
    };

    function applyStyle(varName, value) {
      document.documentElement.style.setProperty(varName, value);
      var saved = safeParseLocalJSON ? safeParseLocalJSON('visualStyles', {}) : {};
      saved[varName] = value;
      localStorage.setItem('visualStyles', JSON.stringify(saved));
    }

    function initStyleEditor() {
      var saved = safeParseLocalJSON ? safeParseLocalJSON('visualStyles', {}) : {};
      Object.keys(defaultStyles).forEach(function (key) {
        document.documentElement.style.setProperty(key, saved[key] || defaultStyles[key]);
      });
      var container = document.getElementById('style-controls-container');
      if (!container) return;
      container.innerHTML = '';
      container.appendChild(createStyleControlSection('global', '全局布局', [{ type: 'number', label: 'Gap', prop: 'gap', suffix: 'px' }]));
      Object.keys(styleSettings).forEach(function (key) {
        if (key === 'global') return;
        var controls = [
          { type: 'toggle', label: 'B', prop: 'weight', onVal: '900', offVal: '400', title: '加粗' },
          { type: 'toggle', label: 'I', prop: 'style', onVal: 'italic', offVal: 'normal', title: '斜体' },
          { type: 'color', label: 'Color', prop: 'color' },
          { type: 'number', label: 'Size', prop: 'size', suffix: 'px' },
          { type: 'number', label: 'Space', prop: 'spacing', suffix: 'px', step: 0.5 }
        ];
        container.appendChild(createStyleControlSection(key, styleSettings[key].label, controls));
      });
    }

    function createStyleControlSection(sectionKey, title, controls) {
      var div = document.createElement('div');
      div.className = 'style-section';
      div.innerHTML = '<h4>' + title + '</h4>';
      var row = document.createElement('div');
      row.className = 'control-row';
      div.appendChild(row);
      var prefix = styleSettings[sectionKey] ? styleSettings[sectionKey].prefix : '--v-';

      if (sectionKey !== 'global') {
        var eyeBtn = document.createElement('button');
        eyeBtn.className = 'style-btn-toggle';
        eyeBtn.style.marginRight = '8px';
        eyeBtn.title = '显示/隐藏';
        var displayVar = prefix + 'display';
        var currentDisplay = getComputedStyle(document.documentElement).getPropertyValue(displayVar).trim();
        if (!currentDisplay) currentDisplay = 'block';
        var isVisible = currentDisplay !== 'none';
        eyeBtn.innerText = isVisible ? 'Show' : 'Hide';
        if (!isVisible) eyeBtn.style.opacity = '0.5';
        eyeBtn.onclick = function () {
          var nowVisible = eyeBtn.innerText === 'Show';
          if (nowVisible) {
            applyStyle(displayVar, 'none'); eyeBtn.innerText = 'Hide'; eyeBtn.style.opacity = '0.5';
          } else {
            applyStyle(displayVar, 'block'); eyeBtn.innerText = 'Show'; eyeBtn.style.opacity = '1';
          }
        };
        row.appendChild(eyeBtn);
      }

      controls.forEach(function (ctrl) {
        var varName = prefix + ctrl.prop;
        var currentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (!currentVal && defaultStyles[varName]) currentVal = defaultStyles[varName];

        if (ctrl.type === 'toggle') {
          var btn = document.createElement('button');
          btn.className = 'style-btn-toggle'; btn.innerText = ctrl.label; btn.title = ctrl.title || '';
          if (currentVal === ctrl.onVal) btn.classList.add('active');
          btn.onclick = function () {
            var isNowActive = btn.classList.toggle('active');
            applyStyle(varName, isNowActive ? ctrl.onVal : ctrl.offVal);
          };
          row.appendChild(btn);
        } else if (ctrl.type === 'color') {
          var inp = document.createElement('input');
          inp.type = 'color'; inp.className = 'color-input';
          inp.value = (currentVal.length === 7 && currentVal.charAt(0) === '#') ? currentVal : '#000000';
          inp.oninput = function (e) { applyStyle(varName, e.target.value); };
          row.appendChild(inp);
        } else if (ctrl.type === 'number') {
          var wrap = document.createElement('div');
          wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.marginRight = '4px';
          var lbl = document.createElement('span');
          lbl.innerText = ctrl.label; lbl.style.fontSize = '12px'; lbl.style.marginRight = '2px';
          var inp2 = document.createElement('input');
          inp2.type = 'number'; inp2.className = 'style-input-num'; inp2.step = ctrl.step || 1;
          inp2.value = parseFloat(currentVal) || 0;
          inp2.oninput = function (e) { applyStyle(varName, e.target.value + (ctrl.suffix || '')); };
          wrap.appendChild(lbl); wrap.appendChild(inp2); row.appendChild(wrap);
        }
      });
      return div;
    }

    function openChunkStyleModal() {
      var backdrop = document.getElementById('modal-backdrop');
      var modal = document.getElementById('chunk-style-modal');
      if (backdrop) backdrop.style.display = 'block';
      if (modal) modal.style.display = 'block';
      var styles = getComputedStyle(document.documentElement);
      var enSize = styles.getPropertyValue('--chunk-en-size').trim().replace('px', '');
      var cnSize = styles.getPropertyValue('--chunk-cn-size').trim().replace('px', '');
      var cnColor = localStorage.getItem('chunkCnColor') || styles.getPropertyValue('--chunk-cn-color').trim();
      var bgColor = localStorage.getItem('chunkBgColor') || styles.getPropertyValue('--chunk-active-bg').trim();
      if (!cnColor || cnColor.length !== 7) cnColor = '#4b5563';
      if (!bgColor || bgColor.length !== 7) bgColor = '#e5e7eb';
      var enInp = document.getElementById('chunk-en-size-input');
      var cnInp = document.getElementById('chunk-cn-size-input');
      var gapInp = document.getElementById('chunk-gap-input');
      var cnCol = document.getElementById('chunk-cn-color-input');
      var bgCol = document.getElementById('chunk-bg-color-input');
      if (enInp) enInp.value = parseInt(enSize) || 20;
      if (cnInp) cnInp.value = parseInt(cnSize) || 16;
      if (gapInp) gapInp.value = parseInt(styles.getPropertyValue('--chunk-gap').trim().replace('px', '')) || 20;
      if (cnCol) cnCol.value = cnColor;
      if (bgCol) bgCol.value = bgColor;
      if (typeof updateShadowBtnText === 'function') updateShadowBtnText();
    }

    function closeChunkStyleModal() {
      var backdrop = document.getElementById('modal-backdrop');
      var modal = document.getElementById('chunk-style-modal');
      if (backdrop) backdrop.style.display = 'none';
      if (modal) modal.style.display = 'none';
    }

    function updateChunkStyle() {
      var en = document.getElementById('chunk-en-size-input').value;
      var cn = document.getElementById('chunk-cn-size-input').value;
      var gap = document.getElementById('chunk-gap-input').value;
      var cnColor = document.getElementById('chunk-cn-color-input').value;
      var bgColor = document.getElementById('chunk-bg-color-input').value;
      document.documentElement.style.setProperty('--chunk-en-size', en + 'px');
      document.documentElement.style.setProperty('--chunk-cn-size', cn + 'px');
      document.documentElement.style.setProperty('--chunk-gap', gap + 'px');
      document.documentElement.style.setProperty('--chunk-cn-color', cnColor);
      document.documentElement.style.setProperty('--chunk-active-bg', bgColor);
      localStorage.setItem('chunkEnSize', en + 'px'); localStorage.setItem('chunkCnSize', cn + 'px');
      localStorage.setItem('chunkGap', gap + 'px'); localStorage.setItem('chunkCnColor', cnColor);
      localStorage.setItem('chunkBgColor', bgColor);
      if (typeof adjustChunkNoteArrowSizeByGap === 'function') adjustChunkNoteArrowSizeByGap();
      if (getIsChunkMode && getIsChunkMode() && typeof renderAllChunkNoteTags === 'function') renderAllChunkNoteTags();
      if (typeof scheduleChunkNoteConnectorRedraw === 'function') scheduleChunkNoteConnectorRedraw();
    }

    // Wire global functions for HTML onclick
    window.openChunkStyleModal = openChunkStyleModal;
    window.closeChunkStyleModal = closeChunkStyleModal;
    window.updateChunkStyle = updateChunkStyle;

    // Wire modal backdrop click
    var backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.onclick = function () {
        closeChunkStyleModal();
        var noteModal = document.getElementById('chunk-note-style-modal');
        if (noteModal) noteModal.style.display = 'none';
        if (typeof closeChunkNotePopover === 'function') closeChunkNotePopover();
        if (typeof closeAnnotationPromptPanel === 'function') closeAnnotationPromptPanel();
      };
    }

    // Open style editor button
    var openBtn = document.getElementById('open-style-editor');
    if (openBtn) {
      openBtn.onclick = function () {
        var bd = document.getElementById('modal-backdrop');
        var se = document.getElementById('style-editor-modal');
        if (bd) bd.style.display = 'block';
        if (se) se.style.display = 'block';
        initStyleEditor();
      };
    }
  }

  window.__styleEditor = { init: init };
