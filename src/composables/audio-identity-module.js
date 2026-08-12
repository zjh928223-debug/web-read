export function initAudioIdentity(deps = {}) {
    var currentAudioMeta = null;
    var currentAudioKey = 'default-audio';
    var buildAudioKey = deps.buildAudioKey;
    var buildCurrentAudioMetaState = deps.buildCurrentAudioMetaState;
    var getCurrentAudioFilenameBaseHelper = deps.getCurrentAudioFilenameBase;
    var buildCurrentSentenceDocIdHelper = deps.buildCurrentSentenceDocId;
    var getSegments = typeof deps.getSegments === 'function' ? deps.getSegments : function () { return []; };
    var onCurrentAudioMetaChange = typeof deps.onCurrentAudioMetaChange === 'function'
        ? deps.onCurrentAudioMetaChange
        : function () {};

    function setCurrentAudioMeta(value) {
        currentAudioMeta = value || null;
        onCurrentAudioMetaChange(currentAudioMeta);
        return currentAudioMeta;
    }

    function setCurrentAudioKey(value) {
        currentAudioKey = value || 'default-audio';
        return currentAudioKey;
    }

    function applyCurrentAudioMeta(meta) {
        var nextAudioState = typeof buildCurrentAudioMetaState === 'function'
            ? buildCurrentAudioMetaState(meta, buildAudioKey)
            : {
                currentAudioMeta: meta || null,
                currentAudioKey: typeof buildAudioKey === 'function' ? buildAudioKey(meta) : 'default-audio'
            };
        setCurrentAudioMeta(nextAudioState.currentAudioMeta);
        setCurrentAudioKey(nextAudioState.currentAudioKey);
        return nextAudioState;
    }

    function getCurrentAudioFilenameBase(fallback = 'audio') {
        if (typeof getCurrentAudioFilenameBaseHelper === 'function') {
            return getCurrentAudioFilenameBaseHelper(currentAudioMeta, fallback);
        }
        return fallback;
    }

    function buildCurrentSentenceDocId(transcriptSource = null) {
        return typeof buildCurrentSentenceDocIdHelper === 'function'
            ? buildCurrentSentenceDocIdHelper(transcriptSource, currentAudioKey, getSegments())
            : currentAudioKey;
    }

    return {
        get currentAudioMeta() { return currentAudioMeta; },
        get currentAudioKey() { return currentAudioKey; },
        setCurrentAudioMeta,
        setCurrentAudioKey,
        applyCurrentAudioMeta,
        getCurrentAudioFilenameBase,
        buildCurrentSentenceDocId
    };
}
