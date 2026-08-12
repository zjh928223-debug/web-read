export function createTranslationGenerationQueue(options = {}) {
  const translate = options.translate
  const apply = options.apply
  if (typeof translate !== 'function' || typeof apply !== 'function') {
    throw new TypeError('translate and apply are required')
  }

  let generation = 0
  let controller = null
  let queue = Promise.resolve()

  function enqueue(items) {
    if (controller) controller.abort()
    const localController = new AbortController()
    const localGeneration = ++generation
    controller = localController
    queue = queue.then(async () => {
      if (localController.signal.aborted || localGeneration !== generation) return
      const translated = await translate(items, { signal: localController.signal })
      if (localController.signal.aborted || localGeneration !== generation) return
      apply(translated)
    }).catch((error) => {
      if (error && error.name === 'AbortError') return
      throw error
    })
    return queue
  }

  function dispose() {
    generation += 1
    if (controller) controller.abort()
    controller = null
  }

  return { enqueue, dispose }
}
