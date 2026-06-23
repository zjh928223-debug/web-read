import { renderTranscript } from './render-runtime.js';
import {
    createSessionStartupCleanupRuntime
} from './session-startup-cleanup.js';
import {
    createSessionRestoreRuntime
} from './session-restore-runtime.js';
import {
    restoreSessionUiSettings
} from './session-ui-settings-restore.js';
import {
    startSessionRuntime
} from './session-startup-runtime.js';

export function startSessionLifecycleRuntime(deps = {}) {
    const state = deps.state;
    const namespace = deps.namespace;
    const runtimeDeps = deps.runtimeDeps;
    const documentObject = deps.documentObject;
    const windowObject = deps.windowObject;
    const domRefs = deps.domRefs;
    const globals = deps.globals;
    const annotationRuntime = deps.annotationRuntime;

    const startupCleanupRuntime = createSessionStartupCleanupRuntime({
        state,
        namespace,
        localStorageApi: runtimeDeps.localStorageApi,
        documentObject,
        deleteFromDB: globals.deleteFromDB,
        emitAnnotationDiagnostics: annotationRuntime.emitAnnotationDiagnostics,
        getAnnotationGenerationScope: annotationRuntime.getAnnotationGenerationScope
    });

    const sessionRestoreRuntime = createSessionRestoreRuntime({
        state,
        namespace,
        urlApi: runtimeDeps.urlApi,
        audioPlayer: domRefs.audioPlayer,
        lblAudio: domRefs.lblAudio,
        lblTranscript: domRefs.lblTranscript,
        lblVisual: domRefs.lblVisual,
        loadFromDB: globals.loadFromDB,
        markFileLoaded: globals.markFileLoaded,
        applyCurrentAudioMeta: globals.applyCurrentAudioMeta,
        loadChunkNotesForCurrentAudio: globals.loadChunkNotesForCurrentAudio,
        loadSentenceNotesForCurrentAudio: globals.loadSentenceNotesForCurrentAudio,
        processTranscript: globals.processTranscript,
        buildCurrentSentenceDocId: globals.buildCurrentSentenceDocId,
        switchSentenceNotesDoc: globals.switchSentenceNotesDoc,
        scheduleGeneratedAnnotationIndexRefresh: annotationRuntime.scheduleGeneratedAnnotationIndexRefresh,
        processVisual: globals.processVisual,
        processChunkData: globals.processChunkData,
        normalizeAnnotationMark: annotationRuntime.normalizeAnnotationMark,
        renderTranscript,
        syncAnnotationGenerationEntryStatus: annotationRuntime.syncAnnotationGenerationEntryStatus,
        bridgeToPinia: globals.bridgeToPinia,
        getAnnotationGeneratedResultStore: annotationRuntime.getAnnotationGeneratedResultStore,
        getAnnotationGenerationScope: annotationRuntime.getAnnotationGenerationScope,
        emitAnnotationDiagnostics: annotationRuntime.emitAnnotationDiagnostics
    });

    startSessionRuntime({
        state,
        namespace,
        localStorageApi: runtimeDeps.localStorageApi,
        documentObject,
        windowObject,
        transcriptContainer: domRefs.transcriptContainer,
        initDB: globals.initDB,
        clearPersistedReaderContentOnStartup: startupCleanupRuntime.clearPersistedReaderContentOnStartup,
        adjustChunkNoteArrowSizeByGap: globals.adjustChunkNoteArrowSizeByGap,
        setChunkNoteVisible: globals.setChunkNoteVisible,
        updateChunkCnHoldBtn: globals.updateChunkCnHoldBtn,
        restoreSession: sessionRestoreRuntime.restoreSession
    });

    restoreSessionUiSettings({
        state,
        localStorageApi: runtimeDeps.localStorageApi,
        documentObject,
        windowObject,
        hotkeyInput: domRefs.hotkeyInput,
        hotkeyAnnotationBubbleInput: domRefs.hotkeyAnnotationBubbleInput,
        hotkeyChunkCnInput: domRefs.hotkeyChunkCnInput,
        hotkeyChunkShadowInput: domRefs.hotkeyChunkShadowInput,
        hotkeyBackwardInput: domRefs.hotkeyBackwardInput,
        hotkeyForwardInput: domRefs.hotkeyForwardInput,
        highlightColorInput: domRefs.highlightColorInput,
        sentenceColorInput: domRefs.sentenceColorInput
    });

    return {
        clearPersistedChunkSession: startupCleanupRuntime.clearPersistedChunkSession,
        clearPersistedReaderContentOnStartup: startupCleanupRuntime.clearPersistedReaderContentOnStartup,
        restoreSession: sessionRestoreRuntime.restoreSession
    };
}
