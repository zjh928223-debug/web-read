const STAGES = {
  downloading: '下载素材',
  transcribing: '生成字幕',
  segmenting: 'AI 切分与翻译',
  translating: 'AI 切分与翻译',
  synthesizing: '生成语音',
  validating: '校验与保存',
}

function recordedLogs(job) {
  const logs = job?.logSummary || job?.terminalSummary || []
  return Array.isArray(logs) ? logs.map(String) : []
}

export function taskFailureStage(job) {
  const stage = job?.error?.stage || job?.stage
  if (STAGES[stage]) return STAGES[stage]
  const checkpoint = job?.checkpoint || job?.manifest?.checkpoint
  if (STAGES[checkpoint?.lastStage]) return STAGES[checkpoint.lastStage]
  // Terminal status often replaces the stage; use the latest recorded activity.
  for (const line of recordedLogs(job).slice().reverse()) {
    if (/Gemini|AI 切分|input\.json|output\.json/iu.test(line)) return STAGES.translating
    if (/Aria|语音|edge-tts/iu.test(line)) return STAGES.synthesizing
    if (/WhisperX|转写|生成字幕/iu.test(line)) return STAGES.transcribing
    if (/yt-dlp|正在下载|download video data/iu.test(line)) return STAGES.downloading
    if (/正在保存|正在校验/iu.test(line)) return STAGES.validating
  }
  const error = job?.error || {}
  return { youtube: STAGES.downloading, whisperx: STAGES.transcribing, gemini: STAGES.translating, output: STAGES.validating }[error.category]
    || (/YOUTUBE_/u.test(error.code || '') ? STAGES.downloading : '阶段未记录')
}

export function taskFailureSummary(job) {
  const error = job?.error || {}
  const stage = taskFailureStage(job)
  const diagnostic = [error.code, error.message, ...recordedLogs(job)].filter(Boolean).join('\n')
  const reason = String(error.message || error.code || '')
  let summary = '处理未完成，请展开详情查看原因。'
  if (error.code === 'YOUTUBE_MEDIA_HTTP_403' || (/\b403\b|forbidden/iu.test(diagnostic) && /youtube|yt-dlp|download video data/iu.test(diagnostic))) {
    summary = 'YouTube 媒体授权失败（HTTP 403），请重新处理。'
  } else if (/\b503\b|UNAVAILABLE|high demand|overloaded/iu.test(reason)) {
    summary = stage === STAGES.translating ? '模型服务繁忙，请稍后重试。' : '服务暂时不可用，请稍后重试。'
  } else if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/iu.test(reason)) {
    summary = '请求频率或额度受限，请稍后重试或检查 API 额度。'
  } else if (/\b401\b|\b403\b|API_KEY_INVALID|PERMISSION_DENIED|invalid api.?key/iu.test(reason)) {
    summary = '服务鉴权失败，请检查密钥和访问权限。'
  } else if (/timeout|timed out|超时/iu.test(reason)) {
    summary = '等待服务响应超时，请稍后重试。'
  } else if (/network|connection|connecterror|proxy|网络|连接/iu.test(reason)) {
    summary = '服务连接失败，请检查网络或代理后重试。'
  } else if (/invalid.*(response|json)|(response|json).*(invalid|decode)|返回.*格式|响应.*格式/iu.test(reason)) {
    summary = '返回内容格式异常，请重试；具体原因见详情。'
  }
  return `${stage === '阶段未记录' ? '处理失败（阶段未记录）' : `${stage}失败`}：${summary}`
}

export function taskFailureDetails(job) {
  const request = job?.request || {}
  const error = job?.error || {}
  const mode = request.geminiMode || request.gemini_mode || ''
  const lines = [
    `失败阶段：${taskFailureStage(job)}`,
    `任务编号：${job?.jobId || '未记录'}`,
    `来源：${request.url || job?.url || job?.sourcePath || '未记录'}`,
    `时间：${job?.updatedAt || job?.finishedAt || job?.createdAt || '未记录'}`,
    `任务请求模型：${request.model || '未记录'}`,
    `请求模式：${{ real: '真实模式', mock: '开发模拟', off: '未调用远程模型' }[mode] || mode || '未记录'}`,
    `错误分类：${error.category || '未记录'}`,
  ]
  if (error.code) lines.push(`错误代码：${error.code}`)
  lines.push('', '完整错误：', String(error.message || (typeof job?.error === 'string' ? job.error : '未记录错误内容')))
  const logs = recordedLogs(job)
  if (logs.length) lines.push('', '已记录的处理日志：', ...logs)
  return lines.join('\n')
}
