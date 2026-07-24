(function (global) {
    'use strict';

    const STORAGE_KEY = 'annotationBubbleFrame';
    const MIN_WIDTH = 280;
    const MIN_HEIGHT = 170;
    const MAX_WIDTH = 760;
    const MAX_HEIGHT = 580;
    const SIDE_PANEL_WIDTH_RATIO = 0.72;
    const SIDE_PANEL_HEIGHT_RATIO = 0.82;
    const DEFAULT_FRAME = { left: 56, top: 72, width: 450, height: 320 };
    const EMPTY_MESSAGE = '点击一个已标注单词查看释义';
    const TYPE_ABBREVIATIONS = {
        word: 'W',
        noun: 'N',
        verb: 'V',
        adjective: 'Adj',
        adverb: 'Adv',
        phrase: 'Phrase',
        'phrasal-verb': 'Ph-v',
        'phrasal verb': 'Ph-v',
        collocation: 'Phrase',
        expression: 'Phrase'
    };

    let rootEl = null;
    let bodyEl = null;
    let visible = false;
    let currentAnnotation = null;
    let frame = loadFrame();
    let dragState = null;
    let resizeState = null;

    function isAnnotationDebugEnabled() {
        try {
            if (global.ANNOTATION_DEBUG === true) return true;
            const stored = global.localStorage && global.localStorage.getItem('annotation.debug');
            return stored === '1' || stored === 'true';
        } catch (error) {
            return global.ANNOTATION_DEBUG === true;
        }
    }

    function emitAnnotationDebug(step, payload) {
        if (!isAnnotationDebugEnabled()) return;
        try {
            console.debug(`[annotation-debug] ${step}`, payload || {});
        } catch (error) {}
    }

    function loadFrame() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_FRAME };
            const parsed = JSON.parse(raw);
            const nextFrame = { ...DEFAULT_FRAME, ...parsed };
            if (isLegacySideFrame(nextFrame)) return normalizeFrame(DEFAULT_FRAME);
            return normalizeFrame(nextFrame);
        } catch (error) {
            return { ...DEFAULT_FRAME };
        }
    }

    function persistFrame() {
        try {
            global.localStorage && global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeFrame(frame)));
        } catch (error) {}
    }

    function normalizeFrame(next) {
        const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, global.innerWidth - 24));
        const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, global.innerHeight - 24));
        const width = clampNumber(Number(next.width), MIN_WIDTH, maxWidth);
        const height = clampNumber(Number(next.height), MIN_HEIGHT, maxHeight);
        const left = clampNumber(Number(next.left), 12, Math.max(12, global.innerWidth - width - 12));
        const top = clampNumber(Number(next.top), 12, Math.max(12, global.innerHeight - height - 12));
        return { left, top, width, height };
    }

    function isLegacySideFrame(next) {
        const width = Number(next.width);
        const height = Number(next.height);
        const viewportWidth = Number(global.innerWidth || 0);
        const viewportHeight = Number(global.innerHeight || 0);
        if (viewportWidth > 0 && Number.isFinite(width) && width >= viewportWidth * SIDE_PANEL_WIDTH_RATIO) return true;
        if (viewportHeight > 0 && Number.isFinite(height) && height >= viewportHeight * SIDE_PANEL_HEIGHT_RATIO) return true;
        return false;
    }

    function clampNumber(value, min, max) {
        if (!Number.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    function stringifyField(value) {
        return value == null ? '' : String(value).trim();
    }

    function normalizeAnnotation(annotation) {
        const data = annotation && typeof annotation === 'object' ? annotation : {};
        return {
            markedText: stringifyField(data.markedText),
            boundary: stringifyField(data.boundary),
            type: stringifyField(data.type),
            meaning: stringifyField(data.meaning),
            memoryHint: stringifyField(data.memoryHint)
        };
    }

    function formatTypeAbbreviation(typeValue) {
        const normalized = stringifyField(typeValue).toLowerCase().replace(/\s+/g, ' ');
        if (!normalized) return '';
        if (TYPE_ABBREVIATIONS[normalized]) return TYPE_ABBREVIATIONS[normalized];
        const compact = normalized.replace(/[^a-z0-9-]+/g, '');
        if (!compact) return '';
        if (compact.length <= 4) return compact;
        if (compact.includes('-')) {
            return compact
                .split('-')
                .filter(Boolean)
                .map((part, index) => index === 0 ? part.slice(0, 2) : part.slice(0, 1))
                .join('-');
        }
        return compact.slice(0, 4);
    }

    function ensureMounted() {
        if (rootEl) return;

        rootEl = document.createElement('section');
        rootEl.id = 'annotation-bubble';
        rootEl.className = 'annotation-bubble';
        rootEl.setAttribute('aria-label', '标注释义气泡');
        rootEl.hidden = true;

        const header = document.createElement('div');
        header.className = 'annotation-bubble__header';

        const title = document.createElement('div');
        title.className = 'annotation-bubble__title';
        title.textContent = '标注释义';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'annotation-bubble__close';
        closeBtn.setAttribute('aria-label', '隐藏标注释义');
        closeBtn.textContent = '×';

        bodyEl = document.createElement('div');
        bodyEl.className = 'annotation-bubble__body';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'annotation-bubble__resize';
        resizeHandle.setAttribute('aria-hidden', 'true');

        header.append(title, closeBtn);
        rootEl.append(header, bodyEl, resizeHandle);
        document.body.appendChild(rootEl);

        header.addEventListener('pointerdown', beginDrag);
        resizeHandle.addEventListener('pointerdown', beginResize);
        closeBtn.addEventListener('click', hide);
        global.addEventListener('resize', clampAndApplyFrame);

        applyFrame();
        render();
    }

    function setVisible(nextVisible) {
        visible = !!nextVisible;
        ensureMounted();
        rootEl.hidden = !visible;
        rootEl.classList.toggle('is-visible', visible);
        if (visible) {
            clampAndApplyFrame();
            render();
        }
    }

    function show() {
        setVisible(true);
    }

    function hide() {
        setVisible(false);
    }

    function toggle(forceState) {
        if (typeof forceState === 'boolean') setVisible(forceState);
        else setVisible(!visible);
        return visible;
    }

    function isVisible() {
        return visible;
    }

    function setAnnotation(annotation) {
        currentAnnotation = normalizeAnnotation(annotation);
        emitAnnotationDebug('bubble.set_annotation', {
            hasAnnotation: !!annotation,
            boundary: currentAnnotation && currentAnnotation.boundary || '',
            hasMeaning: !!(currentAnnotation && currentAnnotation.meaning),
            hasMemoryHint: !!(currentAnnotation && currentAnnotation.memoryHint)
        });
        ensureMounted();
        if (visible) render();
    }

    function clearAnnotation() {
        currentAnnotation = null;
        ensureMounted();
        if (visible) render();
    }

    function render() {
        if (!bodyEl) return;
        bodyEl.textContent = '';

        if (!currentAnnotation) {
            const empty = document.createElement('div');
            empty.className = 'annotation-bubble__empty';
            empty.textContent = EMPTY_MESSAGE;
            bodyEl.appendChild(empty);
            return;
        }

        bodyEl.append(
            createBoundaryField(currentAnnotation),
            createField('意思', currentAnnotation.meaning),
            createField('要记', currentAnnotation.memoryHint)
        );
    }

    function createBoundaryField(annotation) {
        const row = document.createElement('div');
        row.className = 'annotation-bubble__field annotation-bubble__field--boundary';

        const labelEl = document.createElement('div');
        labelEl.className = 'annotation-bubble__label';
        labelEl.textContent = '边界：';

        const valueRow = document.createElement('div');
        valueRow.className = 'annotation-bubble__value-row';

        const valueEl = document.createElement('div');
        valueEl.className = 'annotation-bubble__value annotation-bubble__value--boundary';
        valueEl.textContent = annotation.boundary || '—';

        valueRow.appendChild(valueEl);

        const typeBadge = createTypeBadge(annotation.type);
        if (typeBadge) valueRow.appendChild(typeBadge);

        row.append(labelEl, valueRow);
        return row;
    }

    function createTypeBadge(typeValue) {
        const abbreviation = formatTypeAbbreviation(typeValue);
        if (!abbreviation) return null;
        const badge = document.createElement('span');
        badge.className = 'annotation-bubble__type-badge';
        badge.textContent = abbreviation;
        badge.title = stringifyField(typeValue);
        return badge;
    }

    function createField(label, value) {
        const row = document.createElement('div');
        row.className = 'annotation-bubble__field';

        const labelEl = document.createElement('div');
        labelEl.className = 'annotation-bubble__label';
        labelEl.textContent = `${label}：`;

        const valueEl = document.createElement('div');
        valueEl.className = 'annotation-bubble__value';
        valueEl.textContent = value || '—';

        row.append(labelEl, valueEl);
        return row;
    }

    function beginDrag(event) {
        if (event.target && event.target.closest && event.target.closest('button')) return;
        ensureMounted();
        rootEl.setPointerCapture(event.pointerId);
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: frame.left,
            top: frame.top
        };
        rootEl.classList.add('is-moving');
        rootEl.addEventListener('pointermove', dragMove);
        rootEl.addEventListener('pointerup', endDragResize);
        rootEl.addEventListener('pointercancel', endDragResize);
        event.preventDefault();
    }

    function dragMove(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        frame.left = dragState.left + event.clientX - dragState.startX;
        frame.top = dragState.top + event.clientY - dragState.startY;
        frame = normalizeFrame(frame);
        applyFrame();
    }

    function beginResize(event) {
        ensureMounted();
        rootEl.setPointerCapture(event.pointerId);
        resizeState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: frame.width,
            height: frame.height
        };
        rootEl.classList.add('is-moving');
        rootEl.addEventListener('pointermove', resizeMove);
        rootEl.addEventListener('pointerup', endDragResize);
        rootEl.addEventListener('pointercancel', endDragResize);
        event.preventDefault();
    }

    function resizeMove(event) {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        frame.width = resizeState.width + event.clientX - resizeState.startX;
        frame.height = resizeState.height + event.clientY - resizeState.startY;
        frame = normalizeFrame(frame);
        applyFrame();
    }

    function endDragResize(event) {
        if (dragState && event.pointerId !== dragState.pointerId) return;
        if (resizeState && event.pointerId !== resizeState.pointerId) return;
        dragState = null;
        resizeState = null;
        rootEl.classList.remove('is-moving');
        rootEl.removeEventListener('pointermove', dragMove);
        rootEl.removeEventListener('pointermove', resizeMove);
        rootEl.removeEventListener('pointerup', endDragResize);
        rootEl.removeEventListener('pointercancel', endDragResize);
        persistFrame();
    }

    function clampAndApplyFrame() {
        frame = normalizeFrame(frame);
        applyFrame();
        persistFrame();
    }

    function applyFrame() {
        if (!rootEl) return;
        rootEl.style.left = `${frame.left}px`;
        rootEl.style.top = `${frame.top}px`;
        rootEl.style.width = `${frame.width}px`;
        rootEl.style.height = `${frame.height}px`;
    }

    function init() {
        ensureMounted();
        return api;
    }

    const api = {
        init,
        show,
        hide,
        toggle,
        isVisible,
        setAnnotation,
        clearAnnotation
    };

    global.AnnotationBubble = api;
})(window);

export function getAnnotationBubbleApi() {
    return window.AnnotationBubble || null;
}

export default window.AnnotationBubble;
