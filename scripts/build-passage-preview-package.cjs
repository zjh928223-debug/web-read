const fs = require('node:fs')
const path = require('node:path')

const TARGET_LEMMAS = ['thorough', 'readily', 'subtle', 'attribute', 'enhance']
const SCHEMA = 'passage-preview.micro-reading.v1'

function run() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.familiarity || !args.microReading || !args.out) {
    throw new Error('Usage: npm run preview:build-package -- --familiarity <answers.json> --micro-reading <micro-reading.json> --out <private-package.json>')
  }
  const familiarity = readJson(args.familiarity)
  const reading = readJson(args.microReading)
  if (!Array.isArray(familiarity.answers)) throw new Error('familiarity file must contain answers[]')
  if (reading.microReadingSchema !== SCHEMA || !Array.isArray(reading.microReadings)) {
    throw new Error(`micro-reading file must contain microReadingSchema=${SCHEMA} and microReadings[]`)
  }
  assertExactLemmas(
    familiarity.answers
      .filter((item) => String(item?.source || '').includes('C19-T1-RP1-'))
      .map((item) => item?.lemma || item?.word),
    'familiarity answers',
  )
  assertExactLemmas(reading.microReadings.map((item) => item?.lemma), 'microReadings')
  for (const item of reading.microReadings) validateReading(item)

  const output = {
    answers: familiarity.answers,
    microReadingSchema: SCHEMA,
    microReadings: reading.microReadings,
  }
  const outputPath = path.resolve(args.out)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Private Passage 1 preview package written to ${outputPath}`)
}

function validateReading(item) {
  const lemma = normalize(item?.lemma)
  for (const field of ['targetMeaningZh', 'focusPhraseEn', 'focusPhraseZh']) {
    if (!normalize(item?.[field])) throw new Error(`${lemma}.${field} is required`)
  }
  for (const field of ['focusChunks', 'paragraphChunks']) {
    const chunks = item?.[field]
    if (!Array.isArray(chunks) || !chunks.length) throw new Error(`${lemma}.${field} must be non-empty`)
    if (!chunks.some((chunk) => chunk?.containsTarget === true)) {
      throw new Error(`${lemma}.${field} must include containsTarget=true`)
    }
    for (const chunk of chunks) {
      if (!normalize(chunk?.en) || !normalize(chunk?.zh)) {
        throw new Error(`${lemma}.${field} chunks require en and zh`)
      }
    }
  }
}

function assertExactLemmas(values, label) {
  const found = new Set(values.map(normalize).filter((value) => TARGET_LEMMAS.includes(value)))
  const missing = TARGET_LEMMAS.filter((lemma) => !found.has(lemma))
  if (missing.length) throw new Error(`${label} missing: ${missing.join(', ')}`)
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 2) {
    const name = String(values[index] || '').replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    result[name] = values[index + 1]
  }
  return result
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

try {
  run()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
