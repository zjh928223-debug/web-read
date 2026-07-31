const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const { parse: parseVue } = require('@vue/compiler-sfc')

const root = path.resolve(__dirname, '..')
const targetMethods = new Set(['addWord', 'addWordLegacy'])
const expectedDefinitions = new Map([
  ['src/services/vocabulary/vocabulary-service.js:addWord', 1],
  ['src/services/vocabulary/vocabulary-service.js:addWordLegacy', 1]
])

function normalizeFile(file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function parseJavaScript(source, filename) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    plugins: [
      'jsx',
      'optionalChaining',
      'objectRestSpread',
      'classProperties',
      'topLevelAwait'
    ]
  })
}

function parseFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) {
    return [{ ast: parseJavaScript(source, file), source }]
  }

  const descriptor = parseVue(source, { filename: file }).descriptor
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map((block) => ({
      ast: parseJavaScript(block.content, file),
      source: block.content
    }))
}

function walk(node, visitor, ancestors = []) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') {
    visitor(node, ancestors)
    ancestors = [...ancestors, node]
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'tokens', 'comments', 'errors'].includes(key)) continue
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visitor, ancestors)
    } else {
      walk(value, visitor, ancestors)
    }
  }
}

function unwrap(node) {
  while (node && ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'ParenthesizedExpression'].includes(node.type)) {
    node = node.expression
  }
  return node
}

function collectConstants(ast) {
  const constants = new Map()
  walk(ast, (node) => {
    if (
      node.type === 'VariableDeclarator'
      && node.id?.type === 'Identifier'
      && node.init
    ) {
      constants.set(node.id.name, node.init)
    }
  })
  return constants
}

function staticString(node, constants, seen = new Set()) {
  node = unwrap(node)
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((item) => item.value.cooked).join('')
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left, constants, seen)
    const right = staticString(node.right, constants, seen)
    return left == null || right == null ? null : left + right
  }
  if (node.type === 'Identifier' && constants.has(node.name) && !seen.has(node.name)) {
    return staticString(constants.get(node.name), constants, new Set([...seen, node.name]))
  }
  return null
}

function memberPropertyName(node, constants) {
  node = unwrap(node)
  if (!node || !['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) return null
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  return staticString(node.property, constants)
}

function featureFlagPolarity(node) {
  node = unwrap(node)
  if (!node) return 0
  if (node.type === 'Identifier' && node.name === 'acquisitionEnabled') return 1
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    return -featureFlagPolarity(node.argument)
  }
  if (
    ['BinaryExpression', 'LogicalExpression'].includes(node.type)
    && ['===', '==', '!==', '!='].includes(node.operator)
  ) {
    const leftPolarity = featureFlagPolarity(node.left)
    const rightPolarity = featureFlagPolarity(node.right)
    const booleanNode = leftPolarity ? unwrap(node.right) : unwrap(node.left)
    const polarity = leftPolarity || rightPolarity
    if (!polarity || booleanNode?.type !== 'BooleanLiteral') return 0
    const equality = node.operator === '===' || node.operator === '=='
    return polarity * (equality === booleanNode.value ? 1 : -1)
  }
  if (
    ['CallExpression', 'OptionalCallExpression'].includes(node.type)
    && unwrap(node.callee)?.type === 'Identifier'
    && unwrap(node.callee).name === 'Boolean'
    && node.arguments.length === 1
  ) {
    return featureFlagPolarity(node.arguments[0])
  }
  return 0
}

function nodeWithin(node, container) {
  return Number.isInteger(node.start)
    && Number.isInteger(node.end)
    && Number.isInteger(container?.start)
    && Number.isInteger(container?.end)
    && node.start >= container.start
    && node.end <= container.end
}

function isAllowedLegacyFallback(file, node, ancestors) {
  if (file !== 'src/services/vocabulary/srs-candidates.js') return false
  return ancestors.some((ancestor) => {
    if (ancestor.type !== 'IfStatement') return false
    const polarity = featureFlagPolarity(ancestor.test)
    return (
      (polarity === 1 && nodeWithin(node, ancestor.alternate))
      || (polarity === -1 && nodeWithin(node, ancestor.consequent))
    )
  })
}

function analyzeAst(ast, file, options = {}) {
  const constants = collectConstants(ast)
  const aliases = new Map()
  const aliasNodes = new Map()
  const definitions = []
  const calls = []

  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && targetMethods.has(node.id?.name)) {
      definitions.push({
        file,
        method: node.id.name,
        line: node.loc?.start.line ?? null
      })
    }
  })

  function methodFromExpression(expression) {
    expression = unwrap(expression)
    if (!expression) return null
    if (expression.type === 'Identifier') return aliases.get(expression.name) ?? null
    if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
      const property = memberPropertyName(expression, constants)
      return targetMethods.has(property) ? property : null
    }
    if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
      const callee = unwrap(expression.callee)
      if (
        ['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type)
        && memberPropertyName(callee, constants) === 'bind'
      ) {
        return methodFromExpression(callee.object)
      }
    }
    return null
  }

  let changed = true
  while (changed) {
    changed = false
    walk(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
        const method = methodFromExpression(node.init)
        if (method && aliases.get(node.id.name) !== method) {
          aliases.set(node.id.name, method)
          aliasNodes.set(`${node.id.name}:${node.start}`, node)
          changed = true
        }
      }
      if (
        node.type === 'AssignmentExpression'
        && node.operator === '='
        && node.left?.type === 'Identifier'
      ) {
        const method = methodFromExpression(node.right)
        if (method && aliases.get(node.left.name) !== method) {
          aliases.set(node.left.name, method)
          aliasNodes.set(`${node.left.name}:${node.start}`, node)
          changed = true
        }
      }
      const pattern = node.type === 'VariableDeclarator'
        ? node.id
        : node.type === 'AssignmentExpression' && node.operator === '='
          ? node.left
          : null
      const source = node.type === 'VariableDeclarator' ? node.init : node.right
      if (pattern?.type !== 'ObjectPattern' || !source) return
      for (const property of pattern.properties) {
        if (property.type !== 'ObjectProperty') continue
        const method = property.computed
          ? staticString(property.key, constants)
          : property.key?.name ?? property.key?.value
        const local = property.value?.type === 'Identifier' ? property.value.name : null
        if (local && targetMethods.has(method) && aliases.get(local) !== method) {
          aliases.set(local, method)
          aliasNodes.set(`${local}:${property.start}`, property)
          changed = true
        }
      }
    })
  }

  for (const [key, node] of aliasNodes) {
    const local = key.slice(0, key.lastIndexOf(':'))
    calls.push({
      file,
      method: aliases.get(local),
      kind: 'alias',
      line: node.loc?.start.line ?? null,
      allowed: false
    })
  }

  walk(ast, (node, ancestors) => {
    if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) return
    const callee = unwrap(node.callee)
    let method = methodFromExpression(callee)
    let kind = 'call'

    if (callee?.type === 'Identifier' && aliases.has(callee.name)) {
      method = aliases.get(callee.name)
      kind = 'alias-call'
    } else if (['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type)) {
      const operation = memberPropertyName(callee, constants)
      const reflectCall = (
        ['apply', 'construct'].includes(operation)
        && unwrap(callee.object)?.type === 'Identifier'
        && unwrap(callee.object).name === 'Reflect'
      )
      if (reflectCall) {
        method = methodFromExpression(node.arguments[0])
        if (method) kind = `Reflect.${operation}`
      } else if (['call', 'apply', 'bind'].includes(operation)) {
        method = methodFromExpression(callee.object)
        if (method) kind = operation
      }
    }

    if (!method) return
    calls.push({
      file,
      method,
      kind,
      line: node.loc?.start.line ?? null,
      allowed: (
        options.useAllowlist !== false
        && method === 'addWordLegacy'
        && kind === 'call'
        && isAllowedLegacyFallback(file, node, ancestors)
      )
    })
  })

  return { definitions, calls }
}

function productionFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...productionFiles(full))
    else if (/\.(?:js|mjs|cjs|vue)$/.test(entry.name)) files.push(full)
  }
  return files
}

function assertSelfTests() {
  const bypasses = [
    'svc.addWord({})',
    "svc['addWord']({})",
    'svc?.addWord?.({})',
    'const { addWord } = svc; addWord({})',
    'let f; f = svc.addWord; f({})',
    'const f = svc.addWord.bind(svc); f({})',
    'svc.addWord.call(svc, {})',
    "svc['addWord'].apply(svc, [{}])",
    "const key = 'addWord'; svc[key]({})",
    "const prefix = 'add'; svc[prefix + 'Word']({})",
    'const a = svc.addWord; const b = a; b({})',
    "const { ['addWord']: x } = svc; x({})",
    "let y; ({ ['addWord']: y } = svc); y({})",
    "svc?.['addWordLegacy']?.({})",
    'Reflect.apply(svc.addWord, svc, [{}])',
    'Reflect.construct(svc.addWordLegacy, [{}])'
  ]
  for (const [index, source] of bypasses.entries()) {
    const ast = parseJavaScript(source, `self-test-${index}.js`)
    const result = analyzeAst(ast, `self-test-${index}.js`, { useAllowlist: false })
    if (result.calls.length === 0) {
      throw new Error(`AST guard self-test missed bypass ${index + 1}: ${source}`)
    }
  }

  const safe = analyzeAst(
    parseJavaScript('service.upsertVocabularyEntry({}); service.queueVocabularyAcquisition({})', 'safe.js'),
    'safe.js',
    { useAllowlist: false }
  )
  if (safe.calls.length !== 0) throw new Error('AST guard reported a safe vocabulary call')

  const fallbackFile = 'src/services/vocabulary/srs-candidates.js'
  const allowedPositive = analyzeAst(
    parseJavaScript(
      'if (acquisitionEnabled) { service.queueVocabularyAcquisition({}) } else { service.addWordLegacy({}) }',
      fallbackFile
    ),
    fallbackFile
  )
  if (allowedPositive.calls.filter((call) => call.allowed).length !== 1) {
    throw new Error('AST guard rejected the positive acquisition flag legacy fallback')
  }

  const rejectedReverse = analyzeAst(
    parseJavaScript(
      'if (!acquisitionEnabled) { service.queueVocabularyAcquisition({}) } else { service.addWordLegacy({}) }',
      fallbackFile
    ),
    fallbackFile
  )
  if (
    rejectedReverse.calls.some((call) => call.allowed)
    || rejectedReverse.calls.filter((call) => !call.allowed).length !== 1
  ) {
    throw new Error('AST guard failed to reject a reversed acquisition flag fallback')
  }

  const allowedNegatedConsequent = analyzeAst(
    parseJavaScript(
      'if (!acquisitionEnabled) { service.addWordLegacy({}) } else { service.queueVocabularyAcquisition({}) }',
      fallbackFile
    ),
    fallbackFile
  )
  if (allowedNegatedConsequent.calls.filter((call) => call.allowed).length !== 1) {
    throw new Error('AST guard rejected a semantically equivalent flag-off consequent')
  }
}

assertSelfTests()

const inventory = { definitions: [], calls: [] }
for (const filePath of productionFiles(path.join(root, 'src'))) {
  const file = normalizeFile(filePath)
  for (const block of parseFile(filePath)) {
    const result = analyzeAst(block.ast, file)
    inventory.definitions.push(...result.definitions)
    inventory.calls.push(...result.calls)
  }
}

const definitionCounts = new Map()
for (const definition of inventory.definitions) {
  const key = `${definition.file}:${definition.method}`
  definitionCounts.set(key, (definitionCounts.get(key) ?? 0) + 1)
}

const unexpectedDefinitions = inventory.definitions.filter(
  (definition) => !expectedDefinitions.has(`${definition.file}:${definition.method}`)
)
const missingDefinitions = [...expectedDefinitions].filter(
  ([key, count]) => definitionCounts.get(key) !== count
)
const allowedLegacyCalls = inventory.calls.filter((call) => call.allowed)
const forbiddenFindings = inventory.calls.filter((call) => !call.allowed)

const report = {
  compatibility_adapter_definitions: inventory.definitions,
  allowed_legacy_calls: allowedLegacyCalls,
  forbidden_findings: forbiddenFindings,
  bypass_self_tests: 16,
  fallback_polarity_self_tests: 3
}
console.log(JSON.stringify(report, null, 2))

if (unexpectedDefinitions.length || missingDefinitions.length) {
  throw new Error(`Compatibility adapter definition inventory mismatch: ${JSON.stringify({
    unexpectedDefinitions,
    missingDefinitions
  })}`)
}
if (
  allowedLegacyCalls.length !== 1
  || allowedLegacyCalls[0].file !== 'src/services/vocabulary/srs-candidates.js'
  || allowedLegacyCalls[0].method !== 'addWordLegacy'
) {
  throw new Error(`Explicit legacy allowlist mismatch: ${JSON.stringify(allowedLegacyCalls)}`)
}
if (forbiddenFindings.length) {
  throw new Error(`Forbidden addWord boundary usage: ${JSON.stringify(forbiddenFindings)}`)
}

console.log('Vocabulary addWord AST boundary check passed.')
