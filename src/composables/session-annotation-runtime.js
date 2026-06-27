import { renderTranscript, renderChunkMode } from './render-runtime.js';
import {
    emitAnnotationDiagnostics,
    getAnnotationGeneratedResultStore,
    getAnnotationGenerationStorage,
    getAnnotationTargetSource
} from './session-annotation-services.js';
import {
    createSessionAnnotationGeneratedIndexRuntime
} from './session-annotation-generated-index.js';
import {
    buildAnnotationContextArticleText,
    cleanMarkedTextForAnnotationContext,
    getAnnotationTargetSentenceText,
    normalizeAnnotationSentenceValue,
    normalizeAnnotationTextValue,
    resolveAnnotationContextSentence,
    splitAnnotationContextSentenceSpans
} from './session-annotation-text.js';
import {
    createSessionAnnotationMarksRuntime,
    normalizeAnnotationMark as normalizeAnnotationMarkValue
} from './session-annotation-marks.js';
import {
    createSessionAnnotationContextRuntime
} from './session-annotation-context.js';
import {
    createSessionAnnotationLightweightIoRuntime
} from './session-annotation-lightweight-io.js';

export function createSessionAnnotationRuntime(deps = {}) {
    const state = deps.state;
    const namespace = deps.namespace;
    const runtimeDeps = deps.runtimeDeps;
    const windowObject = deps.windowObject;
    const documentObject = deps.documentObject;
    const domRefs = deps.domRefs;
    const globals = deps.globals;

    const generatedIndexRuntime = createSessionAnnotationGeneratedIndexRuntime({
        state,
        namespace,
        getWindow: function () { return windowObject; },
        consoleApi: console,
        getAnnotationGenerationStorage,
        getAnnotationGeneratedResultStore,
        emitAnnotationDiagnostics,
        markCountEl: domRefs.annotationMarkCountEl
    });
    const clearGeneratedAnnotationIndex = generatedIndexRuntime.clearGeneratedAnnotationIndex;
    const getAnnotationGenerationScope = generatedIndexRuntime.getAnnotationGenerationScope;
    const refreshGeneratedAnnotationIndexForCurrentDocument = generatedIndexRuntime.refreshGeneratedAnnotationIndexForCurrentDocument;
    const scheduleGeneratedAnnotationIndexRefresh = generatedIndexRuntime.scheduleGeneratedAnnotationIndexRefresh;
    const syncAnnotationGenerationEntryStatus = generatedIndexRuntime.syncAnnotationGenerationEntryStatus;

    const annotationContextRuntime = createSessionAnnotationContextRuntime({
        state,
        namespace,
        normalizeAnnotationMark: normalizeAnnotationMarkValue,
        normalizeAnnotationTextValue,
        getAnnotationTargetSource
    });
    const buildAnnotationGenerationDocumentContext = annotationContextRuntime.buildAnnotationGenerationDocumentContext;
    const buildAnnotationTargetCollection = annotationContextRuntime.buildAnnotationTargetCollection;

    const annotationMarksRuntime = createSessionAnnotationMarksRuntime({
        state,
        normalizeAnnotationTextValue,
        buildAnnotationGenerationDocumentContext,
        buildAnnotationTargetCollection,
        saveToDB: globals.saveToDB,
        renderTranscript,
        renderChunkMode,
        forceUpdateUI: globals.forceUpdateUI,
        getAudioCurrentTime: function () { return domRefs.audioPlayer ? domRefs.audioPlayer.currentTime : 0; },
        syncAnnotationGenerationEntryStatus
    });
    const buildSyntheticAnnotationTargetFromEncodedId = annotationMarksRuntime.buildSyntheticAnnotationTargetFromEncodedId;
    const normalizeAnnotationMark = annotationMarksRuntime.normalizeAnnotationMark;
    const rebuildMarksFromAnnotationItems = annotationMarksRuntime.rebuildMarksFromAnnotationItems;

    const annotationLightweightIoRuntime = createSessionAnnotationLightweightIoRuntime({
        state,
        windowObject,
        documentObject,
        urlApi: runtimeDeps.urlApi,
        BlobCtor: runtimeDeps.BlobCtor,
        normalizeAnnotationTextValue,
        normalizeAnnotationSentenceValue,
        getAnnotationTargetSentenceText,
        buildSyntheticAnnotationTargetFromEncodedId,
        buildAnnotationTargetCollection,
        buildAnnotationContextArticleText,
        splitAnnotationContextSentenceSpans,
        resolveAnnotationContextSentence,
        cleanMarkedTextForAnnotationContext,
        getAnnotationGenerationStorage,
        getAnnotationGenerationScope,
        refreshGeneratedAnnotationIndexForCurrentDocument,
        rebuildMarksFromAnnotationItems,
        syncAnnotationGenerationEntryStatus,
        showToast: globals.showToast
    });
    annotationLightweightIoRuntime.installAnnotationContextExport();
    if (globals.annotationLightweightModule && typeof globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime === 'function') {
        globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime({
            buildManualLightweightAnnotationTemplate: annotationLightweightIoRuntime.buildManualLightweightAnnotationTemplate,
            exportManualLightweightAnnotations: annotationLightweightIoRuntime.exportManualLightweightAnnotations,
            importManualLightweightAnnotations: annotationLightweightIoRuntime.importManualLightweightAnnotations
        });
    }

    return {
        clearGeneratedAnnotationIndex,
        getAnnotationGenerationScope,
        scheduleGeneratedAnnotationIndexRefresh,
        syncAnnotationGenerationEntryStatus,
        normalizeAnnotationMark,
        emitAnnotationDiagnostics,
        getAnnotationGeneratedResultStore
    };
}
