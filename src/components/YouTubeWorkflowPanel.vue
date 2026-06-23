<template>
  <Teleport to=".controls">
    <div class="youtube-reader-controls">
      <button type="button" class="small-btn" @click="openPanel">素材处理</button>
      <button type="button" class="small-btn" :disabled="!canGoPrevious" @click="goQueue(-1)">上一篇</button>
      <button type="button" class="small-btn" :disabled="!canUseNext" @click="goQueue(1)">下一篇</button>
    </div>
  </Teleport>

  <div class="youtube-workflow">
    <div v-if="panelOpen" class="youtube-workflow-backdrop" @pointerdown.self="handleBackdropPointerDown">
      <section class="youtube-workflow-panel" :style="panelStyle" role="dialog" aria-label="素材处理" @pointerdown.stop>
        <header class="youtube-workflow-header" @pointerdown="startPanelDrag">
          <div>
            <h2>素材处理</h2>
            <p :class="['youtube-workflow-health', serviceOnline ? 'online' : 'offline']">
              {{ serviceOnline ? '后台服务已连接' : '后台服务未启动' }}
            </p>
          </div>
          <div class="youtube-window-actions">
            <button type="button" class="youtube-workflow-icon-btn" aria-label="缩小" title="缩小" @click="shrinkPanel">-</button>
            <button type="button" class="youtube-workflow-icon-btn" aria-label="关闭" title="关闭" @click="closePanel">x</button>
          </div>
        </header>

        <div v-if="!serviceOnline" class="youtube-workflow-alert">
          <strong>后台服务未启动</strong>
          <span>启动命令：python -m uvicorn youtube_workflow.service:app --host 127.0.0.1 --port 8765</span>
        </div>

        <form class="youtube-workflow-form" @submit.prevent="enqueueUrls">
          <label class="youtube-material-link-label">
            <span>素材链接</span>
            <input
              v-model.trim="linkInput"
              class="youtube-material-link-input"
              type="url"
              placeholder="粘贴一个或多个 http/https 视频素材链接"
              @keydown.enter.prevent="commitLinkInput"
              @paste="handleLinkPaste"
              @blur="commitLinkInput"
            >
          </label>

          <div class="youtube-link-card-list">
            <article v-for="(card, index) in linkCards" :key="card.id" class="youtube-link-card" :data-valid="card.valid">
              <span class="youtube-link-index">{{ index + 1 }}</span>
              <span class="youtube-link-status">{{ card.valid ? '✓' : '!' }}</span>
              <div class="youtube-link-main">
                <small class="youtube-link-state-text">{{ card.valid ? '格式有效' : '链接格式无效' }}</small>
                <strong>{{ shortUrl(card.url) }}</strong>
              </div>
              <button type="button" class="small-btn" @click="copyLink(card.url)">复制</button>
              <button type="button" class="small-btn" @click="removeLinkCard(card.id)">删除</button>
            </article>
          </div>

          <p v-if="invalidLinkCards.length" class="youtube-workflow-hint">
            已跳过 {{ invalidLinkCards.length }} 条格式无效链接。
          </p>
          <p v-if="linkNotice" class="youtube-workflow-hint" data-tone="warning">
            {{ linkNotice }}
          </p>

          <label v-if="geminiMode === 'real'">
            <span>Gemini API key</span>
            <input v-model="apiKey" type="password" autocomplete="off" placeholder="仅提交到本地服务内存，不保存">
          </label>

          <label>
            <span>模型</span>
            <input v-model.trim="model" type="text" placeholder="gemini-2.5-flash">
          </label>

          <button type="button" class="youtube-advanced-toggle" @click="showAdvanced = !showAdvanced">
            高级设置
          </button>

          <div v-if="showAdvanced" class="youtube-advanced-settings">
            <label>
              <span>Base URL（可选，使用代理网关时填写）</span>
              <input v-model.trim="baseUrl" type="text" placeholder="留空使用官方默认地址">
            </label>
            <p>普通 Gemini 官方 API 留空即可。</p>
          </div>

          <label class="youtube-workflow-check">
            <input v-model="showFloatingAfterClose" type="checkbox">
            <span>显示任务浮标</span>
          </label>

          <div class="youtube-primary-actions">
            <button type="submit" :disabled="starting || !canEnqueue">
              <span>{{ primaryActionText }}</span>
            </button>
            <span v-if="geminiMode === 'real' && !apiKey.trim()" class="youtube-workflow-hint">需要填写 Gemini API key</span>
            <span v-else-if="!validLinkCards.length" class="youtube-workflow-hint">暂无可处理素材</span>
          </div>
        </form>

        <section class="youtube-workflow-queue">
          <div class="youtube-workflow-summary">
            <strong>素材队列</strong>
            <span>{{ queueSummary }}</span>
            <button type="button" class="small-btn" @click="refreshQueue">刷新</button>
          </div>

          <div v-if="!queueJobs.length" class="youtube-workflow-empty">暂无任务</div>

          <article
            v-for="(job, index) in queueJobs"
            :key="job.jobId"
            class="youtube-workflow-job"
            :data-status="job.status"
            :data-active="isActiveJob(job) ? 'true' : 'false'"
          >
            <div class="youtube-workflow-job-main">
              <div class="youtube-job-status-line">
                <span class="youtube-job-status-badge">{{ statusText(job) }}</span>
                <span class="youtube-job-position">{{ index + 1 }} / {{ queueJobs.length }}</span>
              </div>
              <strong class="youtube-job-title">{{ job.title || shortUrl(job.request && job.request.url) || job.jobId }}</strong>
              <small v-if="job.status === 'ready'">{{ readyJobMetaText(job) }}</small>
              <small v-if="job.error" class="youtube-workflow-error">{{ errorLabel(job.error.category) }}：{{ job.error.message }}</small>
              <div v-if="isActiveJob(job)" class="youtube-job-log" aria-label="运行日志">
                <div class="youtube-job-log-title">当前过程</div>
                <ul>
                  <li v-for="line in jobLogLines(job)" :key="line">{{ line }}</li>
                </ul>
              </div>
            </div>
            <div class="youtube-workflow-job-actions">
              <button
                v-if="job.status === 'ready'"
                type="button"
                class="small-btn primary"
                :disabled="job.jobId === currentJobId"
                @click="openJob(job)"
              >
                {{ openJobActionText(job) }}
              </button>
              <button v-if="job.status === 'queued'" type="button" class="small-btn" @click="prioritizeJob(job)">优先处理</button>
              <button v-if="job.status === 'failed'" type="button" class="small-btn" @click="redoJob(job)">优先重做</button>
              <button v-if="!terminalStatuses.has(job.status)" type="button" class="small-btn" @click="cancelJob(job)">取消</button>
            </div>
          </article>

          <div class="youtube-secondary-actions">
            <button type="button" class="small-btn" @click="showCancelRecords">查看取消记录</button>
            <span v-if="cancelRecordsNotice" class="youtube-workflow-hint">{{ cancelRecordsNotice }}</span>
          </div>
        </section>

        <div v-if="cancelRecordsOpen" class="youtube-subwindow">
          <div class="youtube-subwindow-card">
            <header>
              <strong>取消记录</strong>
              <button type="button" class="youtube-workflow-icon-btn" @click="cancelRecordsOpen = false">x</button>
            </header>
            <p v-if="!canceledJobs.length">没有取消记录。</p>
            <ul v-else>
              <li v-for="job in canceledJobs" :key="job.jobId">{{ shortUrl(job.request && job.request.url) || job.jobId }}</li>
            </ul>
            <button type="button" class="small-btn" :disabled="!canceledJobs.length" @click="confirmClearCanceled">清空取消记录</button>
          </div>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <button
        v-if="materialFloatingVisible"
        type="button"
        class="youtube-material-float youtube-task-capsule"
        :class="{ 'is-dragging': capsuleDragging }"
        :data-edge="capsuleEdge"
        :style="capsuleStyle"
        @pointerenter="capsuleHovering = true"
        @pointerleave="capsuleHovering = false"
        @pointerdown.stop="startCapsuleDrag"
        @click="openFromCapsule"
      >
        <strong>{{ materialFloatTitle }}</strong>
        <span>{{ materialFloatStatus }}</span>
      </button>
    </Teleport>

    <div v-if="switchModal" class="youtube-switch-modal-backdrop" role="dialog" aria-modal="true">
      <section class="youtube-switch-modal">
        <h3>{{ switchModal.title }}</h3>
        <p v-if="switchModal.target">目标：{{ switchModal.target.title || shortUrl(switchModal.target.request && switchModal.target.request.url) }}</p>
        <p v-if="switchModal.queueText">队列：{{ switchModal.queueText }}</p>
        <p v-if="switchModal.currentText">当前文章：{{ switchModal.currentText }}</p>
        <p>{{ switchModal.message }}</p>
        <div class="youtube-workflow-actions">
          <button type="button" @click="confirmSwitch">{{ switchModal.confirmText }}</button>
          <button type="button" class="small-btn" @click="cancelSwitch">取消</button>
        </div>
      </section>
    </div>

    <div v-if="incompletePrompt" class="youtube-switch-modal-backdrop" role="dialog" aria-modal="true">
      <section class="youtube-switch-modal">
        <h3>当前阅读内容不完整</h3>
        <p>{{ incompletePrompt.message }}</p>
        <p>本地补处理放在 02；当前可以把阅读器视为空并打开队列文章。</p>
        <div class="youtube-workflow-actions">
          <button type="button" @click="openIncompleteTarget">打开队列文章</button>
          <button type="button" class="small-btn" @click="incompletePrompt = null">取消</button>
        </div>
      </section>
    </div>

    <div v-if="folderChoice" class="youtube-switch-modal-backdrop" role="dialog" aria-modal="true">
      <section class="youtube-switch-modal youtube-folder-choice">
        <h3>选择阅读文件</h3>
        <label>
          <span>音频</span>
          <select v-model="folderChoice.selectedAudio">
            <option v-for="item in folderChoice.audios" :key="item.name" :value="item.name">{{ item.name }}</option>
          </select>
        </label>
        <label>
          <span>Whisper 字幕</span>
          <select v-model="folderChoice.selectedTranscript">
            <option v-for="item in folderChoice.transcripts" :key="item.name" :value="item.name">{{ item.name }}</option>
          </select>
        </label>
        <label>
          <span>AI 切分</span>
          <select v-model="folderChoice.selectedChunk">
            <option value="">无</option>
            <option v-for="item in folderChoice.chunks" :key="item.name" :value="item.name">{{ item.name }}</option>
          </select>
        </label>
        <div class="youtube-workflow-actions">
          <button type="button" @click="confirmFolderChoice">打开</button>
          <button type="button" class="small-btn" @click="folderChoice = null">取消</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { youtubeWorkflowClient } from '../composables/youtube-workflow-client.js'
import { createYoutubeWorkflowLoader } from '../composables/youtube-workflow-loader.js'

const terminalStatuses = new Set(['ready', 'failed', 'canceled'])
const audioExtensions = new Set(['.mp3', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.aac', '.mp4', '.wmv'])
const FLOAT_SNAP_THRESHOLD = 96
const FLOAT_PEEK_WIDTH = 42
const DEFAULT_CAPSULE_SIZE = { width: 132, height: 48 }
const PANEL_MAX_SIZE = { width: 680, height: 720 }

const panelOpen = ref(false)
const panelShrunk = ref(false)
const serviceOnline = ref(false)
const linkInput = ref('')
const linkCards = ref([])
const linkNotice = ref('')
const apiKey = ref('')
const model = ref(loadTextSetting('youtubeWorkflow.model', 'gemini-2.5-flash'))
const baseUrl = ref(loadTextSetting('youtubeWorkflow.baseUrl', ''))
const showAdvanced = ref(false)
const starting = ref(false)
const queueJobs = ref([])
const showFloatingAfterClose = ref(false)
const cancelRecordsOpen = ref(false)
const cancelRecordsNotice = ref('')
const switchModal = ref(null)
const incompletePrompt = ref(null)
const folderChoice = ref(null)
const currentJobId = ref('')
const panelPosition = ref(getDefaultPanelPosition())
const capsulePosition = ref(clampPosition(loadPosition('youtubeWorkflowCapsulePosition', { x: 24, y: 540 }), DEFAULT_CAPSULE_SIZE.width, DEFAULT_CAPSULE_SIZE.height))
const capsuleDragging = ref(false)
const capsuleHovering = ref(false)
const playback = new Map()
const loadedReadyJobs = new Set()
let pollTimer = 0
let panelDrag = null
let capsuleDrag = null
let capsuleMoved = false
let linkSequence = 0

const geminiMode = computed(() => {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('workflowMode') || window.localStorage.getItem('youtubeWorkflow.devMode') || 'real'
  return ['mock', 'off'].includes(requested) ? requested : 'real'
})
const validLinkCards = computed(() => linkCards.value.filter((card) => card.valid))
const invalidLinkCards = computed(() => linkCards.value.filter((card) => !card.valid))
const canEnqueue = computed(() => validLinkCards.value.length > 0 && (geminiMode.value !== 'real' || !!apiKey.value.trim()))
const primaryActionText = computed(() => {
  if (starting.value) return '提交中...'
  if (validLinkCards.value.length) return `开始后台处理 ${validLinkCards.value.length} 条素材`
  return '暂无可处理素材'
})
const readyJobs = computed(() => queueJobs.value.filter((job) => job.status === 'ready'))
const canceledJobs = computed(() => queueJobs.value.filter((job) => job.status === 'canceled'))
const currentReadyIndex = computed(() => readyJobs.value.findIndex((job) => job.jobId === currentJobId.value))
const canGoPrevious = computed(() => readyJobs.value.length > 0 && currentReadyIndex.value > 0)
const canUseNext = computed(() => readyJobs.value.length > 0)
const queueSummary = computed(() => {
  const total = queueJobs.value.length
  const ready = readyJobs.value.length
  const running = queueJobs.value.filter((job) => !terminalStatuses.has(job.status)).length
  return `${total} 项 · ${running} 处理中/等待 · ${ready} 可打开`
})
const materialFloatingVisible = computed(() => {
  return showFloatingAfterClose.value
})
const materialFloatTitle = computed(() => {
  const total = queueJobs.value.length
  if (!total) return '素材'
  const activeIndex = queueJobs.value.findIndex((job) => !terminalStatuses.has(job.status))
  const current = activeIndex >= 0 ? activeIndex + 1 : total
  return `素材 ${current}/${total}`
})
const materialFloatStatus = computed(() => {
  if (!queueJobs.value.length) return '暂无任务'
  const failed = queueJobs.value.filter((job) => job.status === 'failed').length
  const ready = readyJobs.value.length
  const active = queueJobs.value.find((job) => !terminalStatuses.has(job.status))
  if (failed) return `${errorLabel(active && active.error && active.error.category)} · 可读 ${ready} · 失败 ${failed}`
  if (active) return `${statusText(active)} · 可读 ${ready} · 失败 0`
  return `可读 ${ready} · 失败 0`
})
const panelStyle = computed(() => ({ left: `${panelPosition.value.x}px`, top: `${panelPosition.value.y}px` }))
const capsuleStyle = computed(() => {
  const edge = capsuleEdge.value
  const canHide = !capsuleDragging.value && !capsuleHovering.value
  let left = capsulePosition.value.x
  if (canHide && edge === 'left') left = -(getCapsuleSize().width - FLOAT_PEEK_WIDTH)
  if (canHide && edge === 'right') left = getViewportSize().width - FLOAT_PEEK_WIDTH
  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${capsulePosition.value.y}px`,
    transform: 'none'
  }
})
const capsuleEdge = computed(() => getCapsuleEdge(capsulePosition.value, getCapsuleSize().width))

watch(model, (value) => saveTextSetting('youtubeWorkflow.model', value))
watch(baseUrl, (value) => saveTextSetting('youtubeWorkflow.baseUrl', value))
watch(materialFloatingVisible, async (visible) => {
  if (!visible) return
  await nextTick()
  correctCapsuleOverflow()
})

onMounted(() => {
  checkHealth()
  bindPlaybackTracking()
})

onBeforeUnmount(() => {
  stopPolling()
  unbindPlaybackTracking()
})

function makeLoader() {
  return createYoutubeWorkflowLoader({
    client: youtubeWorkflowClient,
    saveToDB: window.saveToDB,
    applyCurrentAudioMeta(meta) {
      if (window.__state) window.__state.currentAudioMeta = meta
    },
    processTranscript: window.processTranscript,
    processChunkData: window.processChunkData,
    switchSentenceNotesDoc: window.switchSentenceNotesDoc,
    audioPlayer: document.getElementById('audio-player'),
    validateTranscriptData: window.DataUtils && window.DataUtils.validateTranscriptData,
    validateChunkData: window.DataUtils && window.DataUtils.validateChunkData,
    resetChunkDisplay: resetChunkChineseDisplay,
    showToast: window.showToast
  })
}

async function checkHealth() {
  try {
    await youtubeWorkflowClient.health()
    serviceOnline.value = true
  } catch (_err) {
    serviceOnline.value = false
  }
}

function commitLinkInput() {
  const links = parseLinks(linkInput.value)
  if (!links.length) return
  addLinkCards(links)
  linkInput.value = ''
}

function handleLinkPaste(event) {
  const text = event.clipboardData && event.clipboardData.getData('text')
  const links = parseLinks(text)
  if (!links.length) return
  event.preventDefault()
  addLinkCards(links)
  linkInput.value = ''
}

function parseLinks(value) {
  return String(value || '')
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function addLinkCards(links) {
  const existing = existingMaterialKeys()
  const nextCards = []
  let duplicateCount = 0
  for (const url of links) {
    const valid = isValidMaterialUrl(url)
    const key = valid ? normalizeMaterialUrl(url) : ''
    if (valid && key && existing.has(key)) {
      duplicateCount += 1
      continue
    }
    if (valid && key) existing.add(key)
    nextCards.push({
      id: `link-${Date.now()}-${++linkSequence}`,
      url,
      valid
    })
  }
  if (nextCards.length) linkCards.value.push(...nextCards)
  linkNotice.value = duplicateCount ? `已忽略 ${duplicateCount} 条重复链接。` : ''
}

function isValidMaterialUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_err) {
    return false
  }
}

function normalizeMaterialUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    const params = Array.from(url.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right))
    url.search = ''
    for (const [key, val] of params) url.searchParams.append(key, val)
    return url.toString()
  } catch (_err) {
    return String(value || '').trim()
  }
}

function existingMaterialKeys() {
  const keys = new Set()
  for (const card of linkCards.value) {
    if (card.valid) keys.add(normalizeMaterialUrl(card.url))
  }
  for (const job of queueJobs.value) {
    const url = job && job.request && job.request.url
    if (url && isValidMaterialUrl(url)) keys.add(normalizeMaterialUrl(url))
  }
  return keys
}

function removeLinkCard(id) {
  linkCards.value = linkCards.value.filter((card) => card.id !== id)
  if (!linkCards.value.length) linkNotice.value = ''
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url)
  } catch (_err) {}
}

async function enqueueUrls() {
  commitLinkInput()
  const cards = validLinkCards.value
  if (!cards.length) return
  if (geminiMode.value === 'real' && !apiKey.value.trim()) return
  starting.value = true
  try {
    for (const card of cards) {
      const payload = {
        url: card.url,
        geminiMode: geminiMode.value,
        model: model.value,
        baseUrl: baseUrl.value,
        autoOpenWhenReady: false,
        replacePolicy: 'ask'
      }
      if (geminiMode.value === 'real') payload.apiKey = apiKey.value
      const job = await youtubeWorkflowClient.createJob(payload)
      queueJobs.value.push(job)
    }
    const submittedIds = new Set(cards.map((card) => card.id))
    linkCards.value = linkCards.value.filter((card) => !submittedIds.has(card.id))
    linkNotice.value = ''
    startPolling()
  } catch (err) {
    window.alert(err && err.message ? err.message : String(err))
  } finally {
    starting.value = false
  }
}

function openPanel(options = {}) {
  if (!options.preservePosition) panelPosition.value = getDefaultPanelPosition()
  panelOpen.value = true
  panelShrunk.value = false
  checkHealth()
  refreshQueue()
}

function shrinkPanel() {
  panelOpen.value = false
  panelShrunk.value = true
  cancelRecordsOpen.value = false
}

function closePanel() {
  panelOpen.value = false
  panelShrunk.value = false
  panelPosition.value = getDefaultPanelPosition()
  apiKey.value = ''
  cancelRecordsOpen.value = false
}

function handleBackdropPointerDown() {
  shrinkPanel()
}

async function refreshQueue() {
  await checkHealth()
  await Promise.all(queueJobs.value.map((job) => refreshJob(job.jobId)))
}

async function refreshJob(jobId) {
  try {
    const fresh = await youtubeWorkflowClient.getJob(jobId)
    updateJob(fresh)
  } catch (_err) {}
}

function updateJob(fresh) {
  const index = queueJobs.value.findIndex((job) => job.jobId === fresh.jobId)
  const previous = index >= 0 ? queueJobs.value[index] : null
  if (index >= 0) queueJobs.value[index] = fresh
  else queueJobs.value.push(fresh)
  if (fresh.status === 'ready' && previous && previous.status !== 'ready') {
    maybeAutoOpen(fresh)
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = window.setInterval(async () => {
    const active = queueJobs.value.filter((job) => !terminalStatuses.has(job.status))
    if (!active.length) {
      stopPolling()
      return
    }
    await Promise.all(active.map((job) => refreshJob(job.jobId)))
  }, 1000)
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = 0
}

async function maybeAutoOpen(job) {
  if (loadedReadyJobs.has(job.jobId)) return
  const state = getReaderContentState()
  if (state.kind === 'complete') return
  if (state.kind === 'audio-only') {
    incompletePrompt.value = { job, message: '当前只有音频，缺少 Whisper 字幕。' }
    return
  }
  if (state.kind === 'transcript-only') {
    incompletePrompt.value = { job, message: '当前只有字幕，缺少音频。' }
    return
  }
  await loadJob(job)
}

function getReaderContentState() {
  const audio = getAudio()
  const hasAudio = !!(audio && audio.src)
  const state = window.__state || {}
  const hasTranscript = Array.isArray(state.segments) && state.segments.length > 0
  if (hasAudio && hasTranscript) return { kind: 'complete' }
  if (hasAudio) return { kind: 'audio-only' }
  if (hasTranscript) return { kind: 'transcript-only' }
  return { kind: 'empty' }
}

function openJob(job) {
  const state = getReaderContentState()
  if (state.kind === 'complete') {
    requestSwitch(job, '打开这篇？')
  } else if (state.kind === 'audio-only') {
    incompletePrompt.value = { job, message: '当前只有音频，缺少 Whisper 字幕。' }
  } else if (state.kind === 'transcript-only') {
    incompletePrompt.value = { job, message: '当前只有字幕，缺少音频。' }
  } else {
    loadJob(job)
  }
}

function openIncompleteTarget() {
  const job = incompletePrompt.value && incompletePrompt.value.job
  incompletePrompt.value = null
  if (job) loadJob(job)
}

function requestSwitch(job, title) {
  const paused = pauseForDecision()
  const index = readyJobs.value.findIndex((item) => item.jobId === job.jobId)
  switchModal.value = {
    type: 'job',
    target: job,
    title,
    queueText: index >= 0 ? `${index + 1} / ${readyJobs.value.length}` : '',
    currentText: currentJobId.value ? listenText(queueJobs.value.find((item) => item.jobId === currentJobId.value)) : '未开始',
    message: '确认后会加载目标文章，当前播放会停止，新文章不会自动播放。',
    confirmText: '确认切换',
    wasPlaying: paused
  }
}

function goQueue(offset) {
  const items = readyJobs.value
  if (!items.length) return
  const index = currentReadyIndex.value
  const nextIndex = index < 0 ? (offset > 0 ? 0 : items.length - 1) : index + offset
  if (nextIndex < 0) return
  if (nextIndex >= items.length) {
    const paused = pauseForDecision()
    switchModal.value = {
      type: 'folder',
      title: '本次素材队列已经到最后一篇。',
      message: '是否选择本地文件夹加载新的阅读内容？',
      confirmText: '选择文件夹',
      wasPlaying: paused
    }
    return
  }
  requestSwitch(items[nextIndex], offset > 0 ? '切换到下一篇？' : '切换到上一篇？')
}

async function confirmSwitch() {
  const modal = switchModal.value
  switchModal.value = null
  if (!modal) return
  if (modal.type === 'folder') {
    await openFolderPicker()
    return
  }
  if (modal.target) await loadJob(modal.target)
}

function cancelSwitch() {
  const modal = switchModal.value
  switchModal.value = null
  if (modal && modal.wasPlaying) {
    const audio = getAudio()
    if (audio) audio.play().catch(() => {})
  }
}

function pauseForDecision() {
  const audio = getAudio()
  const wasPlaying = !!(audio && !audio.paused)
  if (audio && wasPlaying) audio.pause()
  return wasPlaying
}

async function loadJob(job) {
  try {
    await makeLoader().loadJobIntoReader(job.jobId, { replacePolicy: 'replace-current' })
    currentJobId.value = job.jobId
    loadedReadyJobs.add(job.jobId)
    const audio = getAudio()
    if (audio) audio.pause()
    hidePanelAfterLoad()
  } catch (err) {
    updateJob({
      ...job,
      status: 'failed',
      stage: 'failed',
      error: { category: 'output', message: err && err.message ? err.message : String(err) }
    })
  }
}

function hidePanelAfterLoad() {
  panelOpen.value = false
  panelShrunk.value = false
  cancelRecordsOpen.value = false
}

function isJobOpened(job) {
  return !!(job && (job.jobId === currentJobId.value || loadedReadyJobs.has(job.jobId)))
}

function isActiveJob(job) {
  if (!job) return false
  const active = queueJobs.value.find((item) => !terminalStatuses.has(item.status) && item.status !== 'queued')
    || queueJobs.value.find((item) => !terminalStatuses.has(item.status))
  return !!(active && active.jobId === job.jobId)
}

function jobLogLines(job) {
  const lines = Array.isArray(job && job.logSummary) ? job.logSummary : []
  const cleaned = lines.map((line) => String(line || '').trim()).filter(Boolean)
  if (!cleaned.length) return ['等待后台日志...']
  return cleaned.slice(-5)
}

function jobOpenStateText(job) {
  if (!job || job.status !== 'ready') return ''
  if (job.jobId === currentJobId.value) return '当前阅读中'
  if (loadedReadyJobs.has(job.jobId)) return '已打开'
  return ''
}

function readyJobMetaText(job) {
  const openState = jobOpenStateText(job)
  const progress = listenText(job)
  return openState ? `${openState} · ${progress}` : progress
}

function openJobActionText(job) {
  if (!job || job.status !== 'ready') return '打开这篇'
  if (job.jobId === currentJobId.value) return '当前阅读中'
  if (loadedReadyJobs.has(job.jobId)) return '重新打开'
  return '打开这篇'
}

async function cancelJob(job) {
  const canceled = await youtubeWorkflowClient.cancelJob(job.jobId)
  updateJob(canceled)
}

async function prioritizeJob(job) {
  const updated = await youtubeWorkflowClient.prioritizeJob(job.jobId)
  updateJob(updated)
}

async function redoJob(job) {
  const redone = await youtubeWorkflowClient.redoJob(job.jobId)
  queueJobs.value.push(redone)
  startPolling()
}

async function confirmClearCanceled() {
  if (!window.confirm('只清空取消记录，成功和失败任务会保留。继续吗？')) return
  await youtubeWorkflowClient.clearCanceledJobs()
  queueJobs.value = queueJobs.value.filter((job) => job.status !== 'canceled')
  cancelRecordsOpen.value = false
}

function showCancelRecords() {
  if (!canceledJobs.value.length) {
    cancelRecordsNotice.value = '当前没有取消记录'
    return
  }
  cancelRecordsNotice.value = ''
  cancelRecordsOpen.value = true
}

async function openFolderPicker() {
  if (!window.showDirectoryPicker) {
    window.alert('当前浏览器不支持文件夹选择，请使用支持 File System Access API 的 Chromium 浏览器。')
    return
  }
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  const bundle = await inspectDirectoryHandle(handle)
  if (!bundle.audios.length) throw new Error('文件夹里没有找到音频文件。')
  if (!bundle.transcripts.length) throw new Error('文件夹里没有找到 Whisper transcript JSON。')
  const selectedAudio = chooseLikely(bundle.audios, bundle.transcripts[0] && bundle.transcripts[0].name).name
  const selectedTranscript = chooseLikely(bundle.transcripts, selectedAudio).name
  const selectedChunk = bundle.chunks.length ? chooseLikely(bundle.chunks, selectedTranscript).name : ''
  if (bundle.audios.length === 1 && bundle.transcripts.length === 1 && bundle.chunks.length <= 1) {
    await loadFolderSelection({ ...bundle, selectedAudio, selectedTranscript, selectedChunk })
  } else {
    folderChoice.value = { ...bundle, selectedAudio, selectedTranscript, selectedChunk }
  }
}

async function inspectDirectoryHandle(handle) {
  const audios = []
  const transcripts = []
  const chunks = []
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue
    const file = await entry.getFile()
    const lower = name.toLowerCase()
    const ext = lower.slice(lower.lastIndexOf('.'))
    if (audioExtensions.has(ext)) {
      audios.push({ name, file })
    } else if (lower.endsWith('.json')) {
      try {
        const data = JSON.parse(await file.text())
        if (isTranscriptData(data)) transcripts.push({ name, file, data })
        else if (isChunkData(data) && (lower.endsWith('.ai-chunks.json') || lower === 'output.json')) chunks.push({ name, file, data })
      } catch (_err) {}
    }
  }
  return { audios, transcripts, chunks }
}

function isTranscriptData(data) {
  return !!(data && Array.isArray(data.segments) && data.segments.length)
}

function isChunkData(data) {
  return !!(data && Array.isArray(data.s) && data.s.some((segment) => Array.isArray(segment.chunks) && segment.chunks.length))
}

function chooseLikely(items, targetName = '') {
  if (items.length <= 1) return items[0]
  const target = normalizeName(targetName)
  return [...items].sort((a, b) => scoreName(b.name, target) - scoreName(a.name, target))[0]
}

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\.(transcript|ai-chunks)?\.?json$|\.[^.]+$/g, '').replace(/[^a-z0-9]+/g, '')
}

function scoreName(name, target) {
  const normalized = normalizeName(name)
  if (!target) return normalized.length
  let score = 0
  for (const char of normalized) if (target.includes(char)) score += 1
  return score
}

async function confirmFolderChoice() {
  if (!folderChoice.value) return
  await loadFolderSelection(folderChoice.value)
  folderChoice.value = null
}

async function loadFolderSelection(choice) {
  const audio = choice.audios.find((item) => item.name === choice.selectedAudio)
  const transcript = choice.transcripts.find((item) => item.name === choice.selectedTranscript)
  const chunk = choice.chunks.find((item) => item.name === choice.selectedChunk)
  if (!audio || !transcript) throw new Error('请选择音频和 Whisper 字幕。')
  await loadLocalFiles(audio.file, transcript.data, chunk && chunk.data)
}

async function loadLocalFiles(audioFile, transcriptData, chunkData) {
  if (typeof window.saveToDB !== 'function') throw new Error('saveToDB is not available')
  const audioMeta = {
    name: audioFile.name,
    size: audioFile.size || 0,
    lastModified: audioFile.lastModified || Date.now(),
    type: audioFile.type || 'application/octet-stream',
    source: 'local-folder'
  }
  await Promise.resolve(window.saveToDB('audio', audioFile))
  await Promise.resolve(window.saveToDB('audioMeta', audioMeta))
  await Promise.resolve(window.saveToDB('transcript', transcriptData))
  if (chunkData) await Promise.resolve(window.saveToDB('chunkData', chunkData))
  if (window.__state) window.__state.currentAudioMeta = audioMeta
  const audio = getAudio()
  if (audio) {
    audio.src = URL.createObjectURL(audioFile)
    audio.pause()
  }
  if (typeof window.processTranscript === 'function') window.processTranscript(transcriptData)
  if (chunkData && typeof window.processChunkData === 'function') {
    window.processChunkData(chunkData)
    resetChunkChineseDisplay()
  }
}

function statusText(job) {
  return {
    queued: '等待中',
    downloading: '下载中',
    transcribing: 'Whisper 转写中',
    segmenting: 'AI 切分中',
    translating: '翻译中',
    validating: '校验中',
    ready: '可打开',
    failed: '失败',
    canceled: '已取消'
  }[job.status] || job.status
}

function errorLabel(category) {
  return {
    youtube: '下载/cookies/proxy',
    whisperx: 'WhisperX',
    gemini: 'Gemini 限流/网络/API',
    output: '输出文件'
  }[category] || '错误'
}

function shortUrl(value) {
  const text = String(value || '')
  return text.length > 72 ? `${text.slice(0, 69)}...` : text
}

function listenText(job) {
  if (!job) return '未开始'
  const item = playback.get(job.jobId)
  if (item && item.completed) return '已听完'
  if (item && item.coverageRatio > 0) return '收听中'
  return '未开始'
}

function getAudio() {
  return document.getElementById('audio-player')
}

function bindPlaybackTracking() {
  const audio = getAudio()
  if (!audio) return
  audio.addEventListener('timeupdate', handleTimeUpdate)
  audio.addEventListener('play', handlePlay)
  audio.addEventListener('seeking', handleSeeking)
  audio.addEventListener('ended', handleEnded)
}

function unbindPlaybackTracking() {
  const audio = getAudio()
  if (!audio) return
  audio.removeEventListener('timeupdate', handleTimeUpdate)
  audio.removeEventListener('play', handlePlay)
  audio.removeEventListener('seeking', handleSeeking)
  audio.removeEventListener('ended', handleEnded)
}

function playbackState() {
  if (!currentJobId.value) return null
  if (!playback.has(currentJobId.value)) {
    playback.set(currentJobId.value, { intervals: [], lastTime: null, coverageRatio: 0, completed: false })
  }
  return playback.get(currentJobId.value)
}

function handlePlay() {
  const state = playbackState()
  const audio = getAudio()
  if (state && audio) state.lastTime = audio.currentTime
}

function handleSeeking() {
  const state = playbackState()
  if (state) state.lastTime = null
}

function handleTimeUpdate() {
  const state = playbackState()
  const audio = getAudio()
  if (!state || !audio || audio.paused) return
  const current = audio.currentTime
  const previous = state.lastTime
  if (Number.isFinite(previous) && current > previous) {
    const maxNaturalDelta = Math.max(3, 2.5 * Number(audio.playbackRate || 1))
    if (current - previous <= maxNaturalDelta) {
      addInterval(state, previous, current)
      updateCoverage(state, audio.duration)
    }
  }
  state.lastTime = current
}

function handleEnded() {
  const state = playbackState()
  const audio = getAudio()
  if (!state || !audio) return
  updateCoverage(state, audio.duration)
  if (state.coverageRatio >= 0.7) state.completed = true
}

function addInterval(state, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
  state.intervals.push([start, end])
  state.intervals.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const interval of state.intervals) {
    const last = merged[merged.length - 1]
    if (last && interval[0] <= last[1] + 0.25) last[1] = Math.max(last[1], interval[1])
    else merged.push(interval)
  }
  state.intervals = merged
}

function updateCoverage(state, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return
  const covered = state.intervals.reduce((total, item) => total + Math.max(0, item[1] - item[0]), 0)
  state.coverageRatio = Math.max(0, Math.min(1, covered / duration))
}

function resetChunkChineseDisplay() {
  const state = window.__state
  if (state) {
    state.chunkCnVisible = false
    state.isHoldingChunkCn = false
    state.holdPrevChunkCnVisible = null
  }
  const chunkStore = window.__piniaStores && window.__piniaStores.chunk
  if (chunkStore) {
    chunkStore.chunkCNVisible = false
    chunkStore.isHoldingChunkCn = false
    chunkStore.holdPrevChunkCnVisible = null
  }
  document.querySelectorAll('.chunk-cn').forEach((el) => el.classList.add('hidden-cn'))
  try {
    window.localStorage.setItem('st.chunkCnVisible', 'false')
  } catch (_err) {}
  if (typeof window.updateChunkCnHoldBtn === 'function') window.updateChunkCnHoldBtn()
}

function loadTextSetting(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback
  } catch (_err) {
    return fallback
  }
}

function saveTextSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value || ''))
  } catch (_err) {}
}

function loadPosition(key, fallback) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '')
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed
  } catch (_err) {}
  return fallback
}

function savePosition(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (_err) {}
}

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  return {
    width: window.innerWidth || 1280,
    height: window.innerHeight || 720
  }
}

function getDefaultPanelPosition() {
  const viewport = getViewportSize()
  const width = Math.min(PANEL_MAX_SIZE.width, Math.max(320, viewport.width - 32))
  const height = Math.min(PANEL_MAX_SIZE.height, Math.max(240, viewport.height - 32))
  return clampPosition({
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - height) / 2)
  }, width, height)
}

function startPanelDrag(event) {
  if (event.target && event.target.closest('button,input,select,textarea')) return
  panelDrag = { dx: event.clientX - panelPosition.value.x, dy: event.clientY - panelPosition.value.y }
  window.addEventListener('pointermove', movePanel)
  window.addEventListener('pointerup', stopPanelDrag, { once: true })
}

function movePanel(event) {
  if (!panelDrag) return
  panelPosition.value = clampPosition({ x: event.clientX - panelDrag.dx, y: event.clientY - panelDrag.dy }, 320, 240)
}

function stopPanelDrag() {
  window.removeEventListener('pointermove', movePanel)
  panelDrag = null
}

function startCapsuleDrag(event) {
  event.preventDefault()
  const rect = event.currentTarget && typeof event.currentTarget.getBoundingClientRect === 'function'
    ? event.currentTarget.getBoundingClientRect()
    : null
  const width = Math.ceil(rect && rect.width ? rect.width : DEFAULT_CAPSULE_SIZE.width)
  const height = Math.ceil(rect && rect.height ? rect.height : DEFAULT_CAPSULE_SIZE.height)
  const visiblePosition = clampPosition({
    x: rect ? rect.left : capsulePosition.value.x,
    y: rect ? rect.top : capsulePosition.value.y
  }, width, height)
  capsuleMoved = false
  capsulePosition.value = visiblePosition
  capsuleDragging.value = true
  capsuleDrag = {
    dx: event.clientX - visiblePosition.x,
    dy: event.clientY - visiblePosition.y,
    width,
    height
  }
  if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function') {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  window.addEventListener('pointermove', moveCapsule)
  window.addEventListener('pointerup', stopCapsuleDrag, { once: true })
}

function moveCapsule(event) {
  if (!capsuleDrag) return
  capsuleMoved = true
  const width = capsuleDrag.width || DEFAULT_CAPSULE_SIZE.width
  const height = capsuleDrag.height || DEFAULT_CAPSULE_SIZE.height
  capsulePosition.value = clampPosition({ x: event.clientX - capsuleDrag.dx, y: event.clientY - capsuleDrag.dy }, width, height)
}

function stopCapsuleDrag() {
  const width = capsuleDrag && capsuleDrag.width ? capsuleDrag.width : getCapsuleSize().width
  const height = capsuleDrag && capsuleDrag.height ? capsuleDrag.height : getCapsuleSize().height
  capsulePosition.value = snapToEdge(capsulePosition.value, width, height)
  window.requestAnimationFrame(correctCapsuleOverflow)
  savePosition('youtubeWorkflowCapsulePosition', capsulePosition.value)
  window.removeEventListener('pointermove', moveCapsule)
  window.setTimeout(() => { capsuleMoved = false }, 0)
  capsuleDragging.value = false
  window.setTimeout(syncCapsuleHovering, 0)
  window.setTimeout(syncCapsuleHovering, 80)
  capsuleDrag = null
}

function openFromCapsule() {
  if (!capsuleMoved) openPanel({ preservePosition: true })
}

function clampPosition(value, width, height) {
  const viewport = getViewportSize()
  return {
    x: Math.max(8, Math.min(viewport.width - width - 8, value.x)),
    y: Math.max(8, Math.min(viewport.height - height - 8, value.y))
  }
}

function getCapsuleSize() {
  const element = document.querySelector('.youtube-material-float')
  const rect = element && element.getBoundingClientRect()
  return {
    width: Math.ceil(rect && rect.width ? rect.width : DEFAULT_CAPSULE_SIZE.width),
    height: Math.ceil(rect && rect.height ? rect.height : DEFAULT_CAPSULE_SIZE.height)
  }
}

function snapToEdge(value, width, height, threshold = FLOAT_SNAP_THRESHOLD) {
  const next = { ...value }
  const viewport = getViewportSize()
  if (next.x < threshold) next.x = 8
  if (viewport.width - (next.x + width) < threshold) next.x = viewport.width - width - 8
  if (next.y < threshold) next.y = 8
  if (viewport.height - (next.y + height) < threshold) next.y = viewport.height - height - 8
  return next
}

function correctCapsuleOverflow() {
  const size = getCapsuleSize()
  capsulePosition.value = clampPosition(capsulePosition.value, size.width, size.height)
  savePosition('youtubeWorkflowCapsulePosition', capsulePosition.value)
}

function syncCapsuleHovering() {
  const element = document.querySelector('.youtube-material-float')
  capsuleHovering.value = !!(element && element.matches(':hover'))
}

function getCapsuleEdge(value, width) {
  const viewport = getViewportSize()
  if (value.x <= 10) return 'left'
  if (Math.abs(viewport.width - (value.x + width) - 8) <= 10) return 'right'
  return 'none'
}
</script>
