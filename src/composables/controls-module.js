  var activeController = null;

  function init(deps) {
    if (activeController) activeController.dispose();
    var audioPlayer = (window.__mediaSource && typeof window.__mediaSource.createActiveMediaProxy === 'function')
      ? window.__mediaSource.createActiveMediaProxy(deps.audioPlayer)
      : deps.audioPlayer;
    var bsFindActiveHelper = deps.bsFindActiveHelper;
    var findChunkIndexByTime = deps.findChunkIndexByTime;
    var getCurrentSegmentIndexHelper = deps.getCurrentSegmentIndexHelper;
    var toggleFollowBtn = deps.toggleFollowBtn;
    var mainAppArea = deps.mainAppArea;
    var state = deps.state;

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
        var st = state;
        st.autoFollow = !st.autoFollow;
        toggleFollowBtn.classList.toggle('on', st.autoFollow);
        toggleFollowBtn.innerText = st.autoFollow ? '跟随:开' : '跟随:关';
      };
    }

    // === Event-driven rAF audio sync loop ===
    var disposed = false;
    var rafId = null;
    var wheelTimer = null;

    function cancelLoop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function shouldRun() {
      return !disposed && !audioPlayer.paused && !document.hidden;
    }

    function updatePlaybackUi(force) {
        var st = state;
        if (force || !audioPlayer.paused) {
          var currentTime = audioPlayer.currentTime;
          var idx = bsFindActiveHelper(st.wordStarts, st.words, currentTime);
          var chunkIdx = st.isChunkMode ? findChunkIndexByTime(currentTime) : -1;
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
    }

    function loop() {
      rafId = null;
      if (!shouldRun()) return;
      updatePlaybackUi();
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (!shouldRun() || rafId !== null) return;
      updatePlaybackUi();
      rafId = requestAnimationFrame(loop);
    }

    function wakeLoop() {
      if (disposed || document.hidden || rafId !== null) return;
      updatePlaybackUi(true);
      rafId = requestAnimationFrame(loop);
    }

    function handleMediaProgress() {
      updatePlaybackUi(true);
    }

    function handleVisibilityChange() {
      if (document.hidden) cancelLoop();
      else startLoop();
    }

    function handleWheel() {
      var st = state;
      st.userScrollSuppress = true;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () {
        wheelTimer = null;
        st.userScrollSuppress = false;
      }, 3000);
      st.suppressTimer = wheelTimer;
    }

    var mediaEvents = ['timeupdate', 'seeked', 'play', 'playing', 'pause', 'ended'];
    var mediaHandlers = [handleMediaProgress, handleMediaProgress, wakeLoop, startLoop, cancelLoop, cancelLoop];
    var eventMedia = null;
    var unsubscribeMediaSource = null;

    function bindEventMedia(nextMedia) {
      if (eventMedia === nextMedia) return;
      if (eventMedia && typeof eventMedia.removeEventListener === 'function') {
        for (var i = 0; i < mediaEvents.length; i++) {
          eventMedia.removeEventListener(mediaEvents[i], mediaHandlers[i]);
        }
      }
      eventMedia = nextMedia || null;
      if (eventMedia && typeof eventMedia.addEventListener === 'function') {
        for (var j = 0; j < mediaEvents.length; j++) {
          eventMedia.addEventListener(mediaEvents[j], mediaHandlers[j]);
        }
      }
      if (shouldRun()) startLoop();
      else cancelLoop();
    }

    var mediaSource = window.__mediaSource;
    if (mediaSource && typeof mediaSource.getActiveMediaElement === 'function') {
      bindEventMedia(mediaSource.getActiveMediaElement(deps.audioPlayer));
      if (typeof mediaSource.subscribe === 'function') {
        unsubscribeMediaSource = mediaSource.subscribe(function () {
          bindEventMedia(mediaSource.getActiveMediaElement(deps.audioPlayer));
        });
      }
    } else {
      bindEventMedia(deps.audioPlayer);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (mainAppArea) mainAppArea.addEventListener('wheel', handleWheel, { passive: true });
    startLoop();

    var controller = {
      dispose: function () {
        if (disposed) return;
        disposed = true;
        cancelLoop();
        if (typeof unsubscribeMediaSource === 'function') unsubscribeMediaSource();
        unsubscribeMediaSource = null;
        bindEventMedia(null);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (mainAppArea) mainAppArea.removeEventListener('wheel', handleWheel);
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = null;
        if (state.suppressTimer) state.suppressTimer = null;
        state.userScrollSuppress = false;
        if (activeController === controller) activeController = null;
      }
    };
    activeController = controller;
    return controller;
  }

  window.__controlsModule = { init: init };
