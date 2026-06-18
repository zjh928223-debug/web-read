export function initHotkeyState(initial = {}) {
    var state = {
        markKey: initial.markKey || 'm',
        notesKey: initial.notesKey || 'n',
        annotationBubbleKey: initial.annotationBubbleKey || 'b',
        chunkCnKey: initial.chunkCnKey || 'c',
        chunkShadowKey: initial.chunkShadowKey || 's',
        chunkNoteKey: initial.chunkNoteKey || 'x',
        backwardKey: initial.backwardKey || 'ArrowLeft',
        forwardKey: initial.forwardKey || 'ArrowRight'
    };

    function normalize(value, fallback) {
        return value || fallback;
    }

    return {
        get markKey() { return state.markKey; },
        get notesKey() { return state.notesKey; },
        get annotationBubbleKey() { return state.annotationBubbleKey; },
        get chunkCnKey() { return state.chunkCnKey; },
        get chunkShadowKey() { return state.chunkShadowKey; },
        get chunkNoteKey() { return state.chunkNoteKey; },
        get backwardKey() { return state.backwardKey; },
        get forwardKey() { return state.forwardKey; },
        setMarkKey: function (value) { state.markKey = normalize(value, 'm'); return state.markKey; },
        setNotesKey: function (value) { state.notesKey = normalize(value, 'n'); return state.notesKey; },
        setAnnotationBubbleKey: function (value) { state.annotationBubbleKey = normalize(value, 'b'); return state.annotationBubbleKey; },
        setChunkCnKey: function (value) { state.chunkCnKey = normalize(value, 'c'); return state.chunkCnKey; },
        setChunkShadowKey: function (value) { state.chunkShadowKey = normalize(value, 's'); return state.chunkShadowKey; },
        setChunkNoteKey: function (value) { state.chunkNoteKey = normalize(value, 'x'); return state.chunkNoteKey; },
        setBackwardKey: function (value) { state.backwardKey = normalize(value, 'ArrowLeft'); return state.backwardKey; },
        setForwardKey: function (value) { state.forwardKey = normalize(value, 'ArrowRight'); return state.forwardKey; }
    };
}
