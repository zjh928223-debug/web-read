import { bindAcquisitionRepositoryToTransaction } from './vocabulary-acquisition-repository.js';
import { bindContextEvidenceRepositoryToTransaction } from './vocabulary-context-evidence.js';
import { bindLearningEventRepositoryToTransaction } from './vocabulary-learning-events.js';

export const VOCABULARY_LEARNING_CONTRACT_VERSION = 'vocabulary-learning-contracts.v1';
export const VOCABULARY_REVIEW_ROW_ID = 'vocabulary.review.store.v2';
export const VOCABULARY_COMMAND_RECEIPT_PREFIX = 'vocabulary.learning-command-receipt.v1:';

const REVIEW_STORE_SCHEMA = 'review-store.v2';
const REVIEW_STATE_SCHEMA = 'review-state.v2';
const RECEIPT_SCHEMA = 'command-receipt.v1';
const HEX64 = /^[a-f0-9]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVENT_PARTITION = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const REVIEW_STATES = new Set(['new', 'learning', 'review', 'relearning']);
const rowPortMetadata = new WeakMap();
let transactionSequence = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'VocabularyLearningContractError';
  error.code = code;
  error.details = clone(details);
  return error;
}

function fail(code, message, details = {}) {
  throw contractError(code, message, details);
}

function normalizeThrown(error, operation = 'unit_of_work') {
  if (error?.name === 'VocabularyLearningContractError'
    || error?.name === 'ContractError') {
    return error;
  }
  return contractError('TRANSACTION_ABORTED', 'Vocabulary learning transaction aborted', {
    operation,
  });
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a non-empty ID', { field });
  }
  return value;
}

function utcTimestamp(value, field) {
  if (typeof value !== 'string'
    || !UTC_TIMESTAMP.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', 'Expected a UTC timestamp', { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a non-negative integer', { field });
  }
  return value;
}

function finiteNonNegative(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a finite non-negative number', { field });
  }
  return value;
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left].map((character) => character.codePointAt(0));
  const rightPoints = [...right].map((character) => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('INVALID_FIELD_TYPE', 'canonical_json.v1 rejects invalid JSON value', {
        contract: 'canonical_json.v1',
      });
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  fail('INVALID_FIELD_TYPE', 'canonical_json.v1 rejects invalid JSON value', {
    contract: 'canonical_json.v1',
  });
}

// Synchronous SHA-256 keeps a browser IndexedDB transaction active while the receipt is built.
export function sha256Utf8(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const s0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const s1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + upper + choice + constants[index] + words[index]) >>> 0;
      const lower = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (lower + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash = hash.map((value, index) => (
      value + [a, b, c, d, e, f, g, h][index]
    ) >>> 0);
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function fingerprintVocabularyLearningCommand(commandType, payload) {
  requiredId(commandType, 'command_type');
  return sha256Utf8(canonicalJson({
    command_type: commandType,
    contract_version: VOCABULARY_LEARNING_CONTRACT_VERSION,
    payload,
  }));
}

function validateFileRow(row, rowId) {
  if (!isPlainObject(row)
    || row.id !== rowId
    || !Object.prototype.hasOwnProperty.call(row, 'content')
    || typeof row.timestamp !== 'string') {
    fail('TRANSACTION_ABORTED', 'Invalid FileRow', { row_id: rowId });
  }
  utcTimestamp(row.timestamp, 'row.timestamp');
  return clone(row);
}

export function createVocabularyLearningTransactionRowPort(transaction, transaction_id) {
  requiredId(transaction_id, 'transaction_id');
  if (!transaction || typeof transaction.objectStore !== 'function' || typeof transaction.abort !== 'function') {
    fail('INVALID_FIELD_TYPE', 'Expected an IDBTransaction', { field: 'transaction' });
  }
  let store;
  try {
    store = transaction.objectStore('files');
  } catch {
    fail('TRANSACTION_ABORTED', 'The files object store is unavailable', {
      operation: 'create_row_port',
    });
  }
  const touchedRowIds = new Set();
  const eventIds = new Set();
  const request = (idbRequest, operation) => new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(contractError(
      'TRANSACTION_ABORTED',
      'IndexedDB request failed',
      { operation },
    ));
  });
  const port = {
    transaction_id,
    async getRow(row_id) {
      requiredId(row_id, 'row_id');
      touchedRowIds.add(row_id);
      const row = await request(store.get(row_id), 'get_row');
      return row === undefined ? null : validateFileRow(row, row_id);
    },
    async putRow(row) {
      if (!isPlainObject(row)) fail('INVALID_FIELD_TYPE', 'FileRow must be an object', { field: 'row' });
      requiredId(row.id, 'row.id');
      utcTimestamp(row.timestamp, 'row.timestamp');
      canonicalJson(row.content);
      touchedRowIds.add(row.id);
      await request(store.put(clone(row)), 'put_row');
    },
    abort(error) {
      try {
        transaction.abort();
      } catch {
        // Preserve the original stable error.
      }
      throw normalizeThrown(error);
    },
  };
  rowPortMetadata.set(port, { touchedRowIds, eventIds });
  return port;
}

function emptyReviewStore() {
  return { schema_version: REVIEW_STORE_SCHEMA, by_learning_unit_id: {} };
}

export function normalizeReviewState(input) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'ReviewState must be an object', { field: 'review_state' });
  const keys = [
    'schema_version', 'review_state_id', 'learning_unit_id', 'word_id', 'state', 'due_at',
    'stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses',
    'learning_steps', 'last_review_at', 'scheduler_version', 'scheduler_parameters_version',
    'created_at', 'updated_at', 'revision', 'extensions',
  ];
  const unknown = Object.keys(input).find((key) => !keys.includes(key));
  if (unknown) fail('INVALID_FIELD_TYPE', 'Unknown ReviewState field', { field: `review_state.${unknown}` });
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      fail('MISSING_REQUIRED_FIELD', 'ReviewState field is required', { field: `review_state.${key}` });
    }
  }
  if (input.schema_version !== REVIEW_STATE_SCHEMA) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported ReviewState schema', {
      field: 'review_state.schema_version',
    });
  }
  const state = requiredId(input.state, 'review_state.state');
  if (!REVIEW_STATES.has(state)) fail('INVALID_ENUM_VALUE', 'Invalid review state', { field: 'review_state.state' });
  const createdAt = utcTimestamp(input.created_at, 'review_state.created_at');
  const updatedAt = utcTimestamp(input.updated_at, 'review_state.updated_at');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail('INVALID_TIMESTAMP', 'updated_at must not precede created_at', {
      field: 'review_state.updated_at',
    });
  }
  if (input.last_review_at !== null) utcTimestamp(input.last_review_at, 'review_state.last_review_at');
  const difficulty = finiteNonNegative(input.difficulty, 'review_state.difficulty');
  if (difficulty < 1 || difficulty > 10) {
    fail('INVALID_FIELD_TYPE', 'ReviewState difficulty is outside scheduler range', {
      field: 'review_state.difficulty',
    });
  }
  if (!isPlainObject(input.extensions)) fail('INVALID_FIELD_TYPE', 'extensions must be an object', { field: 'review_state.extensions' });
  return {
    schema_version: REVIEW_STATE_SCHEMA,
    review_state_id: requiredId(input.review_state_id, 'review_state.review_state_id'),
    learning_unit_id: requiredId(input.learning_unit_id, 'review_state.learning_unit_id'),
    word_id: requiredId(input.word_id, 'review_state.word_id'),
    state,
    due_at: utcTimestamp(input.due_at, 'review_state.due_at'),
    stability: finiteNonNegative(input.stability, 'review_state.stability'),
    difficulty,
    elapsed_days: nonNegativeInteger(input.elapsed_days, 'review_state.elapsed_days'),
    scheduled_days: nonNegativeInteger(input.scheduled_days, 'review_state.scheduled_days'),
    reps: nonNegativeInteger(input.reps, 'review_state.reps'),
    lapses: nonNegativeInteger(input.lapses, 'review_state.lapses'),
    learning_steps: nonNegativeInteger(input.learning_steps, 'review_state.learning_steps'),
    last_review_at: input.last_review_at,
    scheduler_version: requiredId(input.scheduler_version, 'review_state.scheduler_version'),
    scheduler_parameters_version: requiredId(
      input.scheduler_parameters_version,
      'review_state.scheduler_parameters_version',
    ),
    created_at: createdAt,
    updated_at: updatedAt,
    revision: nonNegativeInteger(input.revision, 'review_state.revision'),
    extensions: clone(input.extensions),
  };
}

function normalizeReviewStore(content) {
  if (content === null || content === undefined) return emptyReviewStore();
  if (!isPlainObject(content)
    || content.schema_version !== REVIEW_STORE_SCHEMA
    || !isPlainObject(content.by_learning_unit_id)
    || Object.keys(content).some((key) => !['schema_version', 'by_learning_unit_id'].includes(key))) {
    fail('TRANSACTION_ABORTED', 'Invalid review store row', {
      row_id: VOCABULARY_REVIEW_ROW_ID,
    });
  }
  const store = emptyReviewStore();
  for (const [learningUnitId, value] of Object.entries(content.by_learning_unit_id)) {
    const state = normalizeReviewState(value);
    if (state.learning_unit_id !== learningUnitId) {
      fail('INVALID_CONTEXT_REFERENCE', 'Review store key does not match learning unit', {
        learning_unit_id: learningUnitId,
      });
    }
    store.by_learning_unit_id[learningUnitId] = state;
  }
  return store;
}

export function bindReviewRepositoryToTransaction(row_port) {
  if (!row_port
    || typeof row_port.getRow !== 'function'
    || typeof row_port.putRow !== 'function'
    || typeof row_port.abort !== 'function') {
    fail('INVALID_FIELD_TYPE', 'Expected a VocabularyLearningTransactionRowPort', {
      field: 'row_port',
    });
  }
  const load = async () => {
    const row = await row_port.getRow(VOCABULARY_REVIEW_ROW_ID);
    return normalizeReviewStore(row?.content ?? null);
  };
  const save = async (store, timestamp) => row_port.putRow({
    id: VOCABULARY_REVIEW_ROW_ID,
    content: store,
    timestamp,
  });
  return {
    async getByLearningUnitId(learning_unit_id) {
      requiredId(learning_unit_id, 'learning_unit_id');
      return clone((await load()).by_learning_unit_id[learning_unit_id] ?? null);
    },
    async putInitial(input) {
      const next = normalizeReviewState(input);
      if (next.revision !== 0 || next.last_review_at !== null || next.state !== 'new') {
        fail('INVALID_STATE_TRANSITION', 'Initial ReviewState is not initial', {
          learning_unit_id: next.learning_unit_id,
        });
      }
      const store = await load();
      if (store.by_learning_unit_id[next.learning_unit_id]) {
        fail('REVIEW_STATE_ALREADY_EXISTS', 'ReviewState already exists', {
          learning_unit_id: next.learning_unit_id,
        });
      }
      store.by_learning_unit_id[next.learning_unit_id] = next;
      await save(store, next.updated_at);
      return clone(next);
    },
    async update(input, expected_revision) {
      const next = normalizeReviewState(input);
      nonNegativeInteger(expected_revision, 'expected_revision');
      const store = await load();
      const current = store.by_learning_unit_id[next.learning_unit_id];
      if (!current) {
        fail('INVALID_CONTEXT_REFERENCE', 'ReviewState does not exist', {
          learning_unit_id: next.learning_unit_id,
        });
      }
      if (current.revision !== expected_revision || next.revision !== expected_revision) {
        fail('CONCURRENT_MODIFICATION', 'ReviewState revision did not match', {
          learning_unit_id: next.learning_unit_id,
          expected_revision,
          actual_revision: current.revision,
        });
      }
      if (current.review_state_id !== next.review_state_id
        || current.learning_unit_id !== next.learning_unit_id
        || current.word_id !== next.word_id
        || current.created_at !== next.created_at) {
        fail('INVALID_STATE_TRANSITION', 'Immutable ReviewState identity changed', {
          learning_unit_id: next.learning_unit_id,
        });
      }
      next.revision += 1;
      store.by_learning_unit_id[next.learning_unit_id] = next;
      await save(store, next.updated_at);
      return clone(next);
    },
  };
}

export function assembleVocabularyLearningUnitOfWork(row_port, event_partition) {
  if (!EVENT_PARTITION.test(event_partition)) {
    fail('INVALID_EVENT_PARTITION', 'Event partition must use YYYY-MM', {
      event_partition: typeof event_partition === 'string' ? event_partition : null,
    });
  }
  const metadata = rowPortMetadata.get(row_port) ?? {
    touchedRowIds: new Set(),
    eventIds: new Set(),
  };
  if (!rowPortMetadata.has(row_port)) rowPortMetadata.set(row_port, metadata);
  const events = bindLearningEventRepositoryToTransaction(row_port, event_partition);
  return {
    abort(error) {
      return row_port.abort(error);
    },
    acquisition: bindAcquisitionRepositoryToTransaction(row_port),
    contexts: bindContextEvidenceRepositoryToTransaction(row_port),
    review: bindReviewRepositoryToTransaction(row_port),
    events: {
      getById: events.getById,
      async append(event) {
        const stored = await events.append(event);
        metadata.eventIds.add(stored.event_id);
        return stored;
      },
    },
  };
}

function normalizeCommand(command) {
  if (!isPlainObject(command)) fail('INVALID_FIELD_TYPE', 'Command must be an object', { field: 'command' });
  const keys = ['command_id', 'command_type', 'correlation_id', 'event_partition', 'payload'];
  const unknown = Object.keys(command).find((key) => !keys.includes(key));
  if (unknown) fail('INVALID_FIELD_TYPE', 'Unknown command field', { field: `command.${unknown}` });
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(command, key)) {
      fail('MISSING_REQUIRED_FIELD', 'Command field is required', { field: `command.${key}` });
    }
  }
  if (!EVENT_PARTITION.test(command.event_partition)) {
    fail('INVALID_EVENT_PARTITION', 'Event partition must use YYYY-MM', {
      event_partition: typeof command.event_partition === 'string' ? command.event_partition : null,
    });
  }
  canonicalJson(command.payload);
  return {
    command_id: requiredId(command.command_id, 'command.command_id'),
    command_type: requiredId(command.command_type, 'command.command_type'),
    correlation_id: requiredId(command.correlation_id, 'command.correlation_id'),
    event_partition: command.event_partition,
    payload: clone(command.payload),
  };
}

async function executeWithRowPort(rowPort, command, execute, now) {
  const receiptRowId = `${VOCABULARY_COMMAND_RECEIPT_PREFIX}${command.command_id}`;
  const fingerprint = fingerprintVocabularyLearningCommand(command.command_type, command.payload);
  const existing = await rowPort.getRow(receiptRowId);
  if (existing) {
    const receipt = existing.content;
    const expectedKeys = [
      'schema_version', 'command_id', 'command_type', 'contract_version',
      'payload_fingerprint', 'status', 'result', 'result_sha256', 'correlation_id',
      'touched_row_ids', 'event_ids', 'committed_at', 'extensions',
    ];
    const sortedUniqueIds = (values) => (
      Array.isArray(values)
      && values.every((value) => typeof value === 'string' && value.length > 0)
      && canonicalJson(values) === canonicalJson([...new Set(values)].sort())
    );
    if (!isPlainObject(receipt)
      || canonicalJson(Object.keys(receipt).sort()) !== canonicalJson([...expectedKeys].sort())
      || receipt.schema_version !== RECEIPT_SCHEMA
      || receipt.command_id !== command.command_id
      || receipt.command_type !== command.command_type
      || receipt.contract_version !== VOCABULARY_LEARNING_CONTRACT_VERSION
      || !HEX64.test(receipt.payload_fingerprint)
      || receipt.status !== 'committed'
      || !HEX64.test(receipt.result_sha256)
      || receipt.result_sha256 !== sha256Utf8(canonicalJson(receipt.result))
      || typeof receipt.correlation_id !== 'string'
      || receipt.correlation_id.length === 0
      || !sortedUniqueIds(receipt.touched_row_ids)
      || !sortedUniqueIds(receipt.event_ids)
      || utcTimestamp(receipt.committed_at, 'receipt.committed_at') !== existing.timestamp
      || !isPlainObject(receipt.extensions)) {
      return rowPort.abort(contractError('TRANSACTION_ABORTED', 'Invalid command receipt', {
        command_id: command.command_id,
      }));
    }
    if (receipt.payload_fingerprint !== fingerprint) {
      return rowPort.abort(contractError('IDEMPOTENCY_CONFLICT', 'Command ID was reused', {
        command_id: command.command_id,
      }));
    }
    return clone(receipt.result);
  }
  const uow = assembleVocabularyLearningUnitOfWork(rowPort, command.event_partition);
  const result = clone(await execute(uow));
  canonicalJson(result);
  const committedAt = utcTimestamp(now(), 'committed_at');
  const metadata = rowPortMetadata.get(rowPort);
  metadata.touchedRowIds.add(receiptRowId);
  const touchedRowIds = [...metadata.touchedRowIds].sort();
  const eventIds = [...metadata.eventIds].sort();
  await rowPort.putRow({
    id: receiptRowId,
    content: {
      schema_version: RECEIPT_SCHEMA,
      command_id: command.command_id,
      command_type: command.command_type,
      contract_version: VOCABULARY_LEARNING_CONTRACT_VERSION,
      payload_fingerprint: fingerprint,
      status: 'committed',
      result,
      result_sha256: sha256Utf8(canonicalJson(result)),
      correlation_id: command.correlation_id,
      touched_row_ids: touchedRowIds,
      event_ids: eventIds,
      committed_at: committedAt,
      extensions: {},
    },
    timestamp: committedAt,
  });
  return clone(result);
}

function transactionCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(contractError(
      'TRANSACTION_ABORTED',
      'Vocabulary learning transaction aborted',
      { operation: 'transaction' },
    ));
    transaction.onerror = () => reject(contractError(
      'TRANSACTION_ABORTED',
      'Vocabulary learning transaction failed',
      { operation: 'transaction' },
    ));
  });
}

function openExistingDatabase(indexedDBApi) {
  if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
    return Promise.reject(contractError('INVALID_FIELD_TYPE', 'IndexedDB is unavailable', {
      field: 'indexedDBApi',
    }));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open('SeekPlayerDB', 1);
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        // Never create or upgrade the database from this module.
      }
      reject(contractError('TRANSACTION_ABORTED', 'Existing SeekPlayerDB schema is required', {
        operation: 'open_database',
      }));
    };
    request.onerror = () => reject(contractError(
      'TRANSACTION_ABORTED',
      'Could not open SeekPlayerDB',
      { operation: 'open_database' },
    ));
    request.onsuccess = () => {
      const database = request.result;
      try {
        if (database.version !== 1 || !database.objectStoreNames.contains('files')) {
          throw new Error('schema');
        }
        const transaction = database.transaction(['files'], 'readonly');
        if (transaction.objectStore('files').keyPath !== 'id') throw new Error('keyPath');
      } catch {
        database.close?.();
        reject(contractError('TRANSACTION_ABORTED', 'SeekPlayerDB schema is incompatible', {
          operation: 'validate_schema',
        }));
        return;
      }
      resolve(database);
    };
  });
}

export async function runVocabularyLearningUnitOfWork(
  dependencies = {},
  rawCommand,
  execute,
) {
  if (!isPlainObject(dependencies)
    || Object.keys(dependencies).some((key) => !['indexedDBApi', 'now'].includes(key))) {
    fail('INVALID_FIELD_TYPE', 'Invalid unit-of-work dependencies', { field: 'dependencies' });
  }
  if (typeof execute !== 'function') fail('INVALID_FIELD_TYPE', 'execute must be a function', { field: 'execute' });
  const command = normalizeCommand(rawCommand);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const indexedDBApi = dependencies.indexedDBApi
    ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const database = await openExistingDatabase(indexedDBApi);
  const transaction = database.transaction(['files'], 'readwrite');
  const completion = transactionCompletion(transaction);
  const rowPort = createVocabularyLearningTransactionRowPort(
    transaction,
    `vocabulary-learning-${++transactionSequence}`,
  );
  let result;
  try {
    result = await executeWithRowPort(rowPort, command, execute, now);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted.
    }
    await completion.catch(() => undefined);
    database.close?.();
    throw normalizeThrown(error);
  }
  try {
    await completion;
  } finally {
    database.close?.();
  }
  return clone(result);
}

export function createInMemoryVocabularyLearningUnitOfWorkRunner(options = {}) {
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'In-memory options must be an object', { field: 'options' });
  let rows = new Map();
  for (const row of options.rows ?? []) {
    rows.set(row.id, clone(row));
  }
  let runCount = 0;
  const now = options.now ?? (() => new Date().toISOString());
  const run = async (dependencies, rawCommand, execute) => {
    const command = normalizeCommand(rawCommand);
    const staged = new Map([...rows].map(([key, value]) => [key, clone(value)]));
    let operationIndex = 0;
    const touchedRowIds = new Set();
    const eventIds = new Set();
    const port = {
      transaction_id: `in-memory-vocabulary-learning-${++runCount}`,
      async getRow(rowId) {
        if (typeof options.failGet === 'function' && options.failGet({
          row_id: rowId,
          command: clone(command),
        })) {
          throw contractError('TRANSACTION_ABORTED', 'Injected transaction failure', {
            operation: 'get_row',
          });
        }
        touchedRowIds.add(rowId);
        return staged.has(rowId) ? clone(staged.get(rowId)) : null;
      },
      async putRow(row) {
        operationIndex += 1;
        if (typeof options.failPut === 'function' && options.failPut({
          row: clone(row),
          operation_index: operationIndex,
          command: clone(command),
        })) {
          throw contractError('TRANSACTION_ABORTED', 'Injected transaction failure', {
            operation: 'put_row',
          });
        }
        touchedRowIds.add(row.id);
        staged.set(row.id, clone(row));
      },
      abort(error) {
        throw normalizeThrown(error);
      },
    };
    rowPortMetadata.set(port, { touchedRowIds, eventIds });
    try {
      const result = await executeWithRowPort(
        port,
        command,
        execute,
        dependencies?.now ?? now,
      );
      rows = staged;
      return clone(result);
    } catch (error) {
      throw normalizeThrown(error);
    }
  };
  return {
    run,
    snapshot() {
      return [...rows.values()].map(clone).sort((left, right) => left.id.localeCompare(right.id));
    },
  };
}
