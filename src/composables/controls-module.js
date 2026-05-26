(function () {
  'use strict';
  function init(deps) {
    var audioPlayer = deps.audioPlayer;
    var bsFindActiveHelper = deps.bsFindActiveHelper;
    var findChunkIndexByTime = deps.findChunkIndexByTime;
    var getCurrentSegmentIndexHelper = deps.getCurrentSegmentIndexHelper;
    var toggleFollowBtn = deps.toggleFollowBtn;
    var mainAppArea = deps.mainAppArea;
    var annotationPromptCopyBtn = deps.annotationPromptCopyBtn;
    var annotationPromptExportBtn = deps.annotationPromptExportBtn;
    var annotationPromptCloseBtn = deps.annotationPromptCloseBtn;

    // === Speed button ===
    function changeSpeed(r) {
      audioPlayer.playbackRate = r;
      var btns = document.querySelectorAll('.speed-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('speed-button-active', parseFloat(btns[i].dataset.speed) === r);
      }
    }
    window.changeSpeed = changeSpeed;

    // === Follow toggle ===
    if (toggleFollowBtn) {
      toggleFollowBtn.onclick = function () {
        var st = window.__state;
        st.autoFollow = !st.autoFollow;
        toggleFollowBtn.classList.toggle('on', st.autoFollow);
        toggleFollowBtn.innerText = st.autoFollow ? '跟随:开' : '跟随:关';
      };
    }

    // === rAF audio sync loop ===
    (function audioSyncLoop() {
      function loop() {
        var st = window.__state;
        if (!audioPlayer.paused) {
          var currentTime = audioPlayer.currentTime;
          var idx = bsFindActiveHelper(st.wordStarts, st.words, currentTime);
          var chunkIdx = st.isChunkMode ? findChunkIndexByTime(st.chunkItems, currentTime) : -1;
          var segIdx = (!st.isChunkMode && st.highlightMode === 2)
            ? getCurrentSegmentIndexHelper(st.segments, st.words, st.wordStarts, currentTime)
            : ((!st.isChunkMode && idx !== -1 && st.words[idx]) ? st.words[idx].segIndex : -1);
          var sig = (st.isChunkMode ? 'chunk' : 'line') + '|' + st.highlightMode + '|' + idx + '|' + chunkIdx + '|' + segIdx;
          if (sig !== st.playbackUiSignature) {
            st.playbackUiSignature = sig;
            if (typeof window.mainUpdateHighlight === 'function') {
              window.mainUpdateHighlight(idx, currentTime);
            }
          }
        }
        requestAnimationFrame(loop);
      }
      loop();

      if (mainAppArea) {
        mainAppArea.addEventListener('wheel', function () {
          var st = window.__state;
          st.userScrollSuppress = true;
          if (st.suppressTimer) clearTimeout(st.suppressTimer);
          st.suppressTimer = setTimeout(function () { st.userScrollSuppress = false; }, 3000);
        }, { passive: true });
      }
    })();

    // === Annotation prompt buttons ===
    if (annotationPromptCopyBtn) {
      annotationPromptCopyBtn.addEventListener('click', function () {
        if (typeof window.copyAnnotationPromptToClipboard === 'function') {
          window.copyAnnotationPromptToClipboard().catch(function () {});
        }
      });
    }
    if (annotationPromptExportBtn) {
      annotationPromptExportBtn.addEventListener('click', function () {
        if (typeof window.exportAnnotationPromptPackage === 'function') {
          window.exportAnnotationPromptPackage();
        }
      });
    }
    if (annotationPromptCloseBtn) {
      annotationPromptCloseBtn.addEventListener('click', function () {
        if (typeof window.closeAnnotationPromptPanel === 'function') {
          window.closeAnnotationPromptPanel();
        }
      });
    }
  }

  window.__controlsModule = { init: init };
})();
