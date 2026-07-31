export const ECDICT_ENDPOINT_PATH = '/api/dev/dictionary/ecdict';

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

function failedLookup(query, errorCode = 'ECDICT_QUERY_FAILED') {
  return {
    available: false,
    errorCode,
    query,
    normalizedQuery: '',
    matchedBy: 'none',
    directMatch: null,
    normalizedCandidates: [],
    lemmaCandidates: [],
  };
}

export function createEcdictRequestHandler({
  serviceFactory,
  maxQueryLength = 128,
} = {}) {
  if (typeof serviceFactory !== 'function') {
    throw new TypeError('ECDICT endpoint requires a service factory.');
  }
  let servicePromise = null;
  const getService = () => {
    servicePromise ??= Promise.resolve().then(serviceFactory);
    return servicePromise;
  };

  const handler = async (request, response, next) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname !== ECDICT_ENDPOINT_PATH) {
      next();
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { errorCode: 'ECDICT_METHOD_NOT_ALLOWED' });
      return;
    }
    const query = url.searchParams.get('q') ?? '';
    if (query.length > maxQueryLength) {
      sendJson(response, 400, { errorCode: 'ECDICT_QUERY_TOO_LONG' });
      return;
    }
    try {
      const service = await getService();
      sendJson(response, 200, await service.lookup(query));
    } catch {
      sendJson(response, 200, failedLookup(query));
    }
  };

  handler.close = async () => {
    if (!servicePromise) return;
    try {
      const service = await servicePromise;
      service?.close?.();
    } catch {
      // A failed lazy load has no service resource to release.
    } finally {
      servicePromise = null;
    }
  };
  return handler;
}

export function createEcdictVitePlugin({
  enabled = false,
  databasePath,
  serviceLoader = () => {
    const moduleName = ['ecdict', 'service.mjs'].join('-');
    return import(`../application/${moduleName}`);
  },
} = {}) {
  function configure(server) {
    if (!enabled) return;
    const handler = createEcdictRequestHandler({
      async serviceFactory() {
        const module = await serviceLoader();
        return module.createEcdictService({ enabled: true, databasePath });
      },
    });
    server.middlewares.use(handler);
    server.httpServer?.once('close', () => {
      handler.close().catch(() => {});
    });
  }

  return {
    name: 'read-web-ecdict-local-endpoint',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
