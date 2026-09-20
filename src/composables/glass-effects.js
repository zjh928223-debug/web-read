    var activeDispose = null;

    function init(lockChunkDimensionsFn) {
      if (typeof activeDispose === 'function') activeDispose();
      var panelSelector = [
        '.controls','.extra-controls','.transcript-header','#helper-panel',
      '#style-editor-modal','#chunk-style-modal',
      '#app-toast','.control-group','.hotkey-box'
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

    function decorateExisting() {
      document.querySelectorAll(panelSelector).forEach(function (el) {
        el.classList.add('glass-panel');
        bindGlassDynamic(el);
      });
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
          if (node.matches && node.matches(panelSelector)) {
            node.classList.add('glass-panel');
            bindGlassDynamic(node);
          }
          if (node.matches && node.matches(buttonSelector)) {
            decorateButton(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(panelSelector).forEach(function (el) {
              el.classList.add('glass-panel');
              bindGlassDynamic(el);
            });
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

  window.__glassEffects = { init: init };
