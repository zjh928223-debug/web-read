import { applyArticleSrsSettlement } from './article-srs-settlement.js';
import { createVocabularyService } from './vocabulary-service.js';

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || '',
    message: error?.message || '后台加入 SRS 失败',
    details: error?.details || null,
  };
}

self.addEventListener('message', async (event) => {
  const request = event?.data || {};
  if (request.type !== 'apply-article-srs-settlement') return;
  try {
    const vocabularyService = createVocabularyService({ acquisitionEnabled: true });
    const result = await applyArticleSrsSettlement({
      vocabularyService,
      candidates: Array.isArray(request.candidates) ? request.candidates : [],
      mode: request.mode,
      transactionChunkSize: 20,
    });
    self.postMessage({ requestId: request.requestId, ok: true, result });
  } catch (error) {
    self.postMessage({ requestId: request.requestId, ok: false, error: serializeError(error) });
  }
});
