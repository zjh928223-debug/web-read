function requireAnnotationContextFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation context dependency: ${name}`);
}

export function getAnnotationGenerationBlockText(seg) {
  if (!seg) return '';
  if (typeof seg.text === 'string' && seg.text.trim()) return seg.text.replace(/\s+/g, ' ').trim();
  if (Array.isArray(seg.words)) {
    return seg.words.map(w => String((w && (w.word || w.text)) || '').trim()).filter(Boolean).join(' ');
  }
  return '';
}

export function createSessionAnnotationContextRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};
  const normalizeAnnotationMark = requireAnnotationContextFunction(deps, 'normalizeAnnotationMark');
  const normalizeAnnotationTextValue = requireAnnotationContextFunction(deps, 'normalizeAnnotationTextValue');

  function buildAnnotationGenerationDocumentContext() {
    const segments = Array.isArray(state.segments) ? state.segments : [];
    const chunkItems = Array.isArray(state.chunkItems) ? state.chunkItems : [];
    const words = Array.isArray(state.words) ? state.words : [];
    const markedMap = state.markedMap instanceof Map ? state.markedMap : new Map();
    const transcriptBlocks = segments.map((seg, index) => ({
      type: 'segment',
      index,
      id: String(seg.id || seg.segment_id || index),
      start: Number.isFinite(Number(seg.start)) ? Number(seg.start) : null,
      end: Number.isFinite(Number(seg.end)) ? Number(seg.end) : null,
      text: getAnnotationGenerationBlockText(seg),
      words: Array.isArray(seg.words) ? seg.words : []
    })).filter(block => block.text);
    const chunkBlocks = (state.hasAiChunkData && Array.isArray(state.chunkItems))
      ? chunkItems.map((item, index) => ({
        type: 'chunk',
        index,
        id: String(item.chunkRef || item.segId || index),
        start: Number.isFinite(Number(item.start)) ? Number(item.start) : null,
        end: Number.isFinite(Number(item.end)) ? Number(item.end) : null,
        text: String(item.rawEn || item.en || '').replace(/\s+/g, ' ').trim(),
        words: Array.isArray(item.words) ? item.words : []
      })).filter(block => block.text)
      : [];
    const blocks = chunkBlocks.length ? chunkBlocks : transcriptBlocks;
    const marks = Array.from(markedMap.values())
      .map((mark) => normalizeAnnotationMark(mark))
      .filter(Boolean);
    return {
      documentId: namespace.currentDocId,
      audioKey: state.currentAudioKey,
      sourceMode: chunkBlocks.length ? 'chunk' : 'transcript',
      totalBlocks: blocks.length,
      marks,
      stats: {
        words: words.length,
        segments: segments.length,
        chunks: chunkItems.length,
        marks: marks.length
      },
      blocks
    };
  }

  function buildAnnotationTargetCollection() {
    const targetSource = typeof deps.getAnnotationTargetSource === 'function'
      ? deps.getAnnotationTargetSource()
      : null;
    const context = buildAnnotationGenerationDocumentContext();
    if (!targetSource || typeof targetSource.buildTargetSource !== 'function') {
      return { context, targets: [], byId: new Map() };
    }
    const built = targetSource.buildTargetSource(context);
    const targets = Array.isArray(built && built.targets) ? built.targets : [];
    const byId = new Map();
    targets.forEach((target) => {
      const targetId = normalizeAnnotationTextValue(target && target.id);
      if (!targetId) return;
      byId.set(targetId, target);
    });
    return { context, targets, byId };
  }

  return {
    buildAnnotationGenerationDocumentContext,
    buildAnnotationTargetCollection
  };
}
