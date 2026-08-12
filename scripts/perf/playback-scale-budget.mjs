function percentile(values, quantile) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

export function evaluatePlaybackScaleArtifact(config, artifact) {
  const failures = []
  const metrics = []
  const fixture = config?.fixture || {}
  const expectedWords = fixture.wordCounts || []
  const expectedSamples = fixture.interactionsPerOperation
  const operationNames = Object.keys(config?.budgets?.interactionP95Ms || {})

  if (config?.schema !== 'read-web.playback-scale-budgets' || config?.version !== 1) failures.push('unsupported playback scale budget config')
  if (artifact?.schema !== 'read-web.playback-scale-results' || artifact?.schemaVersion !== 1) failures.push('unsupported playback scale artifact')
  if (artifact?.fixture?.schema !== fixture.schema || artifact?.fixture?.version !== fixture.version) failures.push('fixture identity does not match playback scale budget')
  if (artifact?.fixture?.offline !== true || fixture.offline !== true) failures.push('playback scale fixture must be offline')
  if (artifact?.errors?.length) failures.push(`artifact contains ${artifact.errors.length} error(s)`)

  for (const wordCount of expectedWords) {
    const matches = (artifact?.results || []).filter((result) => result.wordCount === wordCount)
    if (matches.length !== 1) {
      failures.push(`expected exactly one ${wordCount}-word result`)
      continue
    }
    const result = matches[0]
    addMetric(metrics, failures, `${wordCount}.import.max`, result.importDurationMs, config.budgets.importMaxMs[wordCount])

    for (const operation of operationNames) {
      const samples = Array.isArray(result.samples?.[operation]) ? result.samples[operation] : []
      if (samples.length !== expectedSamples) failures.push(`${wordCount}.${operation} must contain exactly ${expectedSamples} samples`)
      addMetric(metrics, failures, `${wordCount}.${operation}.p95`, percentile(samples, 0.95), config.budgets.interactionP95Ms[operation])
    }

    const longTaskMax = Math.max(0, ...(result.longTasks || []).map((entry) => Number(entry.durationMs)).filter(Number.isFinite))
    addMetric(metrics, failures, `${wordCount}.long-task.max`, longTaskMax, config.budgets.longTaskMaxMs)
    addMetric(metrics, failures, `${wordCount}.listeners.active`, result.listeners?.afterOperations, config.budgets.listenerActiveMax[wordCount])
    const listenerGrowth = Number(result.listeners?.afterOperations) - Number(result.listeners?.afterImport)
    addMetric(metrics, failures, `${wordCount}.listener growth`, listenerGrowth, config.budgets.listenerGrowthMax)

    const correctness = result.correctness || {}
    for (const [key, expected] of Object.entries({
      wordCount,
      chunkCount: result.segmentCount,
      wordUpdates: expectedSamples,
      chunkUpdates: expectedSamples,
      seeks: expectedSamples,
      markedWords: expectedSamples,
      modeSwitches: expectedSamples,
      finalMode: 'transcript',
      activeWordCount: 1,
      activeChunkCount: 0,
    })) {
      if (correctness[key] !== expected) failures.push(`${wordCount}.correctness.${key} expected ${expected}, received ${correctness[key]}`)
    }
  }

  return { passed: failures.length === 0, failures, metrics }
}

function addMetric(metrics, failures, id, actual, limit) {
  const numericActual = Number(actual)
  const numericLimit = Number(limit)
  const passed = Number.isFinite(numericActual) && Number.isFinite(numericLimit) && numericActual <= numericLimit
  metrics.push({ id, actual: numericActual, limit: numericLimit, passed })
  if (!passed) failures.push(`${id}: ${numericActual} exceeds ${numericLimit}`)
}
