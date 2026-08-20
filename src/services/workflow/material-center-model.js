const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

const ACTIVE_TASK_STATUSES = new Set([
  'queued',
  'downloading',
  'transcribing',
  'segmenting',
  'translating',
  'validating',
])

function text(value) {
  return String(value || '').trim()
}

function jobUrl(job) {
  return text(job && (job.url || job.request?.url))
}

function validYoutubeVideoId(value) {
  const id = text(value)
  return /^[A-Za-z0-9_-]{6,32}$/u.test(id) ? id : ''
}

export function extractYoutubeVideoId(value) {
  const raw = text(value)
  if (!raw) return ''
  let url
  try {
    url = new URL(raw)
  } catch (_error) {
    return ''
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (!YOUTUBE_HOSTS.has(host)) return ''
  if (host.endsWith('youtu.be')) {
    return validYoutubeVideoId(url.pathname.split('/').filter(Boolean)[0])
  }
  const queryId = validYoutubeVideoId(url.searchParams.get('v'))
  if (queryId) return queryId
  const parts = url.pathname.split('/').filter(Boolean)
  if (['shorts', 'embed', 'live'].includes(parts[0])) {
    return validYoutubeVideoId(parts[1])
  }
  return ''
}

export function canonicalMaterialKey(value) {
  const youtubeId = extractYoutubeVideoId(value)
  if (youtubeId) return `youtube:${youtubeId}`
  const raw = text(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    const ordered = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
    url.search = ''
    ordered.forEach(([key, item]) => url.searchParams.append(key, item))
    return `url:${url.href.replace(/\/$/u, '')}`
  } catch (_error) {
    return `text:${raw.toLowerCase()}`
  }
}

export function taskStatusKind(job) {
  const status = text(job && job.status).toLowerCase()
  if (ACTIVE_TASK_STATUSES.has(status)) return 'active'
  if (status === 'failed') return 'failed'
  return 'hidden'
}

function taskTimestamp(job) {
  return Date.parse(job?.updatedAt || job?.finishedAt || job?.createdAt || 0) || 0
}

export function groupTaskAttempts(jobs = []) {
  const groups = new Map()
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const kind = taskStatusKind(job)
    const status = text(job?.status).toLowerCase()
    const successful = ['ready', 'completed', 'finished'].includes(status)
    if (kind === 'hidden' && !successful) continue
    const key = canonicalMaterialKey(jobUrl(job)) || `job:${text(job?.jobId)}`
    const group = groups.get(key) || { key, attempts: [], active: null, latest: null, latestSuccessful: null }
    if (kind !== 'hidden') group.attempts.push(job)
    if (kind === 'active' && (!group.active || taskTimestamp(job) > taskTimestamp(group.active))) {
      group.active = job
    }
    if (successful && (!group.latestSuccessful || taskTimestamp(job) > taskTimestamp(group.latestSuccessful))) {
      group.latestSuccessful = job
    }
    if (!group.latest || taskTimestamp(job) > taskTimestamp(group.latest)) group.latest = job
    groups.set(key, group)
  }
  return [...groups.values()]
    .filter((group) => {
      if (group.active) return true
      if (!group.attempts.length) return false
      return !group.latestSuccessful || taskTimestamp(group.latest) > taskTimestamp(group.latestSuccessful)
    })
    .map((group) => {
      group.attempts.sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
      return {
        ...group,
        displayJob: group.active || group.latest,
        statusKind: group.active ? 'active' : 'failed',
        attemptCount: group.attempts.length,
      }
    })
    .sort((left, right) => taskTimestamp(right.displayJob) - taskTimestamp(left.displayJob))
}

export function materialTimestamp(item) {
  return Date.parse(item?.lastActivityAt || item?.lastOpenedAt || item?.finishedAt || item?.createdAt || 0) || 0
}

export function filterLibraryByTime(items = [], scope = 'all', nowValue = Date.now()) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  const now = Number(nowValue) || Date.now()
  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    if (scope === 'all') return true
    const age = now - materialTimestamp(item)
    if (!Number.isFinite(age)) return scope === 'earlier'
    if (scope === 'recent') return age >= 0 && age <= sevenDays
    if (scope === 'earlier') return age > sevenDays
    return true
  })
  return filtered.sort((left, right) => materialTimestamp(right) - materialTimestamp(left))
}

export function findDuplicateMaterial(url, jobs = [], library = []) {
  const key = canonicalMaterialKey(url)
  if (!key) return null
  const candidates = [...(Array.isArray(jobs) ? jobs : []), ...(Array.isArray(library) ? library : [])]
  const matches = candidates.filter((item) => canonicalMaterialKey(jobUrl(item)) === key)
  if (!matches.length) return null
  matches.sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
  const active = matches.find((item) => taskStatusKind(item) === 'active')
  const failed = matches.find((item) => text(item?.status).toLowerCase() === 'failed')
  const ready = matches.find((item) => ['ready', 'completed', 'finished', ''].includes(text(item?.status).toLowerCase()))
  return {
    key,
    youtubeVideoId: extractYoutubeVideoId(url),
    job: active || ready || failed || matches[0],
    state: active ? 'active' : ready ? 'ready' : failed ? 'failed' : 'existing',
    matches,
  }
}

export function exactDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
