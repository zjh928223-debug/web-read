    var activeDispose = null;

    function init(lockChunkDimensionsFn) {
      if (typeof activeDispose === 'function') activeDispose();
      var targetPanelSelector = [
        '.controls','.extra-controls','.transcript-header'
      ].join(', ');
      var panelSelector = [
      '#chunk-style-modal',
      '#app-toast'
      ].join(', ');

    var buttonSelector = [
      'button','.file-btn','.style-btn-toggle'
    ].join(', ');
    function decorateButton(el) {
      if (!el) return;
      var owner = typeof el.getAttribute === 'function'
        ? el.getAttribute('data-ui-owner')
        : el.dataset && el.dataset.uiOwner;
      if (owner === 'workflow' || owner === 'reader' || owner === 'style-controls' || owner === 'learning') {
        el.classList.remove('glass-button');
        return;
      }
      el.classList.add('glass-button');
    }
    var root = document.getElementById('main-app-area') || document.body;
    var bindings = [];
    var pendingNodes = [];
    var decorateRafId = 0;
    var disposed = false;

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
      bindings.push(function () {
        if (rafId) cancelAnimationFrame(rafId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerenter', onEnter);
        el.removeEventListener('pointerleave', onLeave);
        delete el.dataset.glassBound;
      });
    }

      function clearGlassPanel(el) {
        if (!el) return;
        el.classList.remove('glass-panel');
        el.classList.remove('ui-glass-dynamic');
        if (el.dataset) delete el.dataset.glassBound;
        if (el.style && typeof el.style.removeProperty === 'function') {
          el.style.removeProperty('--glass-mx');
          el.style.removeProperty('--glass-my');
        }
      }

      function decoratePanel(el) {
        if (!el || !el.matches) return;
        if (el.matches(targetPanelSelector)) {
          clearGlassPanel(el);
          return;
        }
        if (!el.matches(panelSelector)) return;
        el.classList.add('glass-panel');
        bindGlassDynamic(el);
      }

    function decorateExisting() {
        document.querySelectorAll(targetPanelSelector).forEach(clearGlassPanel);
        document.querySelectorAll(panelSelector).forEach(decoratePanel);
      document.querySelectorAll(buttonSelector).forEach(function (el) {
        decorateButton(el);
      });
    }

    decorateExisting();

    function decoratePendingNodes() {
      decorateRafId = 0;
      var nodes = pendingNodes;
      pendingNodes = [];
      for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!(node instanceof Element)) continue;
           decoratePanel(node);
          if (node.matches && node.matches(buttonSelector)) {
            decorateButton(node);
          }
          if (node.querySelectorAll) {
             node.querySelectorAll(targetPanelSelector).forEach(clearGlassPanel);
             node.querySelectorAll(panelSelector).forEach(decoratePanel);
            node.querySelectorAll(buttonSelector).forEach(function (el) {
              decorateButton(el);
            });
          }
      }
    }

    var observer = new MutationObserver(function (mutations) {
      if (disposed) return;
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        if (!addedNodes) continue;
        for (var j = 0; j < addedNodes.length; j++) pendingNodes.push(addedNodes[j]);
      }
      if (pendingNodes.length && !decorateRafId) {
        decorateRafId = requestAnimationFrame(decoratePendingNodes);
      }
    });

    observer.observe(root, { childList: true, subtree: true });

    activeDispose = function () {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (decorateRafId) cancelAnimationFrame(decorateRafId);
      pendingNodes = [];
      for (var i = bindings.length - 1; i >= 0; i--) bindings[i]();
      bindings = [];
      if (activeDispose === dispose) activeDispose = null;
    };
    var dispose = activeDispose;
    return dispose;
  }

  export function initGlassEffects() {
    return init();
  }
