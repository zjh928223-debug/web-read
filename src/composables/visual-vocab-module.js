export function initVisualVocab(deps = {}) {
    var globalVocab = [];
    var vocabMatchMap = new Map();
    var visualFileInput = deps.visualFileInput || null;
    var validateVisualData = deps.validateVisualData;
    var buildVocabMatchMap = deps.buildVocabMatchMap;
    var hasTranscriptData = typeof deps.hasTranscriptData === 'function' ? deps.hasTranscriptData : null;
    var getWords = typeof deps.getWords === 'function' ? deps.getWords : function () { return []; };
    var saveToDB = deps.saveToDB;
    var getFirstFileFromEvent = deps.getFirstFileFromEvent;
    var readFileAsText = deps.readFileAsText;
    var markFileLoaded = deps.markFileLoaded;
    var lblVisual = deps.lblVisual || null;
    var showToast = deps.showToast;
    var showError = deps.showError;
    var restoreReaderFocus = deps.restoreReaderFocus;
    var bridgeToPinia = deps.bridgeToPinia;

    function getVisualList(data) {
        if (data && Array.isArray(data.vocab_list)) return data.vocab_list;
        if (Array.isArray(data)) return data;
        return [];
    }

    function replaceGlobalVocab(items) {
        globalVocab.length = 0;
        if (Array.isArray(items)) {
            items.forEach(function (item) {
                globalVocab.push(item);
            });
        }
    }

    function replaceVocabMatchMap(nextMap) {
        vocabMatchMap.clear();
        if (nextMap && typeof nextMap.forEach === 'function') {
            nextMap.forEach(function (value, key) {
                vocabMatchMap.set(key, value);
            });
        }
    }

    function rebuildVocabMatching() {
        vocabMatchMap.clear();
        if (!globalVocab.length) return vocabMatchMap;
        if (hasTranscriptData && !hasTranscriptData()) return vocabMatchMap;
        var words = getWords();
        if (!Array.isArray(words) || !words.length) return vocabMatchMap;
        var nextMap = typeof buildVocabMatchMap === 'function'
            ? buildVocabMatchMap(words, globalVocab)
            : new Map();
        replaceVocabMatchMap(nextMap);
        if (typeof bridgeToPinia === 'function') bridgeToPinia();
        return vocabMatchMap;
    }

    function applyVisualData(data) {
        replaceGlobalVocab(getVisualList(data));
        rebuildVocabMatching();
        return globalVocab;
    }

    function processVisual(data) {
        var parsed = typeof validateVisualData === 'function' ? validateVisualData(data) : data;
        return applyVisualData(parsed);
    }

    if (visualFileInput && typeof visualFileInput.addEventListener === 'function') {
        visualFileInput.addEventListener('change', function (event) {
            if (typeof getFirstFileFromEvent !== 'function' || typeof readFileAsText !== 'function') return;
            var file = getFirstFileFromEvent(event);
            if (!file) return;
            readFileAsText(file, function (rawText) {
                try {
                    var data = typeof validateVisualData === 'function'
                        ? validateVisualData(JSON.parse(rawText))
                        : JSON.parse(rawText);
                    if (typeof saveToDB === 'function') saveToDB('visual', data);
                    applyVisualData(data);
                    if (typeof markFileLoaded === 'function') markFileLoaded(lblVisual);
                    if (typeof showToast === 'function') showToast('Visual data loaded', 'success');
                } catch (error) {
                    if (typeof showError === 'function') {
                        showError('VISUAL_PARSE', error && error.message ? error.message : 'Invalid visual JSON');
                    }
                } finally {
                    if (event && event.target) event.target.value = '';
                    if (typeof restoreReaderFocus === 'function') restoreReaderFocus();
                }
            });
        });
    }

    if (typeof window !== 'undefined') {
        window.processVisual = processVisual;
    }

    return {
        globalVocab,
        vocabMatchMap,
        processVisual,
        rebuildVocabMatching,
        setGlobalVocab: function (items) {
            replaceGlobalVocab(items);
            return globalVocab;
        },
        setVocabMatchMap: function (nextMap) {
            replaceVocabMatchMap(nextMap);
            return vocabMatchMap;
        }
    };
}
