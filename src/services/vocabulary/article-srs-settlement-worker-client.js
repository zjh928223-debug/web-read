let workerRequestSequence = 0;

function restoreWorkerError(value = {}) {
  const error = new Error(value.message || '后台加入 SRS 失败');
  error.name = value.name || 'Error';
  if (value.code) error.code = value.code;
  if (value.details !== undefined) error.details = value.details;
  return error;
}

export function canRunArticleSrsSettlementInWorker(windowObject = globalThis) {
  return windowObject === globalThis && typeof Worker === 'function';
}

export function runArticleSrsSettlementInWorker(options = {}) {
  const windowObject = options.windowObject || globalThis;
  if (!canRunArticleSrsSettlementInWorker(windowObject)) {
    return Promise.reject(new Error('Article SRS settlement worker is unavailable'));
  }
  const requestId = `article-srs-worker-${Date.now()}-${++workerRequestSequence}`;
  const worker = new Worker(
    new URL('./article-srs-settlement-worker.js', import.meta.url),
    { type: 'module', name: 'article-srs-settlement' },
  );
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    const onMessage = (event) => {
      const response = event?.data || {};
      if (response.requestId !== requestId) return;
      cleanup();
      if (response.ok) resolve(response.result);
      else reject(restoreWorkerError(response.error));
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event?.message || '后台加入 SRS 线程异常退出'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({
      type: 'apply-article-srs-settlement',
      requestId,
      candidates: Array.isArray(options.candidates) ? options.candidates : [],
      mode: options.mode,
    });
  });
}
