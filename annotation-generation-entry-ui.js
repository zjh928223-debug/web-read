(function (global) {
    'use strict';

    const STATUS_META = {
        idle: { label: '待命', message: '生成入口已就绪。' },
        empty: { label: '无内容', message: '请先导入字幕或切分数据。' },
        'not-connected': { label: '未接入', message: 'AnnotationGenerationController 尚未安装。' },
        unconfigured: { label: '未配置', message: '请先完成 annotation API 配置。' },
        ready: { label: '可开始', message: '已准备开始全文注释生成。' },
        'up-to-date': { label: '已最新', message: '当前标注目标已全部生成，本次未发 provider request。' },
        'no-targets': { label: '无目标', message: '当前文档没有可生成的标注目标。' },
        running: { label: '运行中', message: '正在按顺序执行本轮请求。' },
        'waiting-next-block': { label: '冷却中', message: '正在等待下一次允许的请求时间。' },
        stopping: { label: '停止中', message: '已请求停止，正在等待当前请求结束。' },
        stopped: { label: '已停止', message: '本轮生成已停止。' },
        complete: { label: '已完成', message: '本轮生成已完成。' },
        imported: { label: '已导入', message: '全文注释已导入。' },
        incomplete: { label: '仍有剩余', message: '本轮结束后仍有目标未补齐，可手工再次运行。' },
        failed: { label: '失败', message: '本轮生成失败，请稍后重试。' },
        retryable: { label: '可重试', message: '上次生成未完成，可以重新开始新一轮。' }
    };

    let buttonEl = null;
    let rootEl = null;
    let onStart = null;
    let onStop = null;
    let idleButtonText = '';
    let status = normalizeStatus({ state: 'idle' });

    function init(options = {}) {
        buttonEl = options.buttonEl || buttonEl;
        rootEl = options.rootEl || rootEl;
        onStart = typeof options.onStart === 'function' ? options.onStart : onStart;
        onStop = typeof options.onStop === 'function' ? options.onStop : onStop;
        if (buttonEl && !idleButtonText) idleButtonText = String(buttonEl.textContent || '').trim();
        if (buttonEl && buttonEl.dataset.annotationGenerationBound !== '1') {
            buttonEl.dataset.annotationGenerationBound = '1';
            buttonEl.addEventListener('click', handleButtonClick);
        }
        render();
        return api;
    }

    function handleButtonClick() {
        if (isBusyState(status.state)) {
            if (typeof onStop === 'function') {
                try {
                    const result = onStop(api);
                    if (result && typeof result.then === 'function') result.catch(() => {});
                } catch (error) {}
                setStatus({
                    state: 'stopping',
                    message: '已请求停止，正在等待当前请求结束。'
                });
            }
            return;
        }
        if (typeof onStart !== 'function') {
            setStatus({ state: 'not-connected' });
            return;
        }
        try {
            const result = onStart(api);
            if (result && typeof result.then === 'function') {
                result.catch((error) => {
                    setStatus({
                        state: 'retryable',
                        message: error && error.message ? error.message : '生成启动失败，可以重新开始。'
                    });
                });
            }
        } catch (error) {
            setStatus({
                state: 'retryable',
                message: error && error.message ? error.message : '生成启动失败，可以重新开始。'
            });
        }
    }

    function setStatus(nextStatus = {}) {
        const merged = { ...status, ...nextStatus };
        if (!Object.prototype.hasOwnProperty.call(nextStatus, 'progress')) delete merged.progress;
        status = normalizeStatus(merged);
        render();
        return status;
    }

    function getStatus() {
        return { ...status };
    }

    function normalizeStatus(input) {
        const requestedState = String(input.state || 'idle');
        const state = STATUS_META[requestedState] ? requestedState : 'idle';
        const meta = STATUS_META[state];
        const total = sanitizeCount(input.total);
        const completed = sanitizeCount(input.completed);
        const failed = sanitizeCount(input.failed);
        const requestBudget = sanitizeCount(input.requestBudget);
        const requestCount = sanitizeCount(input.requestCount);
        const progress = Number.isFinite(Number(input.progress))
            ? clampNumber(Number(input.progress), 0, 1)
            : deriveProgress(state, completed, total);
        const message = String(input.message || meta.message);
        return {
            state,
            label: meta.label,
            message,
            total,
            completed,
            failed,
            requestBudget,
            requestCount,
            nextAllowedStartAt: String(input.nextAllowedStartAt || ''),
            stopRequested: !!input.stopRequested,
            progress
        };
    }

    function sanitizeCount(value) {
        const next = Number(value);
        return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
    }

    function clampNumber(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function deriveProgress(state, completed, total) {
        if (state === 'complete' || state === 'up-to-date') return 1;
        if (state === 'failed' || state === 'retryable' || state === 'no-targets') return 0;
        if (total <= 0) return 0;
        return clampNumber(completed / total, 0, 1);
    }

    function isBusyState(state) {
        return state === 'running' || state === 'waiting-next-block' || state === 'stopping';
    }

    function render() {
        if (buttonEl) {
            const busy = isBusyState(status.state);
            buttonEl.disabled = status.state === 'stopping' && typeof onStop !== 'function';
            buttonEl.setAttribute('aria-busy', busy ? 'true' : 'false');
            buttonEl.textContent = busy ? '停止生成' : (idleButtonText || '生成全文注释');
        }
        if (!rootEl) return;
        rootEl.dataset.state = status.state;
        const showProgress = status.total > 0;
        const showFailed = Number(status.failed) > 0;
        const showRequests = isBusyState(status.state) || Number(status.requestCount) > 0 || Number(status.requestBudget) > 0;
        rootEl.innerHTML = `
            <span class="annotation-generation-status__label">${escapeHtml(status.label)}</span>
            ${showProgress ? `<span class="annotation-generation-status__progress">${status.completed}/${status.total}</span>` : ''}
            ${showFailed ? `<span class="annotation-generation-status__failed">失败 ${status.failed}</span>` : ''}
            ${showRequests ? `<span class="annotation-generation-status__requests">${status.requestCount}/${status.requestBudget}</span>` : ''}
            <span class="annotation-generation-status__message">${escapeHtml(status.message)}</span>
            ${showProgress ? `<span class="annotation-generation-status__bar" aria-hidden="true">
                <span class="annotation-generation-status__bar-fill" style="width:${Math.round(status.progress * 100)}%"></span>
            </span>` : ''}
        `;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    const api = {
        init,
        setStatus,
        getStatus,
        normalizeStatus,
        render
    };

    global.AnnotationGenerationEntryUI = api;
})(window);
