  function init(lockChunkDimensionsFn) {
    var panelSelector = [
      '.controls','.extra-controls','.transcript-header','#helper-panel',
      '#style-editor-modal','#chunk-style-modal','#chunk-note-style-modal',
      '#app-toast','#chunk-note-ctx-menu','.control-group','.hotkey-box'
    ].join(', ');

    var buttonSelector = [
      'button','.file-btn','.mini-toggle','.style-btn-toggle'
    ].join(', ');

    function setGlassPointerVars(el, clientX, clientY) {
      var rect = el.getBoundingClientRect();
      var x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 100;
      var y = ((clientY - rect.top) / Math.max(rect.height, 1)) * 100;
      el.style.setProperty('--glass-mx', Math.max(0, Math.min(100, x)) + '%');
      el.style.setProperty('--glass-my', Math.max(0, Math.min(100, y)) + '%');
    }

    function bindGlassDynamic(el) {
      if (!el || el.dataset.glassBound === '1') return;
      el.dataset.glassBound = '1';
      el.classList.add('ui-glass-dynamic');

      var rafId = 0;
      var px = 50;
      var py = 50;
      var onMove = function (ev) {
        px = ev.clientX;
        py = ev.clientY;
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
          setGlassPointerVars(el, px, py);
          rafId = 0;
        });
      };
      var onEnter = function (ev) {
        setGlassPointerVars(el, ev.clientX, ev.clientY);
      };
      var onLeave = function () {
        el.style.setProperty('--glass-mx', '50%');
        el.style.setProperty('--glass-my', '50%');
      };
      el.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('pointerenter', onEnter, { passive: true });
      el.addEventListener('pointerleave', onLeave, { passive: true });
    }

    function decorateExisting() {
      document.querySelectorAll(panelSelector).forEach(function (el) {
        el.classList.add('glass-panel');
        bindGlassDynamic(el);
      });
      document.querySelectorAll(buttonSelector).forEach(function (el) {
        el.classList.add('glass-button');
      });
    }

    decorateExisting();

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (!(node instanceof Element)) continue;
          if (node.matches && node.matches(panelSelector)) {
            node.classList.add('glass-panel');
            bindGlassDynamic(node);
          }
          if (node.matches && node.matches(buttonSelector)) {
            node.classList.add('glass-button');
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(panelSelector).forEach(function (el) {
              el.classList.add('glass-panel');
              bindGlassDynamic(el);
            });
            node.querySelectorAll(buttonSelector).forEach(function (el) {
              el.classList.add('glass-button');
            });
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (typeof lockChunkDimensionsFn === 'function') {
      window.__lockChunkNoteDimensionsForTheme = lockChunkDimensionsFn;
    }
  }

  window.__glassEffects = { init: init };
