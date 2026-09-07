const ENGLISH_WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/u

export function normalizeEnglishWord(value) {
  const word = String(value || '').normalize('NFKC').trim().toLowerCase()
  return ENGLISH_WORD_PATTERN.test(word) && word.length <= 64 ? word : ''
}

export function generateEnglishInflections(value) {
  const lemma = normalizeEnglishWord(value)
  if (!lemma) return []
  return unique([
    lemma,
    ...pluralOrThirdPerson(lemma),
    pastTense(lemma),
    presentParticiple(lemma),
  ])
}

export function isEnglishInflectionOf(formValue, lemmaValue) {
  const form = normalizeEnglishWord(formValue)
  return Boolean(form) && generateEnglishInflections(lemmaValue).includes(form)
}

export function findExactEnglishWordInSentence(sentenceValue, wordValue) {
  const sentence = String(sentenceValue || '').normalize('NFKC')
  const word = normalizeEnglishWord(wordValue)
  if (!sentence || !word) return ''
  const tokens = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []
  return tokens.find((token) => normalizeEnglishWord(token) === word) || ''
}

export function deriveEnglishLemmaCandidates(value) {
  const word = normalizeEnglishWord(value)
  if (!word) return []
  const candidates = []

  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ves') && word.length > 4) candidates.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`)
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3)
    const undoubled = removeDoubledFinal(stem)
    candidates.push(undoubled)
    if (undoubled === stem) candidates.push(stem)
    candidates.push(`${stem}e`)
  }
  if (word.endsWith('ied') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2)
    const undoubled = removeDoubledFinal(stem)
    candidates.push(undoubled, `${stem}e`)
    if (undoubled === stem) candidates.push(stem)
  }
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) candidates.push(word.slice(0, -1))
  if (word.endsWith('es') && word.length > 4) candidates.push(word.slice(0, -2))

  return unique(candidates).filter((candidate) => (
    candidate.length >= 2
    && candidate !== word
    && isEnglishInflectionOf(word, candidate)
  ))
}

export function findEnglishInflectionInSentence(sentenceValue, lemmaValue, options = {}) {
  const sentence = String(sentenceValue || '').normalize('NFKC')
  const lemma = normalizeEnglishWord(lemmaValue)
  if (!sentence || !lemma) return ''
  const allowed = new Set(generateEnglishInflections(lemma))
  const tokens = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []
  const preferred = normalizeEnglishWord(options.preferredForm)
  if (preferred && allowed.has(preferred)) {
    const exact = findExactEnglishWordInSentence(sentence, preferred)
    if (exact) return exact
  }
  return tokens.find((token) => allowed.has(normalizeEnglishWord(token))) || ''
}

function pluralOrThirdPerson(lemma) {
  if (/[^aeiou]y$/u.test(lemma)) return [`${lemma.slice(0, -1)}ies`]
  if (/(?:s|x|z|ch|sh)$/u.test(lemma)) return [`${lemma}es`]
  // Common f/fe plurals are written with -ves (leaf/leaves, wife/wives).
  // Keep the regular -s form too because English has exceptions such as
  // roofs and chiefs.
  if (lemma.endsWith('fe')) return unique([`${lemma}s`, `${lemma.slice(0, -2)}ves`])
  if (lemma.endsWith('f')) return unique([`${lemma}s`, `${lemma.slice(0, -1)}ves`])
  return [`${lemma}s`]
}

function pastTense(lemma) {
  if (/[^aeiou]y$/u.test(lemma)) return `${lemma.slice(0, -1)}ied`
  if (lemma.endsWith('e')) return `${lemma}d`
  if (shouldDoubleFinal(lemma)) return `${lemma}${lemma.at(-1)}ed`
  return `${lemma}ed`
}

function presentParticiple(lemma) {
  if (lemma.endsWith('ie')) return `${lemma.slice(0, -2)}ying`
  if (lemma.endsWith('e') && !lemma.endsWith('ee')) return `${lemma.slice(0, -1)}ing`
  if (shouldDoubleFinal(lemma)) return `${lemma}${lemma.at(-1)}ing`
  return `${lemma}ing`
}

function shouldDoubleFinal(lemma) {
  return lemma.length >= 3
    && !/[wxy]$/u.test(lemma)
    && /[aeiou][b-df-hj-np-tv-z]$/u.test(lemma)
    // Do not double after a vowel digraph: heat -> heated, boil -> boiled,
    // look -> looked, and the same pattern appears frequently in the IELTS pool.
    && !/[aeiou]{2}[b-df-hj-np-tv-z]$/u.test(lemma)
    && !/[aeiou][b-df-hj-np-tv-z][a-z]+$/u.test(lemma.slice(0, -1))
}

function removeDoubledFinal(value) {
  return /([b-df-hj-np-tv-z])\1$/u.test(value) ? value.slice(0, -1) : value
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
