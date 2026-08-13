const HEX64 = /^[a-f0-9]{64}$/u

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonical JSON accepts plain objects only')
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  throw new TypeError('canonical JSON rejects unsupported values')
}

// Synchronous SHA-256 keeps browser IndexedDB transactions active while envelopes are built.
export function sha256Utf8(input) {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const rotate = (value, count) => (value >>> count) | (value << (32 - count))
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64)
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]
      const right = words[index - 2]
      const s0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3)
      const s1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const upper = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + upper + choice + constants[index] + words[index]) >>> 0
      const lower = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (lower + majority) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    hash = hash.map((value, index) => (value + [a, b, c, d, e, f, g, h][index]) >>> 0)
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('')
}

export function checksumFor(value) {
  return `sha256:${sha256Utf8(canonicalJson(value))}`
}

export function hasValidChecksum(row) {
  try {
    return typeof row?.checksum === 'string'
      && row.checksum.startsWith('sha256:')
      && HEX64.test(row.checksum.slice('sha256:'.length))
      && row.checksum === checksumFor(row.content)
  } catch {
    return false
  }
}

export function clonePersistenceValue(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function backupRowId(sourceId, revision) {
  return `${sourceId}.backup:${revision}`
}

export function quarantineRowId(sourceId, sourceRow, reason) {
  return `vocabulary.corrupt.quarantine.v1:${sha256Utf8(canonicalJson({ sourceId, sourceRow, reason }))}`
}

export function makeQuarantineRow({ sourceId, sourceRow, reason, detectedAt, details = {} }) {
  const content = {
    schema_version: 'vocabulary-corrupt-quarantine.v1',
    sourceId,
    sourceRow: clonePersistenceValue(sourceRow),
    reason,
    detectedAt,
    details: clonePersistenceValue(details),
  }
  return {
    id: quarantineRowId(sourceId, sourceRow, reason),
    content,
    timestamp: detectedAt,
    checksum: checksumFor(content),
  }
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left].map((character) => character.codePointAt(0))
  const rightPoints = [...right].map((character) => character.codePointAt(0))
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  }
  return leftPoints.length - rightPoints.length
}
