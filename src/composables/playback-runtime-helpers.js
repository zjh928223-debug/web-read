export function initPlaybackRuntimeHelpers(options) {
    var chunkState = options.chunkState;
    var transcriptState = options.transcriptState;
    var playbackState = options.playbackState;
    var audioPlayer = options.audioPlayer;
    var mainAppArea = options.mainAppArea;
    var transcriptContainer = options.transcriptContainer;
    var findChunkIndexByTimeHelper = options.findChunkIndexByTimeHelper;
    var getCurrentSegmentIndexHelper = options.getCurrentSegmentIndexHelper;
    var getForceUpdateUI = typeof options.getForceUpdateUI === 'function' ? options.getForceUpdateUI : function () { return null; };
    var getNow = typeof options.getNow === 'function' ? options.getNow : function () { return Date.now(); };
    var getWindow = typeof options.getWindow === 'function' ? options.getWindow : function () { return window; };

    function findChunkIndexByTime(t) {
        return findChunkIndexByTimeHelper(chunkState.chunkItems, t);
    }

    function swapActiveClass(nextEl, prevEl, className) {
        if (prevEl && prevEl !== nextEl) prevEl.classList.remove(className);
        if (nextEl && nextEl !== prevEl) nextEl.classList.add(className);
        return nextEl || null;
    }

    function followPlaybackTarget(el) {
        if (!el || !playbackState.autoFollow || playbackState.userScrollSuppress) return;
        var container = mainAppArea || transcriptContainer;
        if (!container || typeof container.getBoundingClientRect !== 'function') {
            el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            return;
        }
        var containerRect = container.getBoundingClientRect();
        var elRect = el.getBoundingClientRect();
        var viewportHeight = Math.max(1, containerRect.height || container.clientHeight || getWindow().innerHeight || 1);
        var topGuard = Math.max(24, Math.min(96, viewportHeight * 0.08));
        var bottomTrigger = Math.max(96, Math.min(220, viewportHeight * 0.18));
        var safeTop = containerRect.top + topGuard;
        var safeBottom = containerRect.bottom - bottomTrigger;
        var needsPageForward = elRect.bottom > safeBottom;
        var needsPageBack = elRect.top < safeTop;
        if (!needsPageForward && !needsPageBack) return;
        var offsetTop = elRect.top - containerRect.top + container.scrollTop;
        var targetTop = offsetTop - topGuard;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    }

    function forceUpdateAt(time) {
        var forceUpdateUI = getForceUpdateUI();
        if (typeof forceUpdateUI === 'function') forceUpdateUI(time);
    }

    function jumpPrevSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(
            transcriptState.segments,
            transcriptState.words,
            transcriptState.wordStarts,
            cur
        );
        var targetTime = 0;
        if (sIdx !== -1) {
            var now = getNow();
            if (playbackState.lastSentencePrevTapSegIndex === sIdx && (now - playbackState.lastSentencePrevTapAt) <= 600) {
                targetTime = sIdx > 0 ? transcriptState.segments[sIdx - 1].start : transcriptState.segments[sIdx].start;
                playbackState.lastSentencePrevTapSegIndex = -1;
                playbackState.lastSentencePrevTapAt = 0;
            } else {
                targetTime = transcriptState.segments[sIdx].start;
                playbackState.lastSentencePrevTapSegIndex = sIdx;
                playbackState.lastSentencePrevTapAt = now;
            }
        } else {
            playbackState.lastSentencePrevTapSegIndex = -1;
            playbackState.lastSentencePrevTapAt = 0;
        }
        audioPlayer.currentTime = targetTime;
        forceUpdateAt(targetTime);
    }

    function jumpNextSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(
            transcriptState.segments,
            transcriptState.words,
            transcriptState.wordStarts,
            cur
        );
        var next = (sIdx >= 0 && sIdx < transcriptState.segments.length - 1) ? transcriptState.segments[sIdx + 1] : null;
        playbackState.lastSentencePrevTapSegIndex = -1;
        playbackState.lastSentencePrevTapAt = 0;
        if (next && Number.isFinite(next.start)) {
            audioPlayer.currentTime = next.start;
            forceUpdateAt(next.start);
        }
    }

    return {
        findChunkIndexByTime: findChunkIndexByTime,
        swapActiveClass: swapActiveClass,
        followPlaybackTarget: followPlaybackTarget,
        jumpPrevSentence: jumpPrevSentence,
        jumpNextSentence: jumpNextSentence
    };
}
