const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importProjectApis(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, `.tmp-srs-review-${process.pid}-`))
  try {
    const vocabularyDir = path.join(repoRoot, 'src', 'services', 'vocabulary')
    for (const entry of fs.readdirSync(vocabularyDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      writeModule(
        path.join(vocabularyDir, entry.name),
        path.join(tempDir, `vocab-${entry.name.replace(/\.js$/, '.mjs')}`),
        (source) => source.replace(/from\s+(['"])\.\/([^'"]+)\.js\1/g, "from './vocab-$2.mjs'"),
      )
    }
    fs.writeFileSync(
      path.join(tempDir, 'vue-stub.mjs'),
      'export const ref = (value) => ({ value });\nexport const computed = (getter) => ({ get value() { return getter(); } });\n',
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'useSrsReview.js'),
      path.join(tempDir, 'useSrsReview.mjs'),
      (source) => source
        .replace(/from\s+['"]vue['"]/, "from './vue-stub.mjs'")
        .replace(/from\s+['"]\.\.\/\.\.\/services\/vocabulary\/index\.js['"]/, "from './vocab-index.mjs'")
        .replace(/from\s+['"]\.\/srs-review-queue\.js['"]/, "from './srs-review-queue.mjs'"),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-context.js'),
      path.join(tempDir, 'srs-review-context.mjs'),
      (source) => source.replace(
        /from\s+['"]\.\.\/\.\.\/composables\/youtube-workflow-client\.js['"]/,
        "from './youtube-workflow-client.mjs'",
      ),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-pronunciation.js'),
      path.join(tempDir, 'srs-review-pronunciation.mjs'),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-playback.js'),
      path.join(tempDir, 'srs-review-playback.mjs'),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-layout.js'),
      path.join(tempDir, 'srs-review-layout.mjs'),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-meanings.js'),
      path.join(tempDir, 'srs-review-meanings.mjs'),
    )
    writeModule(
      path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-queue.js'),
      path.join(tempDir, 'srs-review-queue.mjs'),
    )
    writeModule(
      path.join(repoRoot, 'src', 'composables', 'youtube-workflow-client.js'),
      path.join(tempDir, 'youtube-workflow-client.mjs'),
    )
    return {
      vocabulary: await import(pathToFileURL(path.join(tempDir, 'vocab-index.mjs')).href),
      reviewModule: await import(pathToFileURL(path.join(tempDir, 'useSrsReview.mjs')).href),
      contextModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-context.mjs')).href),
      pronunciationModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-pronunciation.mjs')).href),
      playbackModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-playback.mjs')).href),
      layoutModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-layout.mjs')).href),
      meaningsModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-meanings.mjs')).href),
      queueModule: await import(pathToFileURL(path.join(tempDir, 'srs-review-queue.mjs')).href),
    }
  } finally {
    const resolvedTemp = path.resolve(tempDir)
    const resolvedRepo = path.resolve(repoRoot)
    if (resolvedTemp.startsWith(resolvedRepo + path.sep)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

function writeModule(sourcePath, destinationPath, transform = (source) => source) {
  fs.writeFileSync(destinationPath, transform(fs.readFileSync(sourcePath, 'utf8')))
}

async function run() {
  const repoRoot = path.resolve(__dirname, '..')
  const { vocabulary, reviewModule, contextModule, pronunciationModule, playbackModule, layoutModule, meaningsModule, queueModule } = await importProjectApis(repoRoot)
  const reviewPageSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'srs-review', 'SrsReviewPage.vue'),
    'utf8',
  )
  const reviewCssSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review.css'),
    'utf8',
  )
  assert.doesNotMatch(reviewPageSource, /\busageHint\b/, 'the separate usage hint panel should stay removed')
  assert.match(reviewPageSource, /重读单词和原句/, 'the reread word-and-sentence control should remain visible')
  assert.match(
    reviewPageSource,
    /:aria-keyshortcuts="replayShortcutDisplay"/,
    'the reread control should expose its configured shortcut',
  )
  assert.doesNotMatch(
    reviewPageSource,
    /空格暂停|继续播放/,
    'Space pause/resume should remain an invisible keyboard behavior',
  )
  assert.match(
    reviewPageSource,
    /addEventListener\('keydown', handleReviewShortcut, true\)/,
    'review playback shortcuts should be captured globally before focused controls handle them',
  )
  assert.match(
    reviewPageSource,
    /playParagraphWord/,
    'context words should remain individually playable',
  )
  assert.doesNotMatch(
    reviewPageSource,
    /<button\s+v-if="part\.word"/,
    'context words must not use buttons because reader-wide button styles create word bubbles',
  )
  assert.match(
    reviewPageSource,
    /<span\s+v-if="part\.word"/,
    'context words should use plain inline text elements',
  )
  assert.match(reviewPageSource, /句中释义/, 'the stored context meaning should be labeled as contextual')
  assert.match(reviewPageSource, /replayShortcutEditing/, 'the replay shortcut should be customizable in place')
  assert.match(reviewPageSource, /localStorage/, 'the customized replay shortcut should persist locally')
  assert.match(reviewPageSource, /srs-review-meaning-group is-general/, 'general meanings should have a primary style hook')
  assert.match(reviewPageSource, /srs-review-meaning-group is-contextual/, 'context meanings should have a secondary style hook')
  assert.match(
    reviewCssSource,
    /\.srs-review-meaning-group\.is-contextual p\s*\{[^}]*color:\s*#7b8494/s,
    'context meanings should use a muted text color',
  )
  assert.match(reviewPageSource, /srs-review-remove-word/, 'review cards should expose a subtle removal control')
  assert.match(reviewPageSource, /srs-review-word-content/, 'word and meanings should share a vertically centered content group')
  assert.match(reviewPageSource, /review\.removeCurrent\(\)/, 'the removal control should update the active review queue')
  assert.match(
    reviewCssSource,
    /\.srs-review-remove-word\s*\{[^}]*font-size:\s*11px/s,
    'the removal control should remain visually quiet',
  )
  assert.match(
    reviewCssSource,
    /\.srs-review-header\s*\{[^}]*min-height:\s*54px/s,
    'the review header should stay compact so the study content gets more height',
  )
  assert.match(
    reviewCssSource,
    /\.srs-review-actions button\s*\{[^}]*min-height:\s*44px/s,
    'rating buttons should remain compact because keyboard shortcuts are the primary interaction',
  )
  assert.match(
    reviewCssSource,
    /\.srs-review-word-line h2\s*\{[^}]*font-size:\s*clamp\(38px,\s*3\.8vw,\s*54px\)/s,
    'review words should use a readable size instead of dominating the definition panel',
  )
  assert.match(
    reviewCssSource,
    /\.srs-review-word-content\s*\{[^}]*margin-block:\s*auto/s,
    'short word content should sit in the vertical center of its panel',
  )
  assert.match(
    reviewCssSource,
    /\.srs-review-passages\s*\{[^}]*align-content:\s*safe center/s,
    'short source context should sit in the vertical center above the fixed audio controls',
  )

  const now = '2026-07-23T00:00:00.000Z'
  const snapshot = createSyntheticSnapshot(now)
  snapshot.words[0].general_meaning = '错误旧缓存'
  snapshot.words[0].dictionary_source = 'merriam-webster-collegiate+gemini'
  const repository = vocabulary.createInMemoryVocabularyRepository(snapshot)
  const service = vocabulary.createVocabularyService({ repository, now: () => new Date(now) })
  const review = reviewModule.useSrsReview(service, { now })

  await review.load()
  assert.equal(review.total.value, 5, 'due queue should load all due words')
  const meaningRequests = []
  const meaningResult = await meaningsModule.hydrateReviewGeneralMeanings(
    review.queue.value,
    service,
    {
      fetchImpl: async (_url, request) => {
        const payload = JSON.parse(request.body)
        meaningRequests.push(payload.words)
        return {
          ok: true,
          async json() {
            return {
              items: payload.words.map((word) => ({
                word,
                englishDefinition: `definition of ${word}`,
                generalMeaning: `${word}-通用义`,
                source: 'merriam-webster-collegiate+gemini:v2',
              })),
            }
          },
        }
      },
    },
  )
  assert.equal(meaningRequests.length, 1, 'review meanings should be fetched in a batch')
  assert.equal(meaningResult.cached, 5, 'all missing review meanings should be cached')
  assert.equal(
    (await repository.getWord('word-1')).general_meaning,
    'again-word-通用义',
    'the translated general meaning should persist in the vocabulary snapshot',
  )
  const repeatedMeaningResult = await meaningsModule.hydrateReviewGeneralMeanings(
    review.queue.value,
    service,
    { fetchImpl: async () => { throw new Error('cached meanings must not be fetched again') } },
  )
  assert.equal(repeatedMeaningResult.requested, 0, 'permanent meanings should skip future API calls')
  assert.equal(review.progress.value, '复习 1 / 5')
  assert.deepEqual(
    review.actions.map(({ shortcut, label, rating, mastered }) => [shortcut, label, rating, Boolean(mastered)]),
    [
      ['1', '忘记', vocabulary.REVIEW_RATINGS.AGAIN, false],
      ['2', '困难', vocabulary.REVIEW_RATINGS.HARD, false],
      ['3', '一般', vocabulary.REVIEW_RATINGS.GOOD, false],
      ['4', '容易', vocabulary.REVIEW_RATINGS.EASY, false],
      ['5', '掌握', vocabulary.REVIEW_RATINGS.EASY, true],
    ],
    'five actions should map from weakest to strongest memory',
  )
  assert.equal(reviewModule.getReviewActionForShortcut('1').label, '忘记')
  assert.equal(reviewModule.getReviewActionForShortcut('5').label, '掌握')
  assert.equal(reviewModule.getReviewActionForShortcut('0'), null)

  for (const action of review.actions) {
    const currentId = review.current.value.word.id
    assert.equal(await review.submitAction(action), true)
    const logs = await repository.getReviewLogsForWord(currentId)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].rating, action.rating)
    if (action.shortcut === '1') {
      assert.equal(review.goPrevious(), true, 'left navigation should revisit the previous card')
      assert.equal(review.current.value.word.id, currentId)
      assert.equal(review.reviewingPast.value, true)
      assert.equal(
        await review.submitAction(review.actions[1]),
        false,
        'a historical card must not be rated twice',
      )
      assert.equal((await repository.getReviewLogsForWord(currentId)).length, 1)
      assert.equal(review.goNext(), true, 'right navigation should return to the active card')
      assert.equal(review.reviewingPast.value, false)
    }
    if (action.mastered) {
      assert.equal((await repository.getWord(currentId)).status, 'known')
    }
  }
  assert.equal(review.completed.value, true, 'last successful rating should complete the session')
  assert.equal(review.goPrevious(), true, 'completed sessions should allow a final-card review')
  assert.equal(review.reviewingPast.value, true)
  assert.equal(review.goNext(), true)
  assert.equal(review.completed.value, true)

  const removalRepository = vocabulary.createInMemoryVocabularyRepository(createSyntheticSnapshot(now))
  const removalService = vocabulary.createVocabularyService({ repository: removalRepository, now: () => new Date(now) })
  const removalReview = reviewModule.useSrsReview(removalService, { now })
  await removalReview.load()
  const removedWordId = removalReview.current.value.word.id
  assert.equal(await removalReview.removeCurrent(), true)
  assert.equal(removalReview.total.value, 4, 'removing a mistaken entry should shrink the active queue')
  assert.equal(removalReview.dailyTotal.value, 4, 'removing a mistaken entry should update today’s total')
  assert.notEqual(removalReview.current.value.word.id, removedWordId, 'review should continue with the next word')
  assert.equal(await removalRepository.getWord(removedWordId), null, 'removed review entries should be deleted permanently')

  let releaseReview
  let duplicateCalls = 0
  const duplicateReview = reviewModule.useSrsReview({
    async getDueWords() {
      return [createDueEntry('duplicate')]
    },
    async reviewWord() {
      duplicateCalls += 1
      return new Promise((resolve) => { releaseReview = resolve })
    },
  })
  await duplicateReview.load()
  const firstSubmission = duplicateReview.submitRating(vocabulary.REVIEW_RATINGS.GOOD)
  const duplicateSubmission = duplicateReview.submitRating(vocabulary.REVIEW_RATINGS.GOOD)
  assert.equal(await duplicateSubmission, false, 'pending submission should reject a duplicate click')
  assert.equal(duplicateCalls, 1, 'duplicate click should not create a second review log')
  releaseReview()
  await firstSubmission

  let dailyDueCutoff = ''
  const dailyReview = reviewModule.useSrsReview({
    async getDueWords(cutoff) {
      dailyDueCutoff = cutoff
      return [
        createDueEntry('reviewed-today'),
        createDueEntry('daily-remaining-1'),
        createDueEntry('daily-remaining-2'),
      ]
    },
    async getReviewLogs() {
      return [{
        id: 'today-log-1',
        word_id: 'reviewed-today',
        rating: vocabulary.REVIEW_RATINGS.GOOD,
        reviewed_at: '2026-07-23T01:00:00.000Z',
      }]
    },
    async reviewWord(wordId, rating) {
      return {
        reviewLog: {
          id: `today-log-${wordId}`,
          word_id: wordId,
          rating,
          reviewed_at: '2026-07-23T02:00:00.000Z',
        },
      }
    },
  }, { now: '2026-07-23T03:00:00.000Z' })
  await dailyReview.load()
  assert.ok(
    Date.parse(dailyDueCutoff) > Date.parse('2026-07-23T03:00:00.000Z'),
    'the daily queue should use the end of the local day instead of the current instant',
  )
  assert.equal(dailyReview.total.value, 2, 'words already reviewed today should not re-enter the queue')
  assert.equal(dailyReview.dailyTotal.value, 3, 'today total should include completed and remaining words')
  assert.equal(dailyReview.progress.value, '复习 2 / 3', 'reopening should preserve today progress')
  assert.equal(dailyReview.reviewHistory.value[0].wordCount, 1, 'history should count unique words by day')
  await dailyReview.submitRating(vocabulary.REVIEW_RATINGS.GOOD)
  assert.equal(dailyReview.dailyTotal.value, 3, 'today total must remain fixed after another rating')
  assert.equal(dailyReview.progress.value, '复习 3 / 3')
  assert.equal(dailyReview.reviewHistory.value[0].wordCount, 2)

  let retryCalls = 0
  const retryReview = reviewModule.useSrsReview({
    async getDueWords() {
      return [createDueEntry('retry')]
    },
    async reviewWord() {
      retryCalls += 1
      if (retryCalls === 1) throw new Error('write failed')
    },
  })
  await retryReview.load()
  assert.equal(await retryReview.submitRating(vocabulary.REVIEW_RATINGS.AGAIN), false)
  assert.equal(retryReview.index.value, 0, 'failed write should stay on the current word')
  assert.match(retryReview.error.value, /write failed/)
  assert.equal(retryReview.pending.value, false, 'buttons should recover after a failed write')
  assert.equal(await retryReview.submitRating(vocabulary.REVIEW_RATINGS.AGAIN), true)
  assert.equal(retryReview.completed.value, true, 'retry should be able to complete the word')

  const emptyReview = reviewModule.useSrsReview({
    async getDueWords() { return [] },
    async reviewWord() {},
  })
  await emptyReview.load()
  assert.equal(emptyReview.empty.value, true, 'empty queue should expose the empty state')

  const textContext = contextModule.buildReviewContext({
    word: { word: 'resilient' },
    contexts: [{
      sentence: 'Building resilient cities is essential.',
      surrounding_text: 'Cities face new pressures. Building resilient cities is essential. Communities can recover faster. A fourth sentence is outside the nearest window.',
      created_at: now,
    }],
  })
  assert.equal(textContext.paragraphs.length, 3, 'context should be limited to three nearest passages')
  assert.equal(textContext.paragraphs.some((paragraph) => paragraph.target), true)
  assert.equal(
    textContext.paragraphs.flatMap((paragraph) => paragraph.sentenceParts || []).some((part) => part.word),
    true,
    'target word should be highlighted inside the target sentence',
  )
  assert.equal(
    contextModule.resolveReviewMeaning(
      { meaning: 'A long article-specific explanation involving Eric and his death.' },
      {
        meaning: 'Another contextual explanation.',
        simple_meaning: '情况；境况',
      },
    ),
    '情况；境况',
    'the concise SRS meaning should take priority over article-specific explanations',
  )
  assert.equal(
    contextModule.resolveReviewGeneralMeaning({
      meaning: '就读',
      dictionary_meaning: '参加；出席；照料',
    }),
    '参加；出席；照料',
    'a dictionary meaning should remain separate from the stored contextual meaning',
  )
  assert.equal(
    contextModule.resolveReviewGeneralMeaning({ meaning: '就读' }),
    '',
    'the first stored contextual meaning must not be mislabeled as a general meaning',
  )
  assert.equal(
    contextModule.resolveReviewGeneralMeaning({
      general_meaning: 'outdated result',
      dictionary_source: 'merriam-webster-collegiate+gemini',
    }),
    '',
    'outdated Merriam/Gemini meanings should stay hidden until they are refreshed',
  )

  const unavailableAudio = await contextModule.resolveReviewAudio({
    source_id: 'offline-source',
    sentence: 'Building resilient cities is essential.',
  }, {
    client: { async getFile() { throw new Error('offline') } },
    createObjectURL() { throw new Error('should not create a URL') },
  })
  assert.equal(unavailableAudio, null, 'offline audio should fall back to text only')

  const matched = contextModule.findTranscriptSegment({
    segments: [{ text: 'Building resilient cities is essential!', start: 4, end: 8 }],
  }, 'building resilient cities is essential.')
  assert.equal(matched.start, 4, 'normalized transcript matching should find the source sentence')

  const transcriptWindow = contextModule.buildTranscriptContextWindow({
    segments: [
      { text: 'A woman appeared in court for the very first time today.', start: 0, end: 7 },
      { text: 'Investigators said she attended classes for four days.', start: 7, end: 13 },
      { text: 'Defense attorneys described why she came to the country.', start: 13, end: 22 },
      { text: 'This fourth segment should be outside the review window.', start: 22, end: 30 },
    ],
  }, 'appeared in court')
  assert.deepEqual(
    transcriptWindow.map((item) => [item.text, item.target]),
    [
      ['A woman appeared in court for the very first time today.', true],
      ['Investigators said she attended classes for four days.', false],
      ['Defense attorneys described why she came to the country.', false],
    ],
    'transcript context should expand a stored fragment around its matched position',
  )

  assert.deepEqual(
    contextModule.findTranscriptWordRange({
      words: [
        { word: 'a', start: 1.2, end: 1.3 },
        { word: 'short', start: 1.4, end: 1.8 },
        { word: 'court', start: 1.9, end: 2.2 },
        { word: 'appearance.', start: 2.3, end: 2.9 },
      ],
    }, 'short court appearance'),
    { start: 1.4, end: 2.9 },
    'a review phrase should resolve to its exact original-audio word range',
  )
  assert.deepEqual(
    contextModule.buildClickableTextParts(
      'A short court appearance.',
      {
        words: [
          { word: 'A', start: 1.2, end: 1.3 },
          { word: 'short', start: 1.4, end: 1.8 },
          { word: 'court', start: 1.9, end: 2.2 },
          { word: 'appearance.', start: 2.3, end: 2.9 },
        ],
      },
    ).filter((part) => part.word).map(({ text, start, remainingText }) => [text, start, remainingText]),
    [
      ['A', 1.2, 'A short court appearance.'],
      ['short', 1.4, 'short court appearance.'],
      ['court', 1.9, 'court appearance.'],
      ['appearance', 2.3, 'appearance.'],
    ],
    'clickable context words should preserve original text and map source timestamps',
  )

  const resolvedSource = await contextModule.resolveReviewSource({
    source_id: 'source-with-fragment',
    sentence: 'appeared in court',
  }, {
    word: 'court',
    client: {
      async getFile(_sourceId, kind) {
        if (kind === 'transcript') {
          return new Blob([JSON.stringify({
            segments: [
              { text: 'A woman appeared in court for the very first time today.', start: 0, end: 7 },
              { text: 'Investigators described what happened next.', start: 7, end: 13 },
              { text: 'Her attorneys provided more background.', start: 13, end: 22 },
            ],
          })], { type: 'application/json' })
        }
        return new Blob(['audio'], { type: 'audio/mpeg' })
      },
    },
    createObjectURL() { return 'blob:review-audio' },
  })
  assert.equal(resolvedSource.paragraphs.length, 3)
  assert.equal(resolvedSource.paragraphs[0].target, true)
  assert.equal(resolvedSource.paragraphs[0].sentenceParts.some((part) => part.word), true)
  assert.equal(resolvedSource.paragraphs[0].start, 0)
  assert.equal(resolvedSource.paragraphs[1].start, 7)
  assert.equal(resolvedSource.paragraphs[1].end, 13)
  assert.equal(resolvedSource.url, 'blob:review-audio')
  assert.equal(resolvedSource.start, 0)
  assert.equal(resolvedSource.end, 7)

  let streamingTranscriptRequests = 0
  const streamingClient = {
    async getFile(_sourceId, kind) {
      streamingTranscriptRequests += 1
      assert.equal(kind, 'transcript')
      return new Blob([JSON.stringify({
        segments: [{ text: 'She appeared in court today.', start: 3, end: 6 }],
      })], { type: 'application/json' })
    },
    fileUrl(sourceId, kind) {
      return `http://127.0.0.1:8765/api/jobs/${sourceId}/file/${kind}`
    },
  }
  const streamingSource = await contextModule.resolveReviewSource({
    source_id: 'streaming-source',
    sentence: 'appeared in court',
  }, {
    client: streamingClient,
  })
  assert.equal(
    streamingSource.url,
    'http://127.0.0.1:8765/api/jobs/streaming-source/file/audio',
    'source audio should stream directly instead of downloading the full file into a Blob',
  )
  assert.equal(streamingSource.revokeUrl, false)
  await contextModule.resolveReviewSource({
    source_id: 'streaming-source',
    sentence: 'appeared in court',
  }, {
    client: streamingClient,
  })
  assert.equal(
    streamingTranscriptRequests,
    1,
    'words from the same article should reuse the parsed transcript',
  )

  const timeoutStartedAt = Date.now()
  const timedOutSource = await contextModule.resolveReviewSource({
    source_id: 'stuck-source',
    sentence: 'This request never settles.',
  }, {
    timeoutMs: 50,
    client: {
      async getFile() {
        return new Promise(() => {})
      },
    },
  })
  assert.equal(timedOutSource, null, 'a stuck transcript request should fall back to stored context')
  assert.ok(Date.now() - timeoutStartedAt < 500, 'source timeout should be bounded')

  assert.equal(
    layoutModule.calculateSingleLineFontSize({
      availableWidth: 420,
      naturalWidth: 840,
      currentFontSize: 72,
    }),
    35,
    'long words should shrink to remain on one line',
  )
  assert.equal(
    layoutModule.calculateSingleLineFontSize({
      availableWidth: 420,
      naturalWidth: 300,
      currentFontSize: 72,
    }),
    null,
    'short words should keep the normal display size',
  )

  assert.equal(
    pronunciationModule.pickAmericanPronunciationUrl([{
      phonetics: [
        { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/court-au.mp3' },
        { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/court-us.mp3' },
      ],
    }]),
    'https://api.dictionaryapi.dev/media/pronunciations/en/court-us.mp3',
    'American pronunciation should be preferred over other regional recordings',
  )
  assert.equal(
    pronunciationModule.pickAmericanPronunciationUrl([{
      phonetics: [{ audio: '//ssl.gstatic.com/dictionary/static/sounds/word_gb_1.mp3' }],
    }]),
    '',
    'a British-only recording should fall back to an en-US system voice',
  )
  let pronunciationRequests = 0
  assert.equal(
    await pronunciationModule.resolveAmericanPronunciation('sample-american-word', {
      async merriamFetchImpl() {
        pronunciationRequests += 1
        return {
          ok: true,
          async json() {
            return {
              audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/sample01.mp3',
            }
          },
        }
      },
    }),
    'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/sample01.mp3',
  )
  await pronunciationModule.resolveAmericanPronunciation('sample-american-word', {
    async merriamFetchImpl() {
      pronunciationRequests += 1
      throw new Error('cached pronunciation should not refetch')
    },
  })
  assert.equal(pronunciationRequests, 1, 'pronunciation lookup should be cached per word')

  const phraseMerriamCalls = []
  assert.deepEqual(
    await pronunciationModule.resolveAmericanPronunciationSequence('brief court hearing', {
      async merriamFetchImpl(url, init) {
        phraseMerriamCalls.push([url, init?.method || 'GET', init?.body ? JSON.parse(init.body) : null])
        if (!init?.method) return { ok: false, async json() { return {} } }
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  word: 'brief',
                  audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/b/brief001.mp3',
                },
                {
                  word: 'court',
                  audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/c/court001.mp3',
                },
                {
                  word: 'hearing',
                  audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hearin01.mp3',
                },
              ],
            }
          },
        }
      },
      async edgeFetchImpl() {
        throw new Error('Edge TTS should not run when every phrase token has Merriam audio')
      },
    }),
    [
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/b/brief001.mp3',
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/c/court001.mp3',
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hearin01.mp3',
    ],
    'short phrases should play Merriam recordings token by token before Edge TTS',
  )
  assert.deepEqual(phraseMerriamCalls, [
    [
      'http://127.0.0.1:8765/api/dictionary/pronunciation?word=brief%20court%20hearing',
      'GET',
      null,
    ],
    [
      'http://127.0.0.1:8765/api/dictionary/pronunciations',
      'POST',
      { words: ['brief', 'court', 'hearing'] },
    ],
  ])

  const edgeAudioId = 'a'.repeat(64)
  assert.equal(
    await pronunciationModule.resolveAmericanPronunciation('edge-neural-fallback-word', {
      async merriamFetchImpl() {
        return { ok: false, async json() { return {} } }
      },
      async edgeFetchImpl(url) {
        assert.equal(url, 'http://127.0.0.1:8765/api/tts/edge')
        return {
          ok: true,
          async json() {
            return { audioUrl: `/api/tts/edge/audio/${edgeAudioId}.mp3`, voice: 'en-US-AvaNeural' }
          },
        }
      },
      async fetchImpl() {
        throw new Error('free dictionary fallback should not run when Edge TTS succeeds')
      },
    }),
    `http://127.0.0.1:8765/api/tts/edge/audio/${edgeAudioId}.mp3`,
    'Edge neural speech should be used before browser speech when recorded audio is unavailable',
  )

  assert.equal(
    await pronunciationModule.resolveAmericanPronunciation('fallback-american-word', {
      async merriamFetchImpl() {
        return { ok: false, async json() { return {} } }
      },
      async edgeFetchImpl() {
        return { ok: false, async json() { return {} } }
      },
      async fetchImpl() {
        return {
          ok: true,
          async json() {
            return [{
              phonetics: [{
                audio: '//api.dictionaryapi.dev/media/pronunciations/en/fallback-american-word-us.mp3',
              }],
            }]
          },
        }
      },
    }),
    'https://api.dictionaryapi.dev/media/pronunciations/en/fallback-american-word-us.mp3',
    'free dictionary audio should remain available when the local Merriam service is offline',
  )

  const prefetchedEdgeId = 'c'.repeat(64)
  const prefetchCalls = []
  assert.deepEqual(
    await pronunciationModule.prefetchAmericanPronunciations(
      ['prefetchedword', 'appeared in test court'],
      {
        async merriamFetchImpl(url, init) {
          prefetchCalls.push(['merriam', url, JSON.parse(init.body)])
          return {
            ok: true,
            async json() {
              return {
                items: [{
                  word: 'prefetchedword',
                  audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/p/prefetch01.mp3',
                }],
              }
            },
          }
        },
        async edgeFetchImpl(url, init) {
          prefetchCalls.push(['edge', url, JSON.parse(init.body)])
          return {
            ok: true,
            async json() {
              return {
                items: [{
                  text: 'appeared in test court',
                  audioUrl: `/api/tts/edge/audio/${prefetchedEdgeId}.mp3`,
                }],
              }
            },
          }
        },
      },
    ),
    { requested: 2, resolved: 2 },
    'review startup should batch recorded lookups, then batch Edge TTS for unresolved words and phrases',
  )
  assert.deepEqual(prefetchCalls, [
    [
      'merriam',
      'http://127.0.0.1:8765/api/dictionary/pronunciations',
      { words: ['prefetchedword'] },
    ],
    [
      'edge',
      'http://127.0.0.1:8765/api/tts/edge/batch',
      { texts: ['appeared in test court'] },
    ],
  ])
  assert.equal(
    await pronunciationModule.resolveAmericanPronunciation('appeared in test court', {
      async fetchImpl() {
        throw new Error('prefetched Edge TTS pronunciation should not refetch')
      },
    }),
    `http://127.0.0.1:8765/api/tts/edge/audio/${prefetchedEdgeId}.mp3`,
  )

  const playbackOrder = []
  assert.equal(
    await playbackModule.runReviewPlaybackSequence({
      async playWord() { playbackOrder.push('word') },
      async playSentence() { playbackOrder.push('sentence') },
    }),
    true,
  )
  assert.deepEqual(
    playbackOrder,
    ['word', 'sentence'],
    'the next review item should play its word before its source sentence',
  )

  let currentPlayback = true
  const canceledPlaybackOrder = []
  assert.equal(
    await playbackModule.runReviewPlaybackSequence({
      isCurrent() { return currentPlayback },
      async playWord() {
        canceledPlaybackOrder.push('word')
        currentPlayback = false
      },
      async playSentence() { canceledPlaybackOrder.push('sentence') },
    }),
    false,
  )
  assert.deepEqual(canceledPlaybackOrder, ['word'], 'stale review playback should not start its sentence')
  assert.equal(playbackModule.getReviewNavigationDelta('ArrowLeft'), -1)
  assert.equal(playbackModule.getReviewNavigationDelta('ArrowUp'), -1)
  assert.equal(playbackModule.getReviewNavigationDelta('ArrowRight'), 1)
  assert.equal(playbackModule.getReviewNavigationDelta('ArrowDown'), 1)
  assert.equal(playbackModule.getReviewNavigationDelta('Space'), 0)
  assert.equal(playbackModule.isPlaybackPauseKey({ key: ' ', code: 'Space' }), true)
  assert.equal(playbackModule.isPlaybackPauseKey({ key: '5', code: 'Digit5' }), false)
  assert.equal(playbackModule.isReviewReplayKey({ key: 'r' }), true)
  assert.equal(playbackModule.isReviewReplayKey({ key: 'R' }), true)
  assert.equal(playbackModule.isReviewReplayKey({ key: ' ' }), false)
  assert.equal(playbackModule.isReviewReplayKey({ key: 'k' }, 'K'), true)
  assert.equal(playbackModule.isReviewReplayKey({ key: 'K' }, 'k'), true)
  assert.equal(playbackModule.normalizeReviewReplayShortcut('Q'), 'q')
  assert.equal(playbackModule.normalizeReviewReplayShortcut('3'), '')
  assert.equal(playbackModule.normalizeReviewReplayShortcut(' '), '')

  let releaseSlowSource
  const slowSource = new Promise((resolve) => { releaseSlowSource = resolve })
  const slowSourceOrder = []
  const slowSourcePlayback = playbackModule.runReviewPlaybackSequence({
    async playWord() { slowSourceOrder.push('word') },
    async playSentence() {
      await slowSource
      slowSourceOrder.push('sentence')
    },
  })
  await Promise.resolve()
  assert.deepEqual(
    slowSourceOrder,
    ['word'],
    'a slow source lookup must not delay the next word pronunciation',
  )
  releaseSlowSource()
  assert.equal(await slowSourcePlayback, true)
  assert.deepEqual(slowSourceOrder, ['word', 'sentence'])

  const diversified = queueModule.diversifyReviewQueue([
    createQueueEntry('a-1', 'article-a', 'sentence-a-1'),
    createQueueEntry('a-2', 'article-a', 'sentence-a-1'),
    createQueueEntry('a-3', 'article-a', 'sentence-a-2'),
    createQueueEntry('b-1', 'article-b', 'sentence-b-1'),
    createQueueEntry('b-2', 'article-b', 'sentence-b-2'),
  ])
  assert.deepEqual(
    diversified.map((entry) => entry.word.id),
    ['a-1', 'b-1', 'a-3', 'b-2', 'a-2'],
    'review queue should round-robin articles and sentences while preserving bucket order',
  )

  console.log('SRS review check passed')
}

function createSyntheticSnapshot(now) {
  const words = ['again-word', 'hard-word', 'good-word', 'easy-word', 'mastered-word'].map((word, index) => ({
    id: `word-${index + 1}`,
    word,
    lemma: word,
    lookup_key: word,
    entry_type: 'word',
    language: 'en',
    meaning: `meaning-${index + 1}`,
    status: 'new',
    tags: [],
    created_at: now,
    updated_at: now,
  }))
  return {
    schemaVersion: 1,
    words,
    contexts: words.map((word, index) => ({
      id: `context-${index + 1}`,
      word_id: word.id,
      sentence: `A sentence with ${word.word}.`,
      surrounding_text: `Before. A sentence with ${word.word}. After.`,
      created_at: now,
    })),
    reviewStates: words.map((word, index) => ({
      word_id: word.id,
      due_at: `2020-01-0${index + 1}T00:00:00.000Z`,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      last_review_at: null,
      learning_steps: 0,
    })),
    reviewLogs: [],
  }
}

function createDueEntry(id) {
  return {
    word: { id, word: id, meaning: id, language: 'en' },
    reviewState: { word_id: id, due_at: '2020-01-01T00:00:00.000Z' },
    contexts: [],
  }
}

function createQueueEntry(id, sourceId, sentence) {
  return {
    word: { id, word: id },
    contexts: [{
      source_id: sourceId,
      sentence,
      created_at: '2026-07-23T00:00:00.000Z',
    }],
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
