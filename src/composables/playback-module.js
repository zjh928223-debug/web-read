  function init(deps) {
    var audioPlayer = deps.audioPlayer;
    var getCurrentSegmentIndexHelper = deps.getCurrentSegmentIndexHelper;
    var getSegmentCheckpointsHelper = deps.getSegmentCheckpointsHelper;
    var bsFindActiveHelper = deps.bsFindActiveHelper;
    var findChunkIndexByTime = deps.findChunkIndexByTime;
    var swapActiveClass = deps.swapActiveClass;
    var followPlaybackTarget = deps.followPlaybackTarget;
    var getAnnotationBubble = deps.getAnnotationBubble;
    var jumpPrevSentence = deps.jumpPrevSentence;
    var jumpNextSentence = deps.jumpNextSentence;

    function syncPlaybackStores(activeWordIdx, activeSegIdx, activeChunkIdx) {
      var ps = window.__piniaStores;
      var st = window.__state;
      if (!ps) return;
      if (ps.transcript) {
        ps.transcript.currentWordIndex = st.currentWordIndex;
        ps.transcript.highlightMode = st.highlightMode;
        ps.transcript.activeWordIdx = activeWordIdx;
        ps.transcript.activeSegIdx = activeSegIdx;
      }
      if (ps.chunk) {
        ps.chunk.activeChunkIdx = activeChunkIdx;
      }
    }

    function getChunkIndexAt(time) {
      var st = window.__state;
      var idx = findChunkIndexByTime(time);
      if (idx !== -1) return idx;
      if (!st.chunkItems || st.chunkItems.length === 0) return -1;
      return time < st.chunkItems[0].start ? 0 : st.chunkItems.length - 1;
    }

    function mainUpdateHighlight(wordIndex, currentTime) {
      var st = window.__state;
      if (currentTime === undefined) currentTime = audioPlayer.currentTime;

      if (st.isChunkMode) {
        if (wordIndex !== -1) {
          st.currentWordIndex = wordIndex;
          if (st.words[wordIndex] && Number.isInteger(st.words[wordIndex].segIndex)) {
            st.lastActiveSegIndex = st.words[wordIndex].segIndex;
          }
        }

        var chunkIdx = findChunkIndexByTime(currentTime);
        var nextWordEl = (st.highlightMode === 1 && wordIndex !== -1)
          ? document.getElementById('word-' + wordIndex)
          : null;
        st.activeWordHighlightEl = swapActiveClass(nextWordEl, st.activeWordHighlightEl, 'word-highlight');
        st.activeSentenceEl = swapActiveClass(null, st.activeSentenceEl, 'sentence-active');

        if (chunkIdx !== -1) {
          if (chunkIdx !== st.lastActiveChunkIndex) {
            var chunkBlock = document.getElementById('chunk-' + chunkIdx);
            st.activeChunkEl = swapActiveClass(chunkBlock, st.activeChunkEl, 'chunk-active');
            followPlaybackTarget(chunkBlock);
            st.lastActiveChunkIndex = chunkIdx;
          }
        } else {
          st.activeChunkEl = swapActiveClass(null, st.activeChunkEl, 'chunk-active');
          st.lastActiveChunkIndex = -1;
        }

        syncPlaybackStores(st.highlightMode === 1 && wordIndex !== -1 ? wordIndex : -1, -1, chunkIdx);
        return;
      }

      if (wordIndex !== -1) {
        st.currentWordIndex = wordIndex;
      }
      st.activeChunkEl = swapActiveClass(null, st.activeChunkEl, 'chunk-active');

      if (st.highlightMode === 2) {
        var segIdx = getCurrentSegmentIndexHelper(st.segments, st.words, st.wordStarts, currentTime);
        if (segIdx !== -1) {
          if (segIdx !== st.lastActiveSegIndex) {
            st.activeWordHighlightEl = swapActiveClass(null, st.activeWordHighlightEl, 'word-highlight');
            var lineDiv = document.getElementById('segment-' + segIdx);
            st.activeSentenceEl = swapActiveClass(lineDiv, st.activeSentenceEl, 'sentence-active');
            followPlaybackTarget(lineDiv);
            st.lastActiveSegIndex = segIdx;
          }
          syncPlaybackStores(-1, segIdx, -1);
        } else {
          st.activeSentenceEl = swapActiveClass(null, st.activeSentenceEl, 'sentence-active');
          st.lastActiveSegIndex = -1;
          syncPlaybackStores(-1, -1, -1);
        }
        return;
      }

      st.activeSentenceEl = swapActiveClass(null, st.activeSentenceEl, 'sentence-active');

      if (st.highlightMode === 1 && wordIndex !== -1) {
        var span = document.getElementById('word-' + wordIndex);
        st.activeWordHighlightEl = swapActiveClass(span, st.activeWordHighlightEl, 'word-highlight');
        followPlaybackTarget(span);
        syncPlaybackStores(wordIndex, -1, -1);
      } else {
        st.activeWordHighlightEl = swapActiveClass(null, st.activeWordHighlightEl, 'word-highlight');
        syncPlaybackStores(-1, -1, -1);
      }
      st.lastActiveSegIndex = -1;
    }

    function bsFindActive(time) {
      var st = window.__state;
      return bsFindActiveHelper(st.wordStarts, st.words, time);
    }

    function forceUpdateUI(time) {
      var idx = bsFindActive(time);
      mainUpdateHighlight(idx, time);
    }

    function getCurrentSegmentIndex(time) {
      if (time === undefined) time = audioPlayer.currentTime;
      var st = window.__state;
      return getCurrentSegmentIndexHelper(st.segments, st.words, st.wordStarts, time);
    }

    function getSegmentCheckpoints(segIndex) {
      var st = window.__state;
      return getSegmentCheckpointsHelper(st.segments, segIndex);
    }

    function smartBackward() {
      var st = window.__state;
      var cur = audioPlayer.currentTime;
      var sIdx = getCurrentSegmentIndex(cur);
      if (sIdx === -1) { audioPlayer.currentTime = 0; forceUpdateUI(0); return; }
      var points = getSegmentCheckpoints(sIdx);
      var validPoints = points.filter(function (p) { return p < cur - 0.5; });
      if (validPoints.length > 0) {
        var target = validPoints[validPoints.length - 1];
        audioPlayer.currentTime = Math.max(0, target - 0.15);
        forceUpdateUI(audioPlayer.currentTime);
        return;
      }
      if (sIdx > 0) {
        var prevPoints = getSegmentCheckpoints(sIdx - 1);
        if (prevPoints.length > 0) {
          var t = prevPoints[prevPoints.length - 1];
          audioPlayer.currentTime = Math.max(0, t - 0.15);
        } else {
          audioPlayer.currentTime = Math.max(0, st.segments[sIdx - 1].start - 0.15);
        }
        forceUpdateUI(audioPlayer.currentTime);
      } else {
        audioPlayer.currentTime = 0;
        forceUpdateUI(0);
      }
    }

    function smartForward() {
      var st = window.__state;
      var cur = audioPlayer.currentTime;
      var sIdx = getCurrentSegmentIndex(cur);
      var nextSeg = (sIdx >= 0 && sIdx < st.segments.length - 1) ? st.segments[sIdx + 1] : null;
      if (nextSeg && Number.isFinite(nextSeg.start)) {
        audioPlayer.currentTime = nextSeg.start;
        forceUpdateUI(nextSeg.start);
      }
    }

    function getActiveAiChunkIndex(time) {
      if (time === undefined) time = audioPlayer.currentTime;
      var st = window.__state;
      if (!st.chunkItems || st.chunkItems.length === 0 || !st.hasAiChunkData) return -1;
      return getChunkIndexAt(time);
    }

    function isAiChunkNavMode() {
      var st = window.__state;
      return st.isChunkMode && st.hasAiChunkData && Array.isArray(st.chunkItems) && st.chunkItems.length > 0;
    }

    function seekAndPlay(targetTime) {
      audioPlayer.currentTime = targetTime;
      forceUpdateUI(targetTime);
      if (audioPlayer.paused) {
        var p = audioPlayer.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    }

    function aiChunkBackward() {
      var st = window.__state;
      var idx = getActiveAiChunkIndex();
      if (idx === -1) return;
      var now = Date.now();
      var isRepeated = st.lastAiPrevTapChunkIndex === idx && (now - st.lastAiPrevTapAt) <= 600;
      var targetIdx = isRepeated ? Math.max(0, idx - 1) : idx;
      var targetTime = st.chunkItems[targetIdx].start;
      seekAndPlay(targetTime);
      st.lastAiPrevTapChunkIndex = targetIdx;
      st.lastAiPrevTapAt = now;
    }

    function aiChunkForward() {
      var st = window.__state;
      var idx = getActiveAiChunkIndex();
      if (idx === -1) return;
      var targetIdx = Math.min(st.chunkItems.length - 1, idx + 1);
      var targetTime = st.chunkItems[targetIdx].start;
      seekAndPlay(targetTime);
      st.lastAiPrevTapChunkIndex = -1;
      st.lastAiPrevTapAt = 0;
    }

    function handleBackwardClickNormalMode() {
      var st = window.__state;
      if (st.highlightMode === 2 && !st.isChunkMode) jumpPrevSentence();
      else smartBackward();
    }

    function handleForwardClickNormalMode() {
      var st = window.__state;
      if (st.highlightMode === 2 && !st.isChunkMode) jumpNextSentence();
      else smartForward();
    }

    function handleBackwardClick() {
      if (isAiChunkNavMode()) aiChunkBackward();
      else handleBackwardClickNormalMode();
    }

    function handleForwardClick() {
      if (isAiChunkNavMode()) aiChunkForward();
      else handleForwardClickNormalMode();
    }

    function toggleAnnotationBubble() {
      var bubble = getAnnotationBubble();
      if (bubble && typeof bubble.toggle === 'function') {
        bubble.toggle();
      }
    }

    // Expose to window (HTML onclick needs these)
    window.handleBackwardClick = handleBackwardClick;
    window.handleForwardClick = handleForwardClick;
    window.forceUpdateUI = forceUpdateUI;
    window.mainUpdateHighlight = mainUpdateHighlight;
    window.toggleAnnotationBubble = toggleAnnotationBubble;
    window.handleBackwardClickNormalMode = handleBackwardClickNormalMode;
    window.handleForwardClickNormalMode = handleForwardClickNormalMode;
  }

  window.__playbackModule = { init: init };
