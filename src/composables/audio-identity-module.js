export function initAudioIdentity(deps = {}) {
    var currentAudioMeta = null;
    var currentAudioKey = 'default-audio';
    var buildAudioKey = deps.buildAudioKey;
    var buildCurrentAudioMetaState = deps.buildCurrentAudioMetaState;
    var getCurrentAudioFilenameBaseHelper = deps.getCurrentAudioFilenameBase;
    var getChunkNotesStorageKeyHelper = deps.getChunkNotesStorageKey;
    var getChunkNoteDraftStorageKeyHelper = deps.getChunkNoteDraftStorageKey;
    var getSentenceNotesStorageKeyHelper = deps.getSentenceNotesStorageKey;
    var getLegacySentenceNotesStorageKeyHelper = deps.getLegacySentenceNotesStorageKey;
    var buildCurrentSentenceDocIdHelper = deps.buildCurrentSentenceDocId;
    var getSegments = typeof deps.getSegments === 'function' ? deps.getSegments : function () { return []; };

    function setCurrentAudioMeta(value) {
        currentAudioMeta = value || null;
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

    function getChunkNotesStorageKey() {
        return typeof getChunkNotesStorageKeyHelper === 'function'
            ? getChunkNotesStorageKeyHelper(currentAudioKey)
            : 'chunkNotes';
    }

    function getChunkNoteDraftStorageKey() {
        return typeof getChunkNoteDraftStorageKeyHelper === 'function'
            ? getChunkNoteDraftStorageKeyHelper(currentAudioKey)
            : 'chunkNoteDraft';
    }

    function getSentenceNotesStorageKey() {
        return typeof getSentenceNotesStorageKeyHelper === 'function'
            ? getSentenceNotesStorageKeyHelper()
            : 'sentenceNotes';
    }

    function getLegacySentenceNotesStorageKey(audioKey = currentAudioKey) {
        return typeof getLegacySentenceNotesStorageKeyHelper === 'function'
            ? getLegacySentenceNotesStorageKeyHelper(audioKey)
            : 'sentenceNotes';
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
        getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey,
        getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId
    };
}
