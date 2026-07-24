export function diversifyReviewQueue(entries) {
  const sourceBuckets = groupBy(entries, sourceKey)
  const diversifiedSources = sourceBuckets.map((bucket) => interleave(
    groupBy(bucket, sentenceKey),
  ))
  return interleave(diversifiedSources)
}

function groupBy(entries, keyForEntry) {
  const buckets = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = keyForEntry(entry)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  return [...buckets.values()]
}

function interleave(buckets) {
  const queues = buckets.map((bucket) => bucket.slice())
  const result = []
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (queue.length) result.push(queue.shift())
    }
  }
  return result
}

function sourceKey(entry) {
  const context = latestContext(entry)
  return normalize(context?.source_id || context?.sourceId || context?.source_title || context?.sourceTitle)
    || `unknown:${entry?.word?.id || entry?.word?.word || ''}`
}

function sentenceKey(entry) {
  const context = latestContext(entry)
  return normalize(context?.sentence || context?.surrounding_text || context?.surroundingText)
    || `unknown:${entry?.word?.id || entry?.word?.word || ''}`
}

function latestContext(entry) {
  return (Array.isArray(entry?.contexts) ? entry.contexts : [])
    .filter(Boolean)
    .sort((left, right) => timestamp(right) - timestamp(left))[0] || null
}

function timestamp(context) {
  const value = Date.parse(context?.created_at || context?.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}
