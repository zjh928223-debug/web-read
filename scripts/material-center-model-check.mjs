import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const failureSource = fs.readFileSync(fileURLToPath(new URL('../src/services/workflow/task-failure.js', import.meta.url)), 'utf8')
const { taskFailureStage, taskFailureSummary, taskFailureDetails } = await import(`data:text/javascript;base64,${Buffer.from(failureSource).toString('base64')}`)

const source = fs.readFileSync(fileURLToPath(new URL('../src/services/workflow/material-center-model.js', import.meta.url)), 'utf8')
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
const {
  canonicalMaterialKey,
  extractYoutubeVideoId,
  filterLibraryByTime,
  findDuplicateMaterial,
  groupTaskAttempts,
} = await import(moduleUrl)

assert.equal(extractYoutubeVideoId('https://youtu.be/AbCdEf12345?t=20'), 'AbCdEf12345')
assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=AbCdEf12345&feature=share'), 'AbCdEf12345')
assert.equal(extractYoutubeVideoId('https://m.youtube.com/shorts/AbCdEf12345'), 'AbCdEf12345')
assert.equal(canonicalMaterialKey('https://www.youtube.com/embed/AbCdEf12345'), 'youtube:AbCdEf12345')

const jobs = [
  {
    jobId: 'failed-old',
    status: 'failed',
    updatedAt: '2026-08-10T10:00:00.000Z',
    request: { url: 'https://youtu.be/AbCdEf12345' },
  },
  {
    jobId: 'failed-new',
    status: 'failed',
    updatedAt: '2026-08-11T10:00:00.000Z',
    request: { url: 'https://www.youtube.com/watch?v=AbCdEf12345' },
  },
  {
    jobId: 'active',
    status: 'translating',
    updatedAt: '2026-08-12T10:00:00.000Z',
    request: { url: 'https://www.youtube.com/shorts/Another1234' },
  },
  {
    jobId: 'ready-hidden',
    status: 'ready',
    updatedAt: '2026-08-13T10:00:00.000Z',
    request: { url: 'https://youtu.be/ReadyVid123' },
  },
]

const groups = groupTaskAttempts(jobs)
assert.equal(groups.length, 2)
assert.equal(groups.find((group) => group.key === 'youtube:AbCdEf12345').attemptCount, 2)
assert.equal(groups.find((group) => group.key === 'youtube:Another1234').statusKind, 'active')
const speechGroups = groupTaskAttempts([{ jobId: 'article-speech', status: 'synthesizing', sourceType: 'text-only' }])
assert.equal(speechGroups.length, 1, 'speech generation must remain visible in the task queue')
assert.equal(speechGroups[0].statusKind, 'active', 'speech generation must keep polling and cancellation active')

const duplicate = findDuplicateMaterial('https://youtube.com/live/AbCdEf12345', jobs, [])
assert.equal(duplicate.state, 'failed')
assert.equal(duplicate.job.jobId, 'failed-new')

const now = Date.parse('2026-08-18T12:00:00.000Z')
const library = [
  { jobId: 'older', finishedAt: '2026-07-01T12:00:00.000Z' },
  { jobId: 'recent', lastActivityAt: '2026-08-17T12:00:00.000Z' },
  { jobId: 'newest', finishedAt: '2026-08-18T11:00:00.000Z' },
]
assert.deepEqual(filterLibraryByTime(library, 'all', now).map((item) => item.jobId), ['newest', 'recent', 'older'])
assert.deepEqual(filterLibraryByTime(library, 'recent', now).map((item) => item.jobId), ['newest', 'recent'])
assert.deepEqual(filterLibraryByTime(library, 'earlier', now).map((item) => item.jobId), ['older'])

const busyError = "503 UNAVAILABLE. {'error': {'code': 503, 'message': 'This model is currently experiencing high demand. Please try again later.', 'status': 'UNAVAILABLE'}}"
const failedJob = {
  jobId: 'failed-model', status: 'failed', stage: 'failed',
  request: { model: 'gemini-3.1-flash-lite', geminiMode: 'real', url: 'https://youtu.be/AbCdEf12345' },
  error: { category: 'unknown', message: busyError },
  logSummary: ['开始生成 output.json。Gemini 模式: real', '主任务：正在等待 Gemini 返回结果。', busyError],
}
assert.equal(taskFailureStage(failedJob), 'AI 切分与翻译')
assert.equal(taskFailureSummary(failedJob), 'AI 切分与翻译失败：模型服务繁忙，请稍后重试。')
assert.ok(taskFailureDetails(failedJob).includes(busyError), 'original provider error must remain complete')
assert.ok(taskFailureDetails(failedJob).includes(failedJob.logSummary.join('\n')), 'retain every available log line')
assert.match(taskFailureDetails(failedJob), /gemini-3.1-flash-lite/)
assert.equal(taskFailureStage({ stage: 'failed', manifest: { checkpoint: { lastStage: 'transcribing' } } }), '生成字幕')
assert.match(taskFailureSummary({ error: { message: 'unexpected error' } }), /阶段未记录/)
assert.match(taskFailureSummary({ stage: 'transcribing', error: { message: '503 UNAVAILABLE' } }), /^生成字幕失败：服务暂时不可用/)
assert.match(taskFailureSummary({ error: { category: 'youtube', code: 'YOUTUBE_MEDIA_HTTP_403' } }), /下载素材失败：YouTube 媒体授权失败/)
assert.match(taskFailureSummary({ stage: 'translating', error: { message: '429 RESOURCE_EXHAUSTED' } }), /请求频率或额度受限/)
assert.match(taskFailureSummary({ stage: 'translating', error: { message: '403 PERMISSION_DENIED' } }), /鉴权失败/)
assert.match(taskFailureSummary({ stage: 'translating', error: { message: 'request timed out' } }), /超时/)
assert.match(taskFailureSummary({ stage: 'translating', error: { message: 'AI response was invalid' } }), /返回内容格式异常/)
assert.match(taskFailureSummary({ error: { message: '<script>alert(1)</script>' } }), /展开详情/)
console.log('material center model and task failure summaries check passed')
