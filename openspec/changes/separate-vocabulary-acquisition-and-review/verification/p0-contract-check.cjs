const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const changeRoot = path.resolve(__dirname, '..')
const contracts = fs.readFileSync(path.join(changeRoot, 'p0-contracts.md'), 'utf8')
const design = fs.readFileSync(path.join(changeRoot, 'design.md'), 'utf8')
const parallelPlan = fs.readFileSync(path.join(changeRoot, 'parallel-execution-plan.md'), 'utf8')
const tasks = fs.readFileSync(path.join(changeRoot, 'tasks.md'), 'utf8')
const contextualSpec = fs.readFileSync(
  path.join(changeRoot, 'specs', 'contextual-vocabulary-acquisition', 'spec.md'),
  'utf8',
)
const DTO_ORDER = [
  'learning-unit.v1',
  'acquisition-state.v1',
  'context-evidence.v1',
  'acquisition-attempt.v1',
  'graduation-eligibility.v1',
  'review-state.v2',
  'review-attempt.v1',
  'session-ledger.v1',
  'learning-event.v1',
  'command-receipt.v1',
]
const EXPECTED_FIELD_COUNTS = [13, 14, 18, 21, 16, 20, 22, 15, 32, 13]
const EXPECTED_SEMANTIC_SHA256 = '5b1457a19d6f1cdf8e3cba4ff2aa78f919d86751f05ee9c5f71c94c34373fac0'

function parseDtoFieldSemantics(markdown) {
  const result = Object.fromEntries(DTO_ORDER.map((name) => [name, []]))
  let current = null
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{2,3} /.test(line)) {
      current = DTO_ORDER.find((name) => line.includes(`\`${name}\``)) || null
      continue
    }
    if (!current || !line.startsWith('| `')) continue
    const match = line.match(/^\| `([^`]+)` \| (.+) \| ([^|]+) \| ([^|]+) \| (.+) \|$/)
    assert.ok(match, `${current} contains malformed field row: ${line}`)
    const row = {
      field: match[1],
      type: match[2],
      required: match[3].trim(),
      nullable: match[4].trim(),
      rule: match[5],
    }
    assert.ok(row.type.length > 0, `${current}.${row.field} type is empty`)
    assert.ok(['是', '否'].includes(row.required), `${current}.${row.field} required must be 是/否`)
    assert.ok(['是', '否'].includes(row.nullable), `${current}.${row.field} nullable must be 是/否`)
    assert.ok(row.rule.length > 0, `${current}.${row.field} default/constraint is empty`)
    result[current].push(row)
  }
  return result
}

function semanticJson(schema) {
  return JSON.stringify(DTO_ORDER.map((name) => [name, schema[name]]))
}

function semanticHash(schema) {
  return crypto.createHash('sha256').update(semanticJson(schema)).digest('hex')
}

function assertFrozenSemantics(schema) {
  assert.deepEqual(
    DTO_ORDER.map((name) => schema[name].length),
    EXPECTED_FIELD_COUNTS,
    'DTO field count/order changed',
  )
  for (const name of DTO_ORDER) {
    const fields = schema[name].map((row) => row.field)
    assert.equal(new Set(fields).size, fields.length, `${name} contains duplicate fields`)
  }
  assert.equal(
    semanticHash(schema),
    EXPECTED_SEMANTIC_SHA256,
    'DTO field type/required/nullability/default-or-constraint semantics changed',
  )
}

const schema = parseDtoFieldSemantics(contracts)
assertFrozenSemantics(schema)

const semanticMutationSelfTests = []
for (const dimension of ['type', 'required', 'nullable', 'rule']) {
  const mutation = structuredClone(schema)
  const row = mutation['learning-unit.v1'][0]
  row[dimension] = `${row[dimension]}__mutation`
  assert.throws(() => assertFrozenSemantics(mutation), undefined, `${dimension} mutation must fail`)
  semanticMutationSelfTests.push(`${dimension} mutation rejected`)
}
const addedField = structuredClone(schema)
addedField['learning-unit.v1'].push({
  field: 'unexpected_field',
  type: 'string',
  required: '是',
  nullable: '否',
  rule: '无',
})
assert.throws(() => assertFrozenSemantics(addedField), undefined, 'added field must fail')
semanticMutationSelfTests.push('field addition rejected')

for (const code of [
  'DUPLICATE_TARGET_SENSE',
  'DELAY_POLICY_NOT_SATISFIED',
  'UNKNOWN_REVIEW_STATE',
  'IDEMPOTENCY_CONFLICT',
  'TRANSACTION_ABORTED',
]) assert.match(contracts, new RegExp(`\\| \`${code}\``), `missing stable error ${code}`)

for (const signature of [
  'normalizeLearningUnit(input: unknown): LearningUnit',
  'normalizeAcquisitionAttempt(input: unknown): AcquisitionAttempt',
  'evaluateGraduationEligibility(input: GraduationEligibilityInput): GraduationEligibility',
  'bindAcquisitionRepositoryToTransaction(',
  'normalizeContextEvidence(input: unknown): ContextEvidence',
  'createIndexedDbContextEvidenceRepository(',
  'bindContextEvidenceRepositoryToTransaction(',
  'normalizeLearningEvent(input: unknown): LearningEvent',
  'bindLearningEventRepositoryToTransaction(',
  'planReviewSession(input: ReviewPlanningInput): SessionLedger',
  'auditLegacyVocabularySnapshot(',
  'runVocabularyLearningUnitOfWork(',
  'createVocabularyLearningTransactionRowPort(',
  'bindReviewRepositoryToTransaction(',
  'assembleVocabularyLearningUnitOfWork(',
  'interface VocabularyLearningTransactionRowPort',
  'interface VocabularyLearningUnitOfWork',
  'interface AcquisitionTransactionRepository',
  'interface ContextEvidenceTransactionRepository',
  'interface ReviewTransactionRepository',
  'interface LearningEventTransactionRepository',
]) assert.ok(contracts.includes(signature), `missing exact signature ${signature}`)

for (const definition of [
  'type TargetSense = {',
  'type GraduationEligibilityInput = {',
  'type AcquisitionStoreV1 = {',
  'type ContextEvidenceStoreV1 = {',
  'type ReviewPlanningInput = {',
  'type LegacyAuditManifestV1 = {',
  'interface AcquisitionRepository extends AcquisitionTransactionRepository',
  'interface ContextEvidenceRepository extends ContextEvidenceTransactionRepository',
  'interface LearningEventRepository extends LearningEventTransactionRepository',
]) assert.ok(contracts.includes(definition), `missing public type definition ${definition}`)

assert.match(contracts, /同一 `word_id` \*\*允许同时存在多个 active target senses\*\*/)
assert.match(contracts, /唯一约束是 active `\(word_id, target_sense_key\)`/)
assert.match(contracts, /存储 row ID 固定为 `vocabulary\.context-evidence\.store\.v1`/)
assert.match(contracts, /elapsed_ms >= 86_400_000/)
assert.match(contracts, /evaluator 本身不得读取系统时钟/)
assert.match(contracts, /reason_codes` 只允许下列值，并按此顺序/)
assert.match(contracts, /"vocabulary\.learning-command-receipt\.v1:" \+ command_id/)
assert.match(contracts, /公开 API 不接受 DB\/schema override/)
assert.match(contracts, /bindAcquisitionRepositoryToTransaction\(\n  row_port: VocabularyLearningTransactionRowPort/)
assert.match(contracts, /bindContextEvidenceRepositoryToTransaction\(\n  row_port: VocabularyLearningTransactionRowPort/)
assert.match(contracts, /bindLearningEventRepositoryToTransaction\(\n  row_port: VocabularyLearningTransactionRowPort/)
assert.doesNotMatch(contracts, /bind[A-Za-z]+RepositoryToTransaction\(\n  transaction: VocabularyLearningUnitOfWork/)
assert.match(contracts, /binder 不得接收完整 UoW/)
assert.match(contracts, /ReviewTransactionRepository`、`vocabulary\.review\.store\.v2` repository 和共享 UoW 的\n唯一实现 owner 是 P6/)

assert.doesNotMatch(design, /初期是否允许用户为同一词同时维护两个 active target senses/)
assert.doesNotMatch(design, /graduation 的延迟检查最低间隔是跨会话即可/)
assert.match(design, /绑定到 `VocabularyLearningTransactionRowPort`/)
assert.match(design, /P7 不得与\nP6 同时实现 review repository/)
assert.match(parallelPlan, /固定 `vocabulary\.context-evidence\.store\.v1` row/)
assert.match(parallelPlan, /row-port factory、UoW assembler、`ReviewTransactionRepository`/)
assert.match(parallelPlan, /必须复用 P6 的 `ReviewTransactionRepository`/)
assert.match(tasks, /in-memory\/IndexedDB ContextEvidence repository、接收 `VocabularyLearningTransactionRowPort` 的 binder/)
assert.match(tasks, /作为唯一 owner 实现 transaction row-port factory、共享 UoW assembler/)
assert.match(tasks, /复用 P6 的 ReviewTransactionRepository\/review v2 repository/)
assert.match(contextualSpec, /graduation 的同一个 IndexedDB transaction 中通过 ContextEvidence transaction binding/)
assert.match(contextualSpec, /reason codes 按冻结顺序输出且结果不依赖回放时的系统时钟/)
assert.match(contextualSpec, /P6 先从唯一 transaction 创建 row port/)

process.stdout.write(`${JSON.stringify({
  contract_check_version: 'separate-vocabulary-acquisition-and-review.p0-contract-check.v3',
  semantic_schema_sha256: EXPECTED_SEMANTIC_SHA256,
  dto_tables_checked: DTO_ORDER,
  field_semantics_checked: EXPECTED_FIELD_COUNTS.reduce((sum, count) => sum + count, 0),
  semantic_mutation_self_tests: semanticMutationSelfTests,
  public_type_definitions_checked: 9,
  exact_interfaces_and_signatures_checked: 21,
}, null, 2)}\n`)
