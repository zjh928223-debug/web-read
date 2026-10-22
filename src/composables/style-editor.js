import { createDialogController } from '../services/runtime/dialog-controller.js';
import { applyNativeControlStyles } from '../lib/native-control-styles.js';
import { applyNativeInputStyles } from '../lib/native-input-styles.js';

  function init(deps) {
    var updateShadowBtnText = deps.updateShadowBtnText;
    var chunkStyleDialogController = createDialogController();

    var styleControlOwner = 'style-controls';
    var styleNumberInputClass = 'style-input-num rw:w-[86px]';

    function applyStyleButton(element, options) {
      return applyNativeControlStyles(element, Object.assign({
        owner: styleControlOwner,
        variant: 'outline',
        size: 'default'
      }, options || {}));
    }

    function applyStyleNumberInput(element) {
      return applyNativeInputStyles(element, {
        owner: styleControlOwner,
        size: 'default',
        interaction: 'text',
        className: styleNumberInputClass
      });
    }

    function applyStyleColorInput(element) {
      if (element && element.setAttribute) element.setAttribute('data-ui-owner', styleControlOwner);
      return element;
    }

    function applyChunkStyleControlStyles() {
      applyStyleButton(document.getElementById('btn-close-chunk-style-modal'), {
        variant: 'ghost',
        size: 'icon',
        className: 'close-modal rw:rounded-full rw:p-0'
      });
      applyStyleButton(document.getElementById('btn-toggle-shadow-manual'), {
        className: 'style-btn-toggle rw:ml-1'
      });
      ['chunk-en-size-input', 'chunk-cn-size-input', 'chunk-gap-input'].forEach(function (id) {
        applyStyleNumberInput(document.getElementById(id));
      });
      ['chunk-cn-color-input', 'chunk-bg-color-input'].forEach(function (id) {
        applyStyleColorInput(document.getElementById(id));
      });
    }

    applyChunkStyleControlStyles();

    function openChunkStyleModal() {
      var backdrop = document.getElementById('modal-backdrop');
      var modal = document.getElementById('chunk-style-modal');
      if (backdrop) backdrop.style.display = 'block';
      if (modal) modal.style.display = 'block';
      if (backdrop) backdrop.setAttribute('aria-hidden', 'false');
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
      if (modal) {
        chunkStyleDialogController.open(modal, {
          initialFocus: document.getElementById('btn-close-chunk-style-modal'),
          onRequestClose: closeChunkStyleModal
        });
      }
    }

    function closeChunkStyleModal() {
      var backdrop = document.getElementById('modal-backdrop');
      var modal = document.getElementById('chunk-style-modal');
      if (backdrop) backdrop.style.display = 'none';
      if (modal) modal.style.display = 'none';
      if (backdrop) backdrop.setAttribute('aria-hidden', 'true');
      chunkStyleDialogController.close();
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
      };
    }

    return function disposeStyleEditor() {
      chunkStyleDialogController.dispose();
    };
  }

  window.__styleEditor = { init: init };
