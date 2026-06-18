export function initPlaybackRuntimeHelpers(options) {
    var chunkState = options.chunkState;
    var playbackState = options.playbackState;
    var mainAppArea = options.mainAppArea;
    var transcriptContainer = options.transcriptContainer;
    var findChunkIndexByTimeHelper = options.findChunkIndexByTimeHelper;
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

    return {
        findChunkIndexByTime: findChunkIndexByTime,
        swapActiveClass: swapActiveClass,
        followPlaybackTarget: followPlaybackTarget
    };
}
