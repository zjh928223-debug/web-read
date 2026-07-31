const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_VERSION = 'vocabulary-learning-contracts.v1';
const RECEIPT_ROW_PREFIX = 'vocabulary.learning-command-receipt.v1:';
const HEX64 = /^[a-f0-9]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EXPECTED_VECTOR_FINGERPRINTS = Object.freeze({
  canonical_key_ordering: '3c17213781f54ad90b127dfe685b635539abfe5525e21681954bc6de2bda054d',
  same_payload_reordered: '3c17213781f54ad90b127dfe685b635539abfe5525e21681954bc6de2bda054d',
  semantic_difference: 'cfbe6158148eddae618173649e89b3e639dc5bc044603eff486481c3629da57b',
  missing_optional_property: '3d3e60282626703ecb4e764a0465385f972ab9cc65a59d4a16296487eb7ee70e',
  explicit_null_property: '6c77a20bcc5e8ef59eeac6b4144b65a936565e079956eedcfb52dc04c35e0b15',
  unicode_code_point_ordering: 'e6e41954f9311a5dfe0f4f6877c98cdfbf5895032c673155d48b42e9598e2e4d',
  finite_number_boundaries: '37b0915ccbd95438dc70b9f9705410b8cfae5d2f16632658e498707f6dbc3a4b',
});

function contractError() {
  return {
    code: 'INVALID_FIELD_TYPE',
    message: 'canonical_json.v1 rejects invalid JSON value',
    details: {
      contract: 'canonical_json.v1',
    },
  };
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left].map((character) => character.codePointAt(0));
  const rightPoints = [...right].map((character) => character.codePointAt(0));
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJson(value, location = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw contractError();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${location}[${index}]`)).join(',')}]`;
  }
  if (
    value
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${location}.${key}`)}`);
    return `{${entries.join(',')}}`;
  }
  throw contractError();
}

function sha256Utf8(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function commandEnvelope(vector) {
  return {
    command_type: vector.command_type,
    contract_version: CONTRACT_VERSION,
    payload: vector.payload,
  };
}

function fingerprint(vector) {
  return sha256Utf8(canonicalJson(commandEnvelope(vector)));
}

function buildInvalidValue(builder) {
  const envelope = {
    command_type: 'graduate_learning_unit',
    contract_version: CONTRACT_VERSION,
    payload: {},
  };
  if (builder === 'payload.optional=undefined') envelope.payload.optional = undefined;
  else if (builder === 'payload.items=[undefined]') envelope.payload.items = [undefined];
  else if (builder === 'payload.value=NaN') envelope.payload.value = Number.NaN;
  else if (builder === 'payload.value=Infinity') envelope.payload.value = Infinity;
  else if (builder === 'payload.value=-Infinity') envelope.payload.value = -Infinity;
  else if (builder === 'payload.value=new Date(0)') envelope.payload.value = new Date(0);
  else if (builder === 'payload=Object.create({inherited:true})') {
    envelope.payload = Object.create({ inherited: true });
  } else {
    throw new Error(`Unknown invalid vector builder: ${builder}`);
  }
  return envelope;
}

function assertSortedUnique(values, field) {
  assert.deepEqual(values, [...new Set(values)].sort(), `${field} must be sorted and unique`);
}

function assertExactKeys(value, expected, field) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${field} keys`);
}

function assertUtcTimestamp(value, field) {
  assert.match(value, UTC_TIMESTAMP, `${field} format`);
  assert.equal(new Date(value).toISOString(), value, `${field} must be a real UTC timestamp`);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'vocabulary-command-receipt-fingerprint-vectors.v1.json',
  );
  const fixtureBytesBefore = fs.readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytesBefore.toString('utf8'));
  const contracts = fs.readFileSync(
    path.join(
      repoRoot,
      'openspec',
      'changes',
      'separate-vocabulary-acquisition-and-review',
      'p0-contracts.md',
    ),
    'utf8',
  );

  assert.equal(fixture.schema_version, 'command-receipt-fingerprint-vectors.v1');
  assert.equal(fixture.contract_version, CONTRACT_VERSION);
  assert.equal(fixture.canonical_json_version, 'canonical_json.v1');
  assert.equal(fixture.fingerprint_algorithm, 'sha256-utf8-canonical-json.v1');
  assert.deepEqual(
    Object.keys(fixture.valid_vectors).sort(),
    Object.keys(EXPECTED_VECTOR_FINGERPRINTS).sort(),
    'valid vector registry',
  );
  assert.match(contracts, /object key Unicode code-point 升序/);
  assert.match(contracts, /保留显式 `null`/);
  assert.match(contracts, /禁止 `undefined`、NaN、Infinity、Date 和自定义 prototype/);
  assert.match(contracts, /"vocabulary\.learning-command-receipt\.v1:" \+ command_id/);

  for (const [name, vector] of Object.entries(fixture.valid_vectors)) {
    assert.equal(
      vector.expected_fingerprint,
      EXPECTED_VECTOR_FINGERPRINTS[name],
      `${name} frozen fingerprint constant`,
    );
    const canonical = canonicalJson(commandEnvelope(vector));
    assert.equal(canonical, vector.expected_canonical_envelope, `${name} canonical JSON`);
    assert.equal(fingerprint(vector), vector.expected_fingerprint, `${name} fingerprint`);
    assert.match(vector.expected_fingerprint, HEX64);
  }

  const vectors = fixture.valid_vectors;
  assert.equal(
    vectors.canonical_key_ordering.expected_fingerprint,
    vectors.same_payload_reordered.expected_fingerprint,
    'key insertion order must not affect fingerprint',
  );
  assert.notEqual(
    vectors.canonical_key_ordering.expected_fingerprint,
    vectors.semantic_difference.expected_fingerprint,
    'semantic payload changes must affect fingerprint',
  );
  assert.notEqual(
    vectors.missing_optional_property.expected_fingerprint,
    vectors.explicit_null_property.expected_fingerprint,
    'missing properties and explicit null must remain distinct',
  );
  const unicodePayloadKeys = Object.keys(vectors.unicode_code_point_ordering.payload);
  assert.deepEqual(
    unicodePayloadKeys.map((key) => key.codePointAt(0)),
    [0x1f600, 0xe000],
    'fixture insertion order must put the astral key before the BMP private-use key',
  );
  assert.deepEqual(
    [...unicodePayloadKeys].sort().map((key) => key.codePointAt(0)),
    [0x1f600, 0xe000],
    'JavaScript default UTF-16 ordering control',
  );
  assert.deepEqual(
    [...unicodePayloadKeys].sort(compareUnicodeCodePoints).map((key) => key.codePointAt(0)),
    [0xe000, 0x1f600],
    'canonical Unicode code-point ordering',
  );
  assert.notDeepEqual(
    [...unicodePayloadKeys].sort(),
    [...unicodePayloadKeys].sort(compareUnicodeCodePoints),
    'Unicode vector must distinguish UTF-16 and code-point ordering',
  );
  const finiteNumbers = vectors.finite_number_boundaries.payload;
  assert.equal(Object.is(finiteNumbers.negative_zero, -0), true, 'fixture must preserve -0 input');
  assert.equal(JSON.stringify(finiteNumbers.negative_zero), '0', '-0 canonical form');
  assert.equal(JSON.stringify(finiteNumbers.ordinary_decimal), '123.456');
  assert.equal(JSON.stringify(finiteNumbers.tiny_exponent), '1e-7');
  assert.equal(JSON.stringify(finiteNumbers.large_exponent), '1e+21');

  assert.deepEqual(
    fixture.invalid_vectors.map(({ name, builder }) => ({ name, builder })),
    [
      { name: 'object_property_undefined', builder: 'payload.optional=undefined' },
      { name: 'array_item_undefined', builder: 'payload.items=[undefined]' },
      { name: 'nan', builder: 'payload.value=NaN' },
      { name: 'positive_infinity', builder: 'payload.value=Infinity' },
      { name: 'negative_infinity', builder: 'payload.value=-Infinity' },
      { name: 'date', builder: 'payload.value=new Date(0)' },
      { name: 'custom_prototype', builder: 'payload=Object.create({inherited:true})' },
    ],
    'invalid vector registry',
  );
  for (const vector of fixture.invalid_vectors) {
    assert.throws(
      () => canonicalJson(buildInvalidValue(vector.builder)),
      (error) => {
        assert.equal(error?.code, vector.expected_error_code);
        assert.deepEqual(error?.details, { contract: 'canonical_json.v1' });
        assert.doesNotMatch(
          JSON.stringify(error.details),
          /optional|items|value|inherited|user|harbor/iu,
          'error details must not echo payload content',
        );
        return true;
      },
      vector.name,
    );
  }

  const committed = fixture.receipt_vectors.committed;
  const receipt = committed.content;
  assertExactKeys(committed, ['id', 'content', 'timestamp'], 'committed FileRow');
  assert.equal(committed.id, `${RECEIPT_ROW_PREFIX}${receipt.command_id}`);
  assertUtcTimestamp(committed.timestamp, 'committed FileRow timestamp');
  assertExactKeys(
    receipt,
    [
      'schema_version',
      'command_id',
      'command_type',
      'contract_version',
      'payload_fingerprint',
      'status',
      'result',
      'result_sha256',
      'correlation_id',
      'touched_row_ids',
      'event_ids',
      'committed_at',
      'extensions',
    ],
    'committed receipt content',
  );
  assertUtcTimestamp(receipt.committed_at, 'receipt committed_at');
  assert.equal(receipt.schema_version, 'command-receipt.v1');
  assert.equal(receipt.contract_version, CONTRACT_VERSION);
  assert.equal(receipt.status, 'committed');
  assert.equal(
    receipt.payload_fingerprint,
    vectors.canonical_key_ordering.expected_fingerprint,
  );
  assert.equal(receipt.result_sha256, sha256Utf8(canonicalJson(receipt.result)));
  assertSortedUnique(receipt.touched_row_ids, 'touched_row_ids');
  assertSortedUnique(receipt.event_ids, 'event_ids');

  const sameRetry = fixture.receipt_vectors.same_command_same_fingerprint;
  assert.equal(sameRetry.command_id, receipt.command_id);
  assert.equal(sameRetry.payload_fingerprint, receipt.payload_fingerprint);
  assert.equal(sameRetry.expected_action, 'RETURN_STORED_RESULT');
  assert.deepEqual(sameRetry.expected_result, receipt.result);
  assert.equal(sameRetry.expected_result_sha256, receipt.result_sha256);
  assert.equal(sameRetry.expected_result_return_mode, 'DEEP_CLONE');
  assert.equal(sameRetry.expected_callback_invocations, 0);
  assert.equal(sameRetry.expected_new_event_count, 0);
  assert.equal(sameRetry.expected_initial_row_timestamp, committed.timestamp);
  assert.equal(sameRetry.expected_row_timestamp, sameRetry.expected_initial_row_timestamp);
  assert.equal(sameRetry.expected_initial_committed_at, receipt.committed_at);
  assert.equal(sameRetry.expected_committed_at, sameRetry.expected_initial_committed_at);
  const storedResultBeforeRetry = JSON.stringify(receipt.result);
  const returnedResult = JSON.parse(storedResultBeforeRetry);
  assert.notStrictEqual(returnedResult, receipt.result, 'same-fingerprint result must be a deep clone');
  assert.deepEqual(returnedResult, receipt.result);
  returnedResult.learning_unit_id = 'mutated-consumer-copy';
  assert.equal(
    JSON.stringify(receipt.result),
    storedResultBeforeRetry,
    'mutating returned result must not mutate stored receipt result',
  );

  const conflict = fixture.receipt_vectors.same_command_different_fingerprint;
  assert.equal(conflict.command_id, receipt.command_id);
  assert.notEqual(conflict.payload_fingerprint, receipt.payload_fingerprint);
  assert.equal(conflict.expected_action, 'ABORT');
  assert.equal(conflict.expected_error_code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(conflict.expected_business_rows_unchanged, true);
  assert.equal(conflict.expected_receipt_row_unchanged, true);
  assert.equal(conflict.expected_row_timestamp, committed.timestamp);
  assert.equal(conflict.expected_committed_at, receipt.committed_at);

  assert.deepEqual(
    fs.readFileSync(fixturePath),
    fixtureBytesBefore,
    'verification must not modify fixture bytes',
  );
  console.log('Vocabulary command receipt/fingerprint verification passed.');
}

main();
