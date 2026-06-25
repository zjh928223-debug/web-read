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

        <section class="youtube-workflow-recent">
          <div class="youtube-workflow-summary">
            <strong>最近阅读</strong>
            <span>{{ recentSummary }}</span>
            <input
              v-model.trim="recentQuery"
              class="youtube-recent-search"
              type="search"
              placeholder="搜索文章"
              @keydown.enter.prevent="refreshRecent"
            >
            <button type="button" class="small-btn" @click="refreshRecent">刷新</button>
          </div>
          <p v-if="readerActivityNotice" class="youtube-workflow-hint" data-tone="warning">{{ readerActivityNotice }}</p>

          <div v-if="!visibleRecentJobs.length" class="youtube-workflow-empty">暂无最近阅读</div>

          <article
            v-for="job in visibleRecentJobs"
            :key="job.jobId"
            class="youtube-workflow-job youtube-workflow-recent-job"
            :data-status="job.readStatus || 'not-started'"
          >
            <div class="youtube-workflow-job-main">
              <div class="youtube-job-status-line">
                <span class="youtube-job-status-badge">{{ readStatusText(job) }}</span>
                <span class="youtube-job-position">{{ readerTimeText(job) }}</span>
              </div>
              <strong class="youtube-job-title">{{ jobDisplayTitle(job) }}</strong>
              <small>{{ readerProgressText(job) }}</small>
            </div>
            <div class="youtube-workflow-job-actions">
              <button
                type="button"
                class="small-btn primary"
                :disabled="job.jobId === currentJobId"
                @click="openRecentJob(job)"
              >
                {{ openJobActionText(job) }}
              </button>
            </div>
          </article>
        </section>

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
            <input v-model="apiKey" type="password" autocomplete="off" placeholder="留空时使用已保存的系统凭据">
          </label>

          <label v-if="geminiMode === 'real'" class="youtube-workflow-check">
            <input v-model="rememberApiKey" type="checkbox">
            <span>保存 API key 到系统凭据</span>
          </label>
          <div v-if="geminiMode === 'real'" class="youtube-credential-actions">
            <span>{{ credentialStatusText }}</span>
            <button type="button" class="small-btn" :disabled="!apiKey.trim()" @click="saveCredential">保存 key</button>
            <button type="button" class="small-btn" :disabled="!credentialStatus.stored" @click="deleteCredential">清除已保存 key</button>
          </div>
          <p v-if="credentialNotice" class="youtube-workflow-hint">{{ credentialNotice }}</p>

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
            <label>
              <span>代理</span>
              <input v-model.trim="proxyUrl" type="text" placeholder="例如 http://127.0.0.1:7897，留空关闭">
            </label>
            <label>
              <span>cookies 文件</span>
              <input v-model.trim="cookiesPath" type="text" placeholder="YouTube cookies 文件路径">
            </label>
            <label>
              <span>输出目录</span>
              <input v-model.trim="outputDir" type="text" placeholder="生成文件输出目录">
            </label>
            <label>
              <span>yt-dlp 路径</span>
              <input v-model.trim="ytDlpPath" type="text" placeholder="yt-dlp.exe">
            </label>
            <label>
              <span>WhisperX 路径</span>
              <input v-model.trim="whisperxPath" type="text" placeholder="whisperx.exe">
            </label>
            <div class="youtube-primary-actions">
              <button type="button" class="small-btn" @click="saveBackendConfig">保存后台配置</button>
              <button type="button" class="small-btn" @click="refreshMaintenance">维护状态</button>
              <button type="button" class="small-btn" @click="checkCleanup">检查旧文件</button>
              <button type="button" class="small-btn" @click="confirmCleanup">清理旧文件</button>
              <button type="button" class="small-btn" @click="downloadDiagnosticsPackage">导出诊断包</button>
            </div>
            <p v-if="backendConfigNotice">{{ backendConfigNotice }}</p>
            <p v-if="maintenanceInfo">{{ maintenanceText(maintenanceInfo) }}</p>
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
            <span v-if="geminiMode === 'real' && !apiKey.trim() && !credentialStatus.stored" class="youtube-workflow-hint">需要填写 Gemini API key 或保存系统凭据</span>
            <span v-else-if="!validLinkCards.length" class="youtube-workflow-hint">暂无可处理素材</span>
          </div>
        </form>

        <section class="youtube-import-panel">
          <div class="youtube-workflow-summary">
            <strong>导入旧素材目录</strong>
            <span>只扫描所填目录和直接子目录</span>
          </div>
          <label class="youtube-import-path">
            <span>已选目录</span>
            <input
              :value="legacyImportPath || '尚未选择目录'"
              type="text"
              readonly
            >
          </label>
          <div class="youtube-primary-actions">
            <button type="button" class="small-btn primary" :disabled="legacyImportBusy" @click="chooseLegacyImportFolder">选择并扫描目录</button>
            <button type="button" class="small-btn" :disabled="legacyImportBusy || !legacyImportPath.trim()" @click="scanLegacyImport">重新扫描</button>
            <button type="button" class="small-btn primary" :disabled="legacyImportBusy || !canEnqueueLegacyImport" @click="enqueueLegacyImport">加入素材队列 {{ legacyImportSelectedCount }} 项</button>
            <span v-if="legacyImportNotice" class="youtube-workflow-hint">{{ legacyImportNotice }}</span>
          </div>
          <div v-if="legacyImportItems.length" class="youtube-import-list">
            <article v-for="item in legacyImportItems" :key="item.id || item.audioPath" class="youtube-import-item" :data-selected="item.selected ? 'true' : 'false'">
              <label class="youtube-workflow-check">
                <input v-model="item.selected" type="checkbox">
                <span>{{ importActionText(item) }}</span>
              </label>
              <strong>{{ item.title || item.audioName }}</strong>
              <small>{{ importConfidenceText(item) }}</small>
              <small>{{ shortPath(item.audioPath) }}</small>
            </article>
          </div>
        </section>

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
              <strong class="youtube-job-title">{{ jobDisplayTitle(job) }}</strong>
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
              <button v-if="job.status === 'failed'" type="button" class="small-btn" @click="retryJob(job, 'translating')">优先重试</button>
              <button v-if="!terminalStatuses.has(job.status)" type="button" class="small-btn" @click="cancelJob(job)">取消</button>
            </div>
          </article>

          <div class="youtube-secondary-actions">
            <button type="button" class="small-btn" @click="showCancelRecords">查看取消记录</button>
            <span v-if="cancelRecordsNotice" class="youtube-workflow-hint">{{ cancelRecordsNotice }}</span>
          </div>
        </section>

        <section class="youtube-workflow-history">
          <div class="youtube-workflow-summary">
            <strong>历史库</strong>
            <span>{{ historySummary }}</span>
            <button type="button" class="small-btn" @click="toggleHistory">{{ historyOpen ? '收起' : '打开' }}</button>
          </div>

          <div v-if="historyOpen" class="youtube-history-panel">
            <div class="youtube-history-filters">
              <input
                v-model.trim="historyQuery"
                type="search"
                placeholder="搜索标题 / URL / 日期"
                @keydown.enter.prevent="refreshHistory"
              >
              <select v-model="historyStatus" @change="refreshHistory">
                <option value="">全部状态</option>
                <option value="ready">成功</option>
                <option value="failed">失败</option>
                <option value="canceled">取消</option>
              </select>
              <button type="button" class="small-btn" @click="refreshHistory">搜索</button>
            </div>

            <div v-if="!historyJobs.length" class="youtube-workflow-empty">暂无历史记录</div>

            <article
              v-for="job in historyJobs"
              :key="job.jobId"
              class="youtube-workflow-job youtube-workflow-history-job"
              :data-status="job.status"
            >
              <div class="youtube-workflow-job-main">
                <div class="youtube-job-status-line">
                  <span class="youtube-job-status-badge">{{ statusText(job) }}</span>
                  <span class="youtube-job-position">{{ historyMetaText(job) }}</span>
                </div>
                <strong class="youtube-job-title">{{ jobDisplayTitle(job) }}</strong>
                <small>{{ shortUrl(job.url || (job.request && job.request.url)) }}</small>
              </div>
              <div class="youtube-workflow-job-actions">
                <button v-if="job.status === 'ready'" type="button" class="small-btn primary" @click="openRecentJob(job)">重新打开</button>
                <button v-if="job.status === 'ready'" type="button" class="small-btn" @click="showQuality(job)">质量报告</button>
                <button v-if="job.status === 'failed'" type="button" class="small-btn" @click="retryJob(job, 'translating')">优先重试</button>
                <button type="button" class="small-btn" @click="deleteHistoryJob(job, false)">删记录</button>
                <button type="button" class="small-btn danger" @click="deleteHistoryJob(job, true)">删文件</button>
              </div>
            </article>
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
        <p v-if="switchModal.target">目标：{{ jobDisplayTitle(switchModal.target) }}</p>
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

    <div v-if="qualityModal" class="youtube-subwindow">
      <section class="youtube-subwindow-card youtube-quality-card">
        <header>
          <strong>质量报告</strong>
          <button type="button" class="youtube-workflow-icon-btn" @click="qualityModal = null">x</button>
        </header>
        <p>{{ jobDisplayTitle(qualityModal.job) }}</p>
        <p>{{ qualityIssueSummary(qualityModal.report) }}</p>
        <ul v-if="qualityModal.report.issues && qualityModal.report.issues.length">
          <li v-for="issue in qualityModal.report.issues.slice(0, 8)" :key="issue.code + issue.message">
            {{ issue.code }}：{{ issue.message }}
          </li>
        </ul>
        <div class="youtube-workflow-actions">
          <button type="button" @click="retryJob(qualityModal.job, 'segmenting')">重新AI切分</button>
          <button type="button" class="small-btn" @click="retryJob(qualityModal.job, 'translating')">重新翻译</button>
          <button type="button" class="small-btn" @click="qualityModal = null">关闭</button>
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
const FLOAT_SNAP_THRESHOLD = 96
const FLOAT_PEEK_WIDTH = 42
const DEFAULT_CAPSULE_SIZE = { width: 132, height: 48 }
const PANEL_MAX_SIZE = { width: 680, height: 720 }
const READER_SYNC_INTERVAL_MS = 15000

const panelOpen = ref(false)
const panelShrunk = ref(false)
const serviceOnline = ref(false)
const linkInput = ref('')
const linkCards = ref([])
const linkNotice = ref('')
const legacyImportPath = ref(loadTextSetting('youtubeWorkflow.legacyImportPath', ''))
const legacyImportPreview = ref(null)
const legacyImportNotice = ref('')
const legacyImportBusy = ref(false)
const rememberApiKey = ref(loadBoolSetting('youtubeWorkflow.rememberApiKey', false))
const apiKey = ref('')
const credentialStatus = ref({ stored: false, provider: '' })
const credentialNotice = ref('')
const model = ref(loadTextSetting('youtubeWorkflow.model', 'gemini-2.5-flash'))
const baseUrl = ref(loadTextSetting('youtubeWorkflow.baseUrl', ''))
const proxyUrl = ref('')
const cookiesPath = ref('')
const outputDir = ref('')
const ytDlpPath = ref('')
const whisperxPath = ref('')
const backendConfigNotice = ref('')
const maintenanceInfo = ref(null)
const showAdvanced = ref(false)
const starting = ref(false)
const queueJobs = ref([])
const recentJobs = ref([])
const recentQuery = ref('')
const readerActivityNotice = ref('')
const historyJobs = ref([])
const historyOpen = ref(false)
const historyQuery = ref('')
const historyStatus = ref('')
const showFloatingAfterClose = ref(false)
const cancelRecordsOpen = ref(false)
const cancelRecordsNotice = ref('')
const switchModal = ref(null)
const incompletePrompt = ref(null)
const qualityModal = ref(null)
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
let readerSessionId = ''
let readerSessionStartedAt = ''
let readerLastSyncAt = 0
let markCountObserver = null

const geminiMode = computed(() => {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('workflowMode') || window.localStorage.getItem('youtubeWorkflow.devMode') || 'real'
  return ['mock', 'off'].includes(requested) ? requested : 'real'
})
const validLinkCards = computed(() => linkCards.value.filter((card) => card.valid))
const invalidLinkCards = computed(() => linkCards.value.filter((card) => !card.valid))
const legacyImportItems = computed(() => {
  const items = legacyImportPreview.value && legacyImportPreview.value.items
  return Array.isArray(items) ? items : []
})
const legacyImportSelectedCount = computed(() => legacyImportItems.value.filter((item) => item && item.selected).length)
const canEnqueueLegacyImport = computed(() => {
  return legacyImportSelectedCount.value > 0 && (geminiMode.value !== 'real' || !!apiKey.value.trim() || credentialStatus.value.stored)
})
const canEnqueue = computed(() => {
  return validLinkCards.value.length > 0 && (geminiMode.value !== 'real' || !!apiKey.value.trim() || credentialStatus.value.stored)
})
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
const visibleRecentJobs = computed(() => {
  return recentJobs.value
})
const recentSummary = computed(() => {
  const total = visibleRecentJobs.value.length
  const unfinished = visibleRecentJobs.value.filter((job) => job.readStatus === 'in-progress').length
  const completed = visibleRecentJobs.value.filter((job) => job.completed).length
  return `${total} 篇 · ${unfinished} 未听完 · ${completed} 已听完`
})
const historySummary = computed(() => {
  if (!historyOpen.value) return '搜索 / 删除 / 重新打开'
  const ready = historyJobs.value.filter((job) => job.status === 'ready').length
  return `${historyJobs.value.length} 项 · ${ready} 成功`
})
const credentialStatusText = computed(() => {
  if (!credentialStatus.value || !credentialStatus.value.stored) return '未保存系统凭据'
  return `已保存系统凭据：${credentialStatus.value.provider || 'system'}`
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
watch(legacyImportPath, (value) => saveTextSetting('youtubeWorkflow.legacyImportPath', value))
watch(rememberApiKey, (value) => {
  saveBoolSetting('youtubeWorkflow.rememberApiKey', value)
})
watch(materialFloatingVisible, async (visible) => {
  if (!visible) return
  await nextTick()
  correctCapsuleOverflow()
})

onMounted(() => {
  window.localStorage.removeItem(['youtubeWorkflow', 'apiKey'].join('.'))
  bindPlaybackTracking()
  bindMarkCountTracking()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  stopPolling()
  syncReaderActivity('close')
  window.removeEventListener('beforeunload', handleBeforeUnload)
  unbindPlaybackTracking()
  unbindMarkCountTracking()
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
  if (geminiMode.value === 'real' && !apiKey.value.trim() && !credentialStatus.value.stored) return
  starting.value = true
  try {
    if (geminiMode.value === 'real' && rememberApiKey.value && apiKey.value.trim()) {
      await saveCredential({ silent: true })
    }
    for (const card of cards) {
      const payload = {
        url: card.url,
        geminiMode: geminiMode.value,
        model: model.value,
        baseUrl: baseUrl.value,
        autoOpenWhenReady: false,
        replacePolicy: 'ask'
      }
      if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
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

async function chooseLegacyImportFolder() {
  legacyImportBusy.value = true
  legacyImportNotice.value = '正在打开系统文件夹选择框；如果没有看到，请检查任务栏或用 Alt+Tab 切换。'
  try {
    const result = await youtubeWorkflowClient.pickImportFolder({ initialDir: legacyImportPath.value })
    if (!result || !result.selected || !result.path) {
      legacyImportNotice.value = '已取消选择目录'
      return
    }
    legacyImportPath.value = result.path
    legacyImportPreview.value = null
    await scanLegacyImport(result.path, { keepBusy: true })
  } catch (err) {
    legacyImportNotice.value = err && err.message ? err.message : String(err)
  } finally {
    legacyImportBusy.value = false
  }
}

async function scanLegacyImport(rootOverride = '', options = {}) {
  const rootPath = String(rootOverride || legacyImportPath.value || '').trim()
  if (!rootPath) {
    legacyImportNotice.value = '请先选择旧素材目录'
    return
  }
  if (!options.keepBusy) legacyImportBusy.value = true
  legacyImportNotice.value = '正在扫描旧素材目录...'
  try {
    const preview = await youtubeWorkflowClient.scanImportRoot({ rootPath })
    legacyImportPreview.value = preview
    const summary = preview && preview.summary ? preview.summary : {}
    legacyImportNotice.value = `发现 ${summary.total || 0} 项，默认选中 ${summary.selected || 0} 项`
  } catch (err) {
    legacyImportPreview.value = null
    legacyImportNotice.value = err && err.message ? err.message : String(err)
  } finally {
    if (!options.keepBusy) legacyImportBusy.value = false
  }
}

async function enqueueLegacyImport() {
  const items = legacyImportItems.value.filter((item) => item && item.selected)
  if (!items.length) {
    legacyImportNotice.value = '没有选中的旧素材'
    return
  }
  if (geminiMode.value === 'real' && !apiKey.value.trim() && !credentialStatus.value.stored) {
    legacyImportNotice.value = '需要填写 Gemini API key 或使用已保存的系统凭据'
    return
  }
  legacyImportBusy.value = true
  try {
    if (geminiMode.value === 'real' && rememberApiKey.value && apiKey.value.trim()) {
      await saveCredential({ silent: true })
    }
    const payload = {
      items,
      geminiMode: geminiMode.value,
      model: model.value,
      baseUrl: baseUrl.value,
      autoOpenWhenReady: false,
      replacePolicy: 'ask'
    }
    if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
    const result = await youtubeWorkflowClient.createImportJobs(payload)
    const jobs = Array.isArray(result.jobs) ? result.jobs : []
    queueJobs.value.push(...jobs)
    legacyImportNotice.value = `已加入素材队列 ${result.created || jobs.length || 0} 项`
    startPolling()
  } catch (err) {
    legacyImportNotice.value = err && err.message ? err.message : String(err)
  } finally {
    legacyImportBusy.value = false
  }
}

function openPanel(options = {}) {
  if (!options.preservePosition) panelPosition.value = getDefaultPanelPosition()
  panelOpen.value = true
  panelShrunk.value = false
  checkHealth()
  loadBackendConfig()
  loadCredentialStatus()
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
  await refreshRecent()
}

async function refreshRecent() {
  try {
    const items = await youtubeWorkflowClient.readerRecent({ query: recentQuery.value, limit: 50 })
    recentJobs.value = Array.isArray(items) ? items.filter((item) => item && item.jobId) : []
    readerActivityNotice.value = ''
  } catch (err) {
    readerActivityNotice.value = err && err.message ? err.message : String(err)
  }
}

async function toggleHistory() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) await refreshHistory()
}

async function refreshHistory() {
  try {
    const items = await youtubeWorkflowClient.history({
      query: historyQuery.value,
      status: historyStatus.value,
      limit: 50
    })
    historyJobs.value = Array.isArray(items) ? items.filter((item) => item && item.jobId) : []
  } catch (err) {
    window.alert(err && err.message ? err.message : String(err))
  }
}

async function loadBackendConfig() {
  try {
    const config = await youtubeWorkflowClient.getConfig()
    if (config.model) model.value = config.model
    if (config.baseUrl) baseUrl.value = config.baseUrl
    proxyUrl.value = config.proxyUrl || ''
    cookiesPath.value = config.cookiesPath || ''
    outputDir.value = config.outputDir || ''
    ytDlpPath.value = config.ytDlpPath || ''
    whisperxPath.value = config.whisperxPath || ''
  } catch (_err) {}
}

async function loadCredentialStatus() {
  if (geminiMode.value !== 'real') return
  try {
    credentialStatus.value = await youtubeWorkflowClient.credentialStatus()
  } catch (_err) {
    credentialStatus.value = { stored: false, provider: '' }
  }
}

async function saveCredential(options = {}) {
  if (!apiKey.value.trim()) return
  try {
    credentialStatus.value = await youtubeWorkflowClient.saveCredential({ apiKey: apiKey.value })
    credentialNotice.value = options.silent ? '' : 'API key 已保存到系统凭据'
  } catch (err) {
    credentialNotice.value = err && err.message ? err.message : String(err)
    if (options.silent) throw err
  }
}

async function deleteCredential() {
  try {
    credentialStatus.value = await youtubeWorkflowClient.deleteCredential()
    credentialNotice.value = '已清除系统凭据'
  } catch (err) {
    credentialNotice.value = err && err.message ? err.message : String(err)
  }
}

async function saveBackendConfig() {
  try {
    const saved = await youtubeWorkflowClient.saveConfig({
      model: model.value,
      baseUrl: baseUrl.value,
      proxyUrl: proxyUrl.value,
      cookiesPath: cookiesPath.value,
      outputDir: outputDir.value,
      ytDlpPath: ytDlpPath.value,
      whisperxPath: whisperxPath.value
    })
    backendConfigNotice.value = `已保存后台配置：${saved.outputDir || outputDir.value || '默认输出目录'}`
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
}

async function refreshMaintenance() {
  try {
    maintenanceInfo.value = await youtubeWorkflowClient.maintenance()
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
}

async function checkCleanup() {
  try {
    const result = await youtubeWorkflowClient.cleanupMaintenance({ olderThanDays: 30 })
    backendConfigNotice.value = `可清理 ${result.candidates ? result.candidates.length : 0} 个旧目录，约 ${formatBytes(result.bytes || 0)}`
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
}

async function confirmCleanup() {
  try {
    const preview = await youtubeWorkflowClient.cleanupMaintenance({ olderThanDays: 30 })
    const count = preview.candidates ? preview.candidates.length : 0
    if (!count) {
      backendConfigNotice.value = '没有可清理的旧文件'
      return
    }
    if (!window.confirm(`确认清理 ${count} 个旧目录，约 ${formatBytes(preview.bytes || 0)}？`)) return
    const result = await youtubeWorkflowClient.cleanupMaintenance({ olderThanDays: 30, confirm: true })
    backendConfigNotice.value = `已清理 ${result.candidates ? result.candidates.length : 0} 个旧目录`
    await refreshMaintenance()
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
}

async function downloadDiagnosticsPackage() {
  try {
    const blob = await youtubeWorkflowClient.diagnosticsPackage()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `subtitle-workflow-diagnostics-${Date.now()}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    backendConfigNotice.value = '诊断包已导出'
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
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
  if (terminalStatuses.has(fresh.status) && (!previous || previous.status !== fresh.status)) {
    refreshRecent()
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
    currentText: currentJobId.value ? listenText(queueJobs.value.find((item) => item.jobId === currentJobId.value) || recentJobs.value.find((item) => item.jobId === currentJobId.value)) : '未开始',
    message: '确认后会加载目标文章，当前播放会停止，新文章不会自动播放。',
    confirmText: '确认切换',
    wasPlaying: paused
  }
}

function openRecentJob(job) {
  openJob(normalizeRecentJob(job))
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
      type: 'import-folder',
      title: '本次素材队列已经到最后一篇。',
      message: '是否选择旧素材目录并导入到标准素材库？导入后会加入素材队列末尾。',
      confirmText: '选择并扫描目录',
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
  if (modal.type === 'import-folder') {
    openPanel()
    await nextTick()
    await chooseLegacyImportFolder()
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
    if (currentJobId.value && currentJobId.value !== job.jobId) {
      await syncReaderActivity('switch')
    }
    const result = await makeLoader().loadJobIntoReader(job.jobId, { replacePolicy: 'replace-current' })
    currentJobId.value = job.jobId
    loadedReadyJobs.add(job.jobId)
    startReaderSession(job)
    await syncReaderActivity('open', { manifest: result && result.manifest })
    await refreshRecent()
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

function normalizeRecentJob(job) {
  return {
    ...job,
    request: job.request || { url: job.url || '' }
  }
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

function jobDisplayTitle(job) {
  return (job && job.title) || shortUrl(job && (job.url || (job.request && job.request.url))) || (job && job.jobId) || ''
}

function recentTaskMetaText(job) {
  const stamp = formatShortDate(job && (job.finishedAt || job.updatedAt || job.createdAt))
  return stamp || '最近完成'
}

function readStatusText(job) {
  if (job && job.completed) {
    const count = Number(job.completedCount || 0)
    return count > 1 ? `已听完 ${count} 次` : '已听完'
  }
  if (job && job.readStatus === 'in-progress') return '未听完'
  return '未开始'
}

function readerTimeText(job) {
  const stamp = job && (job.lastActivityAt || job.finishedAt || job.createdAt)
  if (!stamp) return '暂无阅读时间'
  return formatRelativeTime(stamp)
}

function readerProgressText(job) {
  const parts = []
  const coverage = Number(job && job.overallCoverageRatio)
  if (job && job.completed) {
    parts.push('已听完')
  } else if (Number.isFinite(coverage) && coverage > 0) {
    parts.push(`已听 ${Math.round(coverage * 100)}%`)
  } else {
    parts.push('未开始')
  }
  const position = Number(job && job.lastPositionSeconds)
  const duration = Number(job && job.durationSeconds)
  if (Number.isFinite(position) && position > 0 && Number.isFinite(duration) && duration > 0) {
    parts.push(`上次 ${formatClock(position)} / ${formatClock(duration)}`)
  }
  const markCount = Number(job && job.markCount)
  if (Number.isFinite(markCount) && markCount > 0) parts.push(`标记 ${markCount}`)
  return parts.join(' · ')
}

function formatRelativeTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  if (diffMs >= 0 && diffMs < minute) return '刚刚'
  if (diffMs >= 0 && diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  }
  const options = date.getFullYear() === now.getFullYear()
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' }
  return date.toLocaleString('zh-CN', options)
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(safe / 60)
  const rest = String(safe % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function readyJobMetaText(job) {
  const openState = jobOpenStateText(job)
  const progress = listenText(job)
  return openState ? `${openState} · ${progress}` : progress
}

function openJobActionText(job) {
  if (!job) return '打开这篇'
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

async function retryJob(job, stage = 'translating') {
  const payload = { stage, model: model.value, baseUrl: baseUrl.value }
  if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
  const retried = await youtubeWorkflowClient.retryJob(job.jobId, payload)
  queueJobs.value.push(retried)
  qualityModal.value = null
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

function historyMetaText(job) {
  const parts = []
  const stamp = formatShortDate(job && (job.finishedAt || job.updatedAt || job.createdAt))
  const duration = Number(job && job.durationSeconds)
  const bytes = totalFileBytes(job && job.fileSizes)
  if (stamp) parts.push(stamp)
  if (Number.isFinite(duration) && duration > 0) parts.push(`${duration.toFixed(1)}s`)
  if (bytes > 0) parts.push(formatBytes(bytes))
  return parts.join(' · ') || '无详情'
}

function totalFileBytes(fileSizes) {
  if (!fileSizes || typeof fileSizes !== 'object') return 0
  return Object.values(fileSizes).reduce((total, value) => {
    const size = Number(value)
    return total + (Number.isFinite(size) ? size : 0)
  }, 0)
}

function formatBytes(value) {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function maintenanceText(info) {
  if (!info) return ''
  return `任务 ${info.jobs || 0} · 历史 ${info.history || 0} · 输出 ${formatBytes(info.outputBytes || 0)} · 状态 ${formatBytes(info.stateBytes || 0)}`
}

async function deleteHistoryJob(job, deleteFiles) {
  const message = deleteFiles
    ? `确定删除历史记录并删除生成文件吗？\n${jobDisplayTitle(job)}`
    : `确定只删除历史记录吗？\n${jobDisplayTitle(job)}`
  if (!window.confirm(message)) return
  await youtubeWorkflowClient.deleteHistory(job.jobId, { deleteFiles })
  historyJobs.value = historyJobs.value.filter((item) => item.jobId !== job.jobId)
  await refreshRecent()
}

async function showQuality(job) {
  try {
    const report = await youtubeWorkflowClient.quality(job.jobId)
    qualityModal.value = { job, report }
  } catch (err) {
    window.alert(err && err.message ? err.message : String(err))
  }
}

function qualityIssueSummary(report) {
  if (!report) return '暂无报告'
  const total = Array.isArray(report.issues) ? report.issues.length : 0
  if (!total) return `通过 · ${report.chunkCount || 0} 个 chunk · ${report.wordCount || 0} 个词`
  return `发现 ${total} 个问题 · ${report.chunkCount || 0} 个 chunk · ${report.wordCount || 0} 个词`
}

function importActionText(item) {
  if (!item) return ''
  return item.action === 'ai_only' ? '已有字幕：只做 AI 切分' : '无字幕：Whisper 转写 + AI 切分'
}

function importConfidenceText(item) {
  if (!item) return ''
  const parts = []
  if (item.duplicate) parts.push('疑似已导入')
  if (item.action === 'ai_only') parts.push(`字幕匹配 ${Number(item.confidence || 0)}%`)
  if (item.reason) parts.push(item.reason)
  return parts.join(' · ') || '可导入'
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

function shortPath(value) {
  const text = String(value || '')
  return text.length > 96 ? `...${text.slice(-93)}` : text
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

function startReaderSession(job) {
  const jobId = job && job.jobId ? String(job.jobId) : ''
  if (!jobId) return
  readerSessionId = `${jobId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  readerSessionStartedAt = new Date().toISOString()
  readerLastSyncAt = 0
  if (!playback.has(jobId)) {
    playback.set(jobId, { intervals: [], lastTime: null, coverageRatio: 0, completed: false })
  }
}

function bindPlaybackTracking() {
  const audio = getAudio()
  if (!audio) return
  audio.addEventListener('timeupdate', handleTimeUpdate)
  audio.addEventListener('play', handlePlay)
  audio.addEventListener('pause', handlePause)
  audio.addEventListener('seeking', handleSeeking)
  audio.addEventListener('ended', handleEnded)
}

function unbindPlaybackTracking() {
  const audio = getAudio()
  if (!audio) return
  audio.removeEventListener('timeupdate', handleTimeUpdate)
  audio.removeEventListener('play', handlePlay)
  audio.removeEventListener('pause', handlePause)
  audio.removeEventListener('seeking', handleSeeking)
  audio.removeEventListener('ended', handleEnded)
}

function playbackState() {
  ensureCurrentJobFromAudioMeta()
  if (!currentJobId.value) return null
  if (!playback.has(currentJobId.value)) {
    playback.set(currentJobId.value, { intervals: [], lastTime: null, coverageRatio: 0, completed: false })
  }
  return playback.get(currentJobId.value)
}

function ensureCurrentJobFromAudioMeta() {
  if (currentJobId.value) return
  const meta = window.__state && window.__state.currentAudioMeta
  const jobId = meta && meta.source === 'youtube-workflow' ? String(meta.jobId || '') : ''
  if (!jobId) return
  currentJobId.value = jobId
  startReaderSession({ jobId })
}

function handlePlay() {
  const state = playbackState()
  const audio = getAudio()
  if (state && audio) state.lastTime = audio.currentTime
  if (currentJobId.value && readerLastSyncAt === 0) {
    readerLastSyncAt = Date.now()
    syncReaderActivity('open')
  }
}

function handlePause() {
  const audio = getAudio()
  if (audio && audio.ended) return
  syncReaderActivity('pause')
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
      scheduleReaderActivitySync()
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
  syncReaderActivity('ended')
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

function scheduleReaderActivitySync() {
  const now = Date.now()
  if (now - readerLastSyncAt < READER_SYNC_INTERVAL_MS) return
  readerLastSyncAt = now
  syncReaderActivity('progress')
}

async function syncReaderActivity(event = 'progress') {
  if (!currentJobId.value) return null
  const payload = buildReaderActivityPayload(event)
  if (!payload) return null
  try {
    const updated = await youtubeWorkflowClient.recordReaderActivity(payload)
    mergeRecentReaderItem(updated)
    readerActivityNotice.value = ''
    return updated
  } catch (err) {
    readerActivityNotice.value = '进度保存失败'
    return null
  }
}

function buildReaderActivityPayload(event) {
  const audio = getAudio()
  const state = playbackState()
  if (!currentJobId.value) return null
  return {
    jobId: currentJobId.value,
    event,
    sessionId: readerSessionId || `${currentJobId.value}-session`,
    sessionStartedAt: readerSessionStartedAt || new Date().toISOString(),
    positionSeconds: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    durationSeconds: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
    intervals: state && Array.isArray(state.intervals) ? state.intervals.map((item) => [item[0], item[1]]) : [],
    coverageRatio: state && Number.isFinite(state.coverageRatio) ? state.coverageRatio : 0,
    markCount: getCurrentMarkCount()
  }
}

function mergeRecentReaderItem(item) {
  if (!item || !item.jobId) return
  const index = recentJobs.value.findIndex((entry) => entry.jobId === item.jobId)
  if (index >= 0) recentJobs.value[index] = { ...recentJobs.value[index], ...item }
  else recentJobs.value.unshift(item)
}

function getCurrentMarkCount() {
  const el = document.getElementById('annotation-mark-count')
  const value = el ? Number(el.dataset.count || 0) : 0
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function bindMarkCountTracking() {
  const el = document.getElementById('annotation-mark-count')
  if (!el || typeof MutationObserver === 'undefined') return
  markCountObserver = new MutationObserver(() => {
    if (!currentJobId.value) return
    syncReaderActivity('annotation')
  })
  markCountObserver.observe(el, { attributes: true, attributeFilter: ['data-count'] })
}

function unbindMarkCountTracking() {
  if (markCountObserver) markCountObserver.disconnect()
  markCountObserver = null
}

function handleBeforeUnload() {
  const payload = buildReaderActivityPayload('close')
  if (!payload || !navigator.sendBeacon) return
  try {
    const body = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    navigator.sendBeacon(`${youtubeWorkflowClient.baseUrl}/api/reader/activity`, body)
  } catch (_err) {}
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

function loadBoolSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(key)
    return value == null ? fallback : value === 'true'
  } catch (_err) {
    return fallback
  }
}

function saveBoolSetting(key, value) {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false')
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
