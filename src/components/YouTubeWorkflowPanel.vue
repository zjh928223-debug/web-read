<template>
  <Teleport to="#youtube-reader-controls-root">
    <div class="youtube-reader-controls">
      <button type="button" class="small-btn youtube-material-entry" @click="openPanel">
        <span>素材处理</span>
        <small v-if="activeTaskCount" class="youtube-material-entry-count is-active">{{ activeTaskEntryText }}</small>
        <small v-if="failedTaskCount" class="youtube-material-entry-count is-failed">{{ failedTaskCount }}</small>
        <small v-if="completionSignal" class="youtube-material-entry-count is-complete">✓</small>
      </button>
    </div>
  </Teleport>

  <div class="youtube-workflow">
    <div v-if="panelOpen" class="youtube-workflow-backdrop">
      <section ref="panelDialogRoot" class="youtube-workflow-panel" role="dialog" aria-modal="true" aria-label="素材处理" :aria-busy="panelPending ? 'true' : 'false'" @pointerdown.stop>
        <header class="youtube-workflow-header">
          <div>
            <h2>素材处理</h2>
          </div>
          <div class="youtube-window-actions">
            <button type="button" class="small-btn primary youtube-add-material-button" @click="setWorkflowView('add')">+ 添加素材</button>
            <button type="button" class="youtube-workflow-icon-btn" aria-label="关闭" title="关闭" @click="closePanel">×</button>
          </div>
        </header>

        <div class="youtube-workflow-service-status">
          <div v-if="serviceStatusKnown && !serviceOnline" class="youtube-workflow-alert">
            <strong>后台服务未启动</strong>
            <span>当前后端地址：{{ youtubeWorkflowClient.baseUrl }}</span>
          </div>
        </div>

        <div class="youtube-workflow-layout">
          <nav class="youtube-workflow-section-tabs youtube-workflow-nav" aria-label="素材处理视图">
            <button type="button" data-view="library" :aria-pressed="workflowView === 'library'" :data-active="workflowView === 'library' ? 'true' : 'false'" @click="setWorkflowView('library')">
              <span>素材库</span>
            </button>
            <button type="button" data-view="queue" :aria-pressed="workflowView === 'queue'" :data-active="workflowView === 'queue' ? 'true' : 'false'" @click="setWorkflowView('queue')">
              <span>任务</span>
              <small v-if="activeTaskCount">{{ activeTaskCount }}</small>
              <small v-else-if="failedTaskCount" class="is-failed">{{ failedTaskCount }}</small>
            </button>
            <button type="button" data-view="settings" :aria-pressed="workflowView === 'settings'" :data-active="workflowView === 'settings' ? 'true' : 'false'" @click="setWorkflowView('settings')">
              <span>设置</span>
            </button>
          </nav>

          <main class="youtube-workflow-content">
            <p v-if="workflowMutationNotice" class="youtube-workflow-hint" data-workflow-mutation-notice role="status" aria-live="polite" data-tone="warning">
              {{ workflowMutationNotice }}
            </p>
            <section v-if="workflowView === 'add'" class="youtube-workflow-add-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>添加素材</h3>
                  <p>粘贴视频链接，可一次添加多个。</p>
                </div>
              </div>

              <form class="youtube-workflow-form youtube-add-material-form" @submit.prevent="enqueueUrls">
                <label class="youtube-material-link-label">
                  <span>视频链接</span>
                  <textarea
                    v-model.trim="linkInput"
                    class="youtube-material-link-input"
                    name="youtube-material-link"
                    autocomplete="off"
                    rows="2"
                    placeholder="粘贴 YouTube 链接；多个链接请每行一个"
                    @keydown.enter.ctrl.prevent="commitLinkInput"
                    @paste="handleLinkPaste"
                    @blur="commitLinkInput"
                  />
                </label>

                <div class="youtube-link-card-list">
                  <article v-for="(card, index) in linkCards" :key="card.id" class="youtube-link-card" :data-valid="card.valid" :data-duplicate="card.duplicate ? 'true' : 'false'">
                    <div class="youtube-link-main">
                      <strong>{{ card.metadataTitle || linkCardFallbackTitle(card) }}</strong>
                      <small v-if="!card.valid || card.duplicate || card.metadataState === 'loading'" class="youtube-link-state-text">{{ linkCardStateText(card) }}</small>
                      <span v-if="card.metadataAuthor" class="youtube-link-author">{{ card.metadataAuthor }}</span>
                    </div>
                    <button type="button" class="small-btn youtube-link-remove" :aria-label="`移除第 ${index + 1} 条链接`" @click="removeLinkCard(card.id)">移除</button>
                  </article>
                </div>

                <p v-if="invalidLinkCards.length" class="youtube-workflow-hint">
                  已跳过 {{ invalidLinkCards.length }} 条格式无效链接。
                </p>
                <p v-if="linkNotice" class="youtube-workflow-hint" data-tone="warning">
                  {{ linkNotice }}
                </p>
                <div v-if="geminiMode === 'real' && !apiKey.trim() && !credentialStatus.stored" class="youtube-add-credential-needed">
                  <span>需要先保存 Gemini API Key</span>
                  <button type="button" class="small-btn" @click="setWorkflowView('settings')">去设置</button>
                </div>
                <div class="youtube-primary-actions youtube-add-submit-row">
                  <button type="submit" class="primary" :disabled="starting || !canEnqueue">
                    <span>{{ primaryActionText }}</span>
                  </button>
                </div>
              </form>
            </section>

            <section v-if="workflowView === 'queue'" class="youtube-workflow-process-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>任务</h3>
                </div>
                <button type="button" class="small-btn" @click="refreshQueue">刷新</button>
              </div>
              <div class="youtube-workflow-toolbar">
                <span>{{ taskSummary }}</span>
                <button v-if="failedTaskCount" type="button" class="small-btn youtube-clear-failures" @click="clearFailedTasks">清除失败记录</button>
              </div>

              <section class="youtube-workflow-queue">
                <div v-if="!taskGroups.length" class="youtube-workflow-empty">当前没有进行中或失败的任务</div>
                <article
                  v-for="group in taskGroups"
                  :key="group.key"
                  class="youtube-workflow-job youtube-workflow-queue-job"
                  :data-status="group.displayJob.status"
                  :data-active="group.statusKind === 'active' ? 'true' : 'false'"
                >
                  <div class="youtube-workflow-job-main">
                    <strong class="youtube-job-title">{{ jobDisplayTitle(group.displayJob) }}</strong>
                    <div class="youtube-job-status-line">
                      <span class="youtube-job-status-badge">{{ jobStageProgressText(group.displayJob) }}</span>
                      <span v-if="group.attemptCount > 1" class="youtube-task-attempt-count">{{ group.attemptCount }} 次尝试</span>
                    </div>
                    <small class="youtube-job-source">{{ taskSourceText(group.displayJob) }}</small>
                    <div class="youtube-job-progress" aria-hidden="true">
                      <span :style="{ width: `${jobProgressPercent(group.displayJob)}%` }"></span>
                    </div>
                    <small v-if="group.displayJob.error" class="youtube-workflow-error">{{ failureReasonText(group.displayJob) }}</small>
                    <div v-if="group.statusKind === 'active'" class="youtube-job-log" aria-label="运行日志">
                      <div class="youtube-job-log-title">当前过程</div>
                      <ul>
                        <li v-for="line in jobLogLines(group.displayJob)" :key="line">{{ line }}</li>
                      </ul>
                    </div>
                    <details v-if="group.attemptCount > 1" class="youtube-task-attempt-details">
                      <summary>查看以往尝试</summary>
                      <p v-for="attempt in group.attempts.slice(1)" :key="attempt.jobId">
                        {{ exactJobTime(attempt) }} · {{ failureReasonText(attempt) }}
                      </p>
                    </details>
                  </div>
                  <div class="youtube-workflow-job-actions">
                    <button v-if="group.displayJob.status === 'queued'" type="button" class="small-btn" @click="prioritizeJob(group.displayJob)">置顶</button>
                    <button v-if="group.statusKind === 'failed'" type="button" class="small-btn primary" @click="retryJob(group.displayJob)">重试</button>
                    <button v-if="group.statusKind === 'failed'" type="button" class="small-btn danger" @click="deleteFailedTaskGroup(group)">删除记录</button>
                    <button v-if="group.statusKind === 'active'" type="button" class="small-btn" @click="cancelJob(group.displayJob)">取消</button>
                  </div>
                </article>
              </section>
            </section>

            <section v-if="workflowView === 'library'" class="youtube-workflow-library-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>素材库</h3>
                </div>
                <span>{{ librarySummary }}</span>
              </div>
              <div class="youtube-filter-tabs youtube-library-time-filter" aria-label="素材时间筛选">
                <button type="button" :data-active="libraryTimeScope === 'all' ? 'true' : 'false'" @click="setLibraryTimeScope('all')">全部</button>
                <button type="button" :data-active="libraryTimeScope === 'recent' ? 'true' : 'false'" @click="setLibraryTimeScope('recent')">7 天内</button>
                <button type="button" :data-active="libraryTimeScope === 'earlier' ? 'true' : 'false'" @click="setLibraryTimeScope('earlier')">更早</button>
              </div>

              <p v-if="readerActivityNotice" class="youtube-workflow-hint" data-tone="warning">{{ readerActivityNotice }}</p>
              <section class="youtube-workflow-history youtube-material-library-list">
                <div v-if="libraryPending && !recentJobs.length" class="youtube-workflow-empty">正在读取素材库…</div>
                <div v-else-if="!recentJobs.length" class="youtube-workflow-empty">这个时间范围内暂无素材</div>
                <article
                  v-for="job in recentJobs"
                  :key="job.jobId"
                  class="youtube-workflow-job youtube-workflow-library-job"
                  :data-status="job.needsRepair ? 'needs-repair' : 'ready'"
                >
                  <div class="youtube-workflow-job-main">
                    <strong class="youtube-job-title">{{ jobDisplayTitle(job) }}</strong>
                    <div class="youtube-job-status-line">
                      <span>{{ libraryRelativeTime(job) }}</span>
                      <span>{{ libraryExactTime(job) }}</span>
                      <span v-if="job.needsRepair" class="youtube-library-repair-state">需要修复</span>
                    </div>
                  </div>
                  <div class="youtube-workflow-job-actions">
                    <button type="button" class="small-btn youtube-library-open" :disabled="openingJobId === job.jobId" @click="openRecentJob(job)">打开</button>
                    <button type="button" class="small-btn youtube-library-more" aria-label="更多操作" :aria-expanded="expandedLibraryJobId === job.jobId ? 'true' : 'false'" @click="toggleLibraryMenu(job)">···</button>
                  </div>
                  <div v-if="expandedLibraryJobId === job.jobId" class="youtube-library-row-menu">
                    <small class="youtube-library-source-detail">{{ librarySourceText(job) }}</small>
                    <button type="button" class="small-btn" @click="confirmReprocess(job)">重新处理</button>
                    <button type="button" class="small-btn" @click="showQuality(job)">查看处理详情</button>
                    <button type="button" class="small-btn danger" @click="deleteLibraryRecord(job)">删除记录</button>
                  </div>
                </article>
                <button v-if="libraryHasMore" type="button" class="small-btn youtube-library-load-more" :disabled="libraryPending" @click="loadMoreLibrary">
                  {{ libraryPending ? '加载中…' : '加载更多' }}
                </button>
              </section>
              <button
                v-if="readerConflictVisible"
                type="button"
                class="small-btn"
                data-reader-conflict-action
                @click="resolveReaderConflict"
              >确认并保存本地最新意图</button>
            </section>

            <section v-if="workflowView === 'add'" class="youtube-add-duplicate-help" aria-live="polite">
              <div v-for="card in duplicateLinkCards" :key="`duplicate-${card.id}`" class="youtube-duplicate-material-notice">
                <div>
                  <strong>{{ card.metadataTitle || jobDisplayTitle(card.duplicate.job) }}</strong>
                  <span>{{ duplicateStateText(card.duplicate) }}</span>
                </div>
                <div class="youtube-workflow-actions">
                  <button v-if="card.duplicate.state === 'ready'" type="button" class="small-btn primary" @click="openRecentJob(card.duplicate.job)">打开已有素材</button>
                  <button v-if="card.duplicate.state === 'active'" type="button" class="small-btn" @click="setWorkflowView('queue')">查看当前任务</button>
                  <button v-if="card.duplicate.state === 'failed'" type="button" class="small-btn" @click="retryJob(card.duplicate.job)">重试</button>
                  <button type="button" class="small-btn" @click="confirmReprocess(card.duplicate.job, card.url)">明确重新处理</button>
                </div>
              </div>
            </section>

            <section v-if="workflowView === 'settings'" class="youtube-workflow-settings-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>Windows 后端设置</h3>
                  <p>这里配置运行在 Windows 上的素材处理服务。</p>
                </div>
              </div>
              <section v-if="geminiMode === 'real'" class="youtube-api-key-settings">
                <div class="youtube-api-key-heading">
                  <strong>Gemini API Key</strong>
                  <span v-if="credentialStatus.stored">已保存</span>
                  <span v-else>尚未保存</span>
                </div>
                <label class="youtube-api-key-field">
                  <input v-model="apiKey" type="password" name="youtube-gemini-api-key-settings" autocomplete="off" aria-label="Gemini API Key" placeholder="输入新的 API Key">
                </label>
                <div class="youtube-credential-actions">
                  <button type="button" class="small-btn primary" :disabled="!apiKey.trim()" @click="saveCredential">
                    {{ credentialStatus.stored ? '更新 API Key' : '保存 API Key' }}
                  </button>
                </div>
                <p v-if="credentialNotice" class="youtube-workflow-hint">{{ credentialNotice }}</p>
              </section>
              <p v-else class="youtube-workflow-hint">当前为本地开发模式，无需配置 API Key。</p>

              <button type="button" class="youtube-advanced-toggle" :aria-expanded="showAdvanced ? 'true' : 'false'" @click="showAdvanced = !showAdvanced">
                <span>{{ showAdvanced ? '收起高级设置' : '高级设置' }}</span>
              </button>
              <div v-if="showAdvanced" class="youtube-advanced-settings">
                <label>
                  <span>模型</span>
                  <input v-model.trim="model" type="text" name="youtube-workflow-settings-model" autocomplete="off" placeholder="gemini-2.5-flash">
                </label>
                <label>
                  <span>Base URL（可选，使用代理网关时填写）</span>
                  <input v-model.trim="baseUrl" type="text" name="youtube-workflow-base-url" autocomplete="off" placeholder="留空使用官方默认地址">
                </label>
                <label>
                  <span>代理</span>
                  <input v-model.trim="proxyUrl" type="text" name="youtube-workflow-proxy-url" autocomplete="off" placeholder="例如 http://127.0.0.1:7897，留空关闭">
                </label>
                <label>
                  <span>cookies 文件</span>
                  <input v-model.trim="cookiesPath" type="text" name="youtube-workflow-cookies-path" autocomplete="off" placeholder="YouTube cookies 文件路径">
                </label>
                <label>
                  <span>输出目录</span>
                  <input v-model.trim="outputDir" type="text" name="youtube-workflow-output-dir" autocomplete="off" placeholder="生成文件输出目录">
                </label>
                <label>
                  <span>yt-dlp 路径</span>
                  <input v-model.trim="ytDlpPath" type="text" name="youtube-workflow-ytdlp-path" autocomplete="off" placeholder="yt-dlp.exe">
                </label>
                <label>
                  <span>WhisperX 路径</span>
                  <input v-model.trim="whisperxPath" type="text" name="youtube-workflow-whisperx-path" autocomplete="off" placeholder="whisperx.exe">
                </label>
                <div class="youtube-primary-actions">
                  <button type="button" class="small-btn primary" @click="saveBackendConfig">保存后台配置</button>
                  <button type="button" class="small-btn" @click="refreshMaintenance">维护状态</button>
                  <button type="button" class="small-btn" @click="checkCleanup">检查旧文件</button>
                  <button type="button" class="small-btn" @click="confirmCleanup">清理旧文件</button>
                  <button type="button" class="small-btn" @click="downloadDiagnosticsPackage">导出诊断包</button>
                </div>
                <div v-if="geminiMode === 'real' && credentialStatus.stored" class="youtube-advanced-danger-row">
                  <button type="button" class="small-btn danger" @click="confirmDeleteCredential">清除已保存 API Key</button>
                </div>
                <p v-if="backendConfigNotice">{{ backendConfigNotice }}</p>
                <p v-if="maintenanceInfo">{{ maintenanceText(maintenanceInfo) }}</p>
              </div>
            </section>
          </main>
        </div>

      </section>
    </div>

    <Teleport to="body">
      <div v-if="qualityModal" class="youtube-workflow youtube-subwindow youtube-quality-backdrop">
        <section ref="qualityDialogRoot" class="youtube-subwindow-card youtube-quality-card" role="dialog" aria-modal="true" aria-labelledby="youtube-quality-dialog-title" :aria-busy="qualityPending ? 'true' : 'false'">
          <header>
            <strong id="youtube-quality-dialog-title">质量报告</strong>
            <button ref="qualityDialogInitialFocus" type="button" class="youtube-workflow-icon-btn" aria-label="关闭质量报告" title="关闭" :disabled="qualityPending" @click="closeQualityModal">x</button>
          </header>
          <p>{{ jobDisplayTitle(qualityModal.job) }}</p>
          <p ref="qualityDialogStatus" role="status" aria-live="polite" aria-atomic="true">{{ qualityIssueSummary(qualityModal.report) }}</p>
          <ul v-if="qualityModal.report.issues && qualityModal.report.issues.length">
            <li v-for="issue in qualityModal.report.issues.slice(0, 8)" :key="issue.code + issue.message">
              {{ issue.code }}：{{ issue.message }}
            </li>
          </ul>
          <div class="youtube-workflow-actions">
            <button type="button" :disabled="qualityPending" @click="retryQualityJob(qualityModal.job, 'segmenting')">重新AI切分</button>
            <button type="button" class="small-btn" :disabled="qualityPending" @click="retryQualityJob(qualityModal.job, 'translating')">重新翻译</button>
            <button type="button" class="small-btn" :disabled="qualityPending" @click="closeQualityModal">关闭</button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <aside
        v-if="materialNotice"
        class="youtube-material-notice"
        role="status"
        aria-live="polite"
        @mouseenter="pauseMaterialNotice"
        @mouseleave="resumeMaterialNotice"
      >
        <span>{{ materialNotice.message }}</span>
        <button type="button" class="small-btn" @click="runMaterialNoticeAction">{{ materialNotice.actionLabel }}</button>
        <button type="button" class="youtube-material-notice-close" aria-label="关闭提示" @click="clearMaterialNotice">×</button>
      </aside>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAudioStore } from '../pinia-stores/audio.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { useMarksStore } from '../pinia-stores/marks.js'
import { runtimeState } from '../composables/runtime-state-facade.js'
import { bridgeToPinia } from '../composables/pinia-bridge-module.js'
import { scheduleGeneratedAnnotationIndexRefresh } from '../composables/session-facades.js'
import { createYoutubeWorkflowOperationKey, youtubeWorkflowClient } from '../composables/youtube-workflow-client.js'
import { createYoutubeWorkflowLoader } from '../composables/youtube-workflow-loader.js'
import { createReaderSessionPublisher } from '../composables/reader-session-publisher.js'
import { createReaderMarksHydration } from '../composables/create-reader-marks-hydration.js'
import { createJobPollingScheduler } from '../services/workflow/job-polling-scheduler.js'
import { createReaderPlaybackTracker } from '../services/workflow/reader-playback-tracker.js'
import { createReaderSessionPersistence } from '../services/persistence/reader-session-persistence.js'
import {
  createReaderOutboxEntry,
  readReaderOutbox,
  writeReaderOutboxEntry,
  removeReaderOutboxEntry,
} from '../services/persistence/reader-outbox-storage.js'
import { useReaderSaveCoordinator } from '../composables/use-reader-save-coordinator.js'
import { createObjectUrlDownloader } from '../services/runtime/download-object-url.js'
import { createDialogController, createPendingActionGuard } from '../services/runtime/dialog-controller.js'
import { observeBestEffort, recordBestEffortFailure } from '../services/runtime/best-effort.js'
import {
  createWorkflowOperationFingerprint,
  cleanupWorkflowOperationReceipts,
  readWorkflowOperationReceipt,
  removeWorkflowOperationReceipt,
  writeWorkflowOperationReceipt,
} from '../services/workflow/operation-receipt.js'
import {
  canonicalMaterialKey,
  exactDateTime,
  extractYoutubeVideoId,
  findDuplicateMaterial,
  groupTaskAttempts,
  materialTimestamp,
} from '../services/workflow/material-center-model.js'

const terminalStatuses = new Set(['ready', 'failed', 'canceled'])
const audioStore = useAudioStore()
const chunkStore = useChunkStore()
const marksStore = useMarksStore()

const panelOpen = ref(false)
const serviceOnline = ref(false)
const serviceStatusKnown = ref(false)
const linkInput = ref('')
const linkCards = ref([])
const linkNotice = ref('')
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
const workflowRevision = ref(null)
const workflowMutationNotice = ref('')
const queueJobs = ref([])
const recentJobs = ref([])
const workflowView = ref('library')
const libraryTimeScope = ref('all')
const libraryPending = ref(false)
const libraryHasMore = ref(false)
const libraryPageSize = 20
const expandedLibraryJobId = ref('')
const openingJobId = ref('')
const completionSignal = ref(false)
const visibleCompletedJobIds = ref([])
const videoPriority = ref(true)
const qualityPending = ref(false)
const panelDialogRoot = ref(null)
const qualityDialogRoot = ref(null)
const qualityDialogStatus = ref(null)
const qualityDialogInitialFocus = ref(null)
const qualityModal = ref(null)
const materialNotice = ref(null)
const repairStates = new Map()
const currentJobId = ref('')
const loadedReadyJobs = new Set()
let jobPollingScheduler = null
let linkSequence = 0
const pendingWorkflowActions = new Map()
let workflowSnapshotFlight = null
let workflowRevisionNeedsRefresh = true
let readerSessionLoader = null
let readerSessionLoadInProgress = false
let readerUnloadFlushed = false
let readerCloseGeneration = 0
let readerOutboxReplayPromise = null
let completionSignalTimer = 0
let materialNoticeTimer = 0
let libraryRetryTimer = 0
let libraryRetryCount = 0
const completedTaskTimers = new Map()
const readerSessionPersistence = createReaderSessionPersistence()
const diagnosticsDownloader = createObjectUrlDownloader()
const panelDialogController = createDialogController()
const qualityDialogController = createDialogController()
const qualityActionGuard = createPendingActionGuard({ onChange: (pending) => { qualityPending.value = pending } })
const panelPending = computed(() => starting.value)
const readerPlaybackTracker = createReaderPlaybackTracker({
  getCurrentJobId: () => currentJobId.value,
  getReaderMedia,
  getMediaSource,
  ensureCurrentJobFromAudioMeta,
  onActivity: (event) => syncReaderActivity(event),
  getCurrentMarkCount,
})
const {
  readerActivityNotice,
  readerMarksSaveState,
  readerActivitySaveState,
  readerConflictVisible,
  getReaderMarksLedger,
  getReaderActivityLedger,
  updateReaderConflictVisibility,
  loadReaderConflict,
  clearReaderConflict,
  resolveReaderConflict,
  rememberReaderRevision,
  getReaderRevision,
  dispose: disposeReaderSaveCoordinator,
} = useReaderSaveCoordinator({
  currentJobId,
  getReaderSessionId: () => readerPlaybackTracker.getReaderSessionId(),
  mergeRecentReaderItem,
})
const readerMarksHydration = createReaderMarksHydration({
  getCurrentJobId: () => currentJobId.value,
  getCurrentReaderMarks,
  rememberMarksRevision: (jobId, revision) => rememberReaderRevision('marks', jobId, revision),
  restoreVisibleMarks: async (marks) => {
    replaceReaderMarksVisible(marks)
    if (typeof window.syncAnnotationGenerationEntryStatus === 'function') {
      await window.syncAnnotationGenerationEntryStatus()
    }
  },
  submitLocalChanges: () => {
    submitCurrentReaderMarks()
    syncReaderActivity('annotation')
  },
})

function rememberWorkflowRevision(payload) {
  const revision = Number(payload && payload.revision)
  if (!Number.isInteger(revision) || revision < 0) return
  if (workflowRevision.value === null || revision >= workflowRevision.value) workflowRevision.value = revision
  workflowRevisionNeedsRefresh = false
}

function getPendingWorkflowAction(actionId, actionType, targetJobId = '', payload = {}) {
  const key = String(actionId || '')
  const fingerprint = createWorkflowOperationFingerprint({ actionType, targetJobId, payload })
  const existing = pendingWorkflowActions.get(key)
  if (existing && existing.fingerprint === fingerprint) return existing
  const storedReceipt = readWorkflowOperationReceipt({ actionType, targetJobId, payload })
  const action = {
    key: storedReceipt?.operationKey || createYoutubeWorkflowOperationKey(key || 'workflow-action'),
    actionType: String(actionType || 'workflow'),
    targetJobId: String(targetJobId || ''),
    payload,
    fingerprint,
    inFlight: null,
  }
  if (!storedReceipt) writeWorkflowOperationReceipt({ actionType, targetJobId, payload, operationKey: action.key })
  pendingWorkflowActions.set(key, action)
  return action
}

function forgetPendingWorkflowAction(actionId) {
  const key = String(actionId || '')
  const action = pendingWorkflowActions.get(key)
  if (action) {
    removeWorkflowOperationReceipt({
      actionType: action.actionType,
      targetJobId: action.targetJobId,
      payload: action.payload,
    })
  }
  pendingWorkflowActions.delete(key)
}

function workflowMutationOptions(action) {
  const revision = workflowRevision.value
  if (!Number.isInteger(revision) || revision < 0 || workflowRevisionNeedsRefresh) {
    throw createWorkflowRevisionUnavailableError()
  }
  return {
    idempotencyKey: action.key,
    expectedRevision: revision,
  }
}

function runPendingWorkflowAction(actionId, actionType, targetJobId, payload, send) {
  const action = getPendingWorkflowAction(actionId, actionType, targetJobId, payload)
  if (!action.inFlight) {
    action.inFlight = Promise.resolve()
      .then(() => ensureWorkflowRevision())
      .then(() => send(action))
      .finally(() => {
        action.inFlight = null
      })
  }
  return action.inFlight
}

function isWorkflowMutationConflict(error) {
  return Number(error && error.status) === 409 && (
    error.code === 'WORKFLOW_STATE_CONFLICT'
    || error.actualRevision !== undefined
    || error.currentRevision !== undefined
  )
}

function createWorkflowRevisionUnavailableError() {
  const error = new Error('无法获取权威队列版本，操作未发送；请重试。')
  error.code = 'WORKFLOW_REVISION_UNAVAILABLE'
  error.category = 'storage'
  error.retryable = true
  return error
}

async function ensureWorkflowRevision() {
  if (Number.isInteger(workflowRevision.value) && workflowRevision.value >= 0 && !workflowRevisionNeedsRefresh) {
    return workflowRevision.value
  }
  try {
    const payload = await requestWorkflowSnapshot([], undefined, { includeAll: true })
    const revision = Number(payload && payload.revision)
    if (!Number.isInteger(revision) || revision < 0) throw createWorkflowRevisionUnavailableError()
    return revision
  } catch (error) {
    workflowRevisionNeedsRefresh = true
    workflowMutationNotice.value = '无法获取权威队列版本，未发送操作；请检查网络后重试。'
    if (error && error.code === 'WORKFLOW_REVISION_UNAVAILABLE') throw error
    throw createWorkflowRevisionUnavailableError()
  }
}

async function handleWorkflowMutationConflict(error) {
  const actualRevision = Number(error && (error.actualRevision ?? error.currentRevision))
  if (Number.isInteger(actualRevision) && actualRevision >= 0) {
    if (workflowRevision.value === null || actualRevision >= workflowRevision.value) workflowRevision.value = actualRevision
  }
  workflowRevisionNeedsRefresh = true
  try {
    await refreshQueue()
  } catch (_refreshError) {
    // Keep the typed conflict and known revision visible when the refresh is also offline.
  }
  workflowMutationNotice.value = '素材状态刚刚更新，请再试一次。'
}

const geminiMode = computed(() => {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('workflowMode') || window.localStorage.getItem('youtubeWorkflow.devMode') || 'real'
  return ['mock', 'off'].includes(requested) ? requested : 'real'
})
const enqueuableLinkCards = computed(() => linkCards.value.filter((card) => card.valid && !card.duplicate))
const duplicateLinkCards = computed(() => linkCards.value.filter((card) => card.valid && card.duplicate))
const invalidLinkCards = computed(() => linkCards.value.filter((card) => !card.valid))
const pendingValidLinkCount = computed(() => parseLinks(linkInput.value).filter((link) => isValidMaterialUrl(link)).length)
const enqueuableMaterialCount = computed(() => enqueuableLinkCards.value.length + pendingValidLinkCount.value)
const canEnqueue = computed(() => {
  return enqueuableMaterialCount.value > 0 && (geminiMode.value !== 'real' || !!apiKey.value.trim() || credentialStatus.value.stored)
})

function buildCreateJobPayload(url) {
  const payload = {
    url,
    geminiMode: geminiMode.value,
    model: model.value,
    baseUrl: baseUrl.value,
    videoPriority: videoPriority.value,
    autoOpenWhenReady: false,
    replacePolicy: 'ask'
  }
  if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
  return payload
}

function hasPendingCreateReceipt(url) {
  return Boolean(readWorkflowOperationReceipt({ actionType: 'create', payload: buildCreateJobPayload(url) }))
}

function findWorkflowDuplicate(url) {
  const materialKey = canonicalMaterialKey(url)
  const jobs = queueJobs.value.filter((job) => {
    const jobUrl = job?.request?.url || job?.url
    return canonicalMaterialKey(jobUrl) !== materialKey || !hasPendingCreateReceipt(jobUrl)
  })
  return findDuplicateMaterial(url, jobs, recentJobs.value)
}

const primaryActionText = computed(() => {
  if (starting.value) return '提交中…'
  if (enqueuableMaterialCount.value > 1) return `开始处理 ${enqueuableMaterialCount.value} 项`
  return '开始处理'
})
const taskGroups = computed(() => {
  const groups = groupTaskAttempts(queueJobs.value)
  const completed = queueJobs.value
    .filter((job) => job?.status === 'ready' && visibleCompletedJobIds.value.includes(job.jobId))
    .map((job) => ({
      key: `completed:${job.jobId}`,
      attempts: [job],
      active: null,
      latest: job,
      displayJob: job,
      statusKind: 'completed',
      attemptCount: 1,
    }))
  return [...groups, ...completed]
})
const activeTaskCount = computed(() => taskGroups.value.filter((group) => group.statusKind === 'active').length)
const failedTaskCount = computed(() => taskGroups.value.filter((group) => group.statusKind === 'failed').length)
const activeTaskEntryText = computed(() => {
  if (activeTaskCount.value !== 1) return `${activeTaskCount.value} 项`
  const group = taskGroups.value.find((item) => item.statusKind === 'active')
  return jobStageFraction(group?.displayJob)
})
const taskSummary = computed(() => `${activeTaskCount.value} 项处理中 · ${failedTaskCount.value} 项需要处理`)
const librarySummary = computed(() => `${recentJobs.value.length}${libraryHasMore.value ? '+' : ''} 项`)

watch(model, (value) => saveTextSetting('youtubeWorkflow.model', value))
watch(baseUrl, (value) => saveTextSetting('youtubeWorkflow.baseUrl', value))

function getMediaSource() {
  return typeof window !== 'undefined' ? window.__mediaSource : null
}

function syncVideoPreferred(value) {
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.setVideoPreferred === 'function') {
    mediaSource.setVideoPreferred(!!value)
  }
  if (value) refreshCurrentJobMediaForVideoPriority()
}

async function refreshCurrentJobMediaForVideoPriority() {
  if (!currentJobId.value) return
  const mediaSource = getMediaSource()
  if (!mediaSource || typeof mediaSource.loadJobMedia !== 'function') return
  const currentMediaState = typeof mediaSource.getState === 'function' ? mediaSource.getState() : null
  if (currentMediaState && currentMediaState.jobId === currentJobId.value && currentMediaState.videoAvailable) return
  try {
    const manifest = await youtubeWorkflowClient.getSession(currentJobId.value)
    const files = manifest && manifest.files && typeof manifest.files === 'object' ? manifest.files : {}
    if (!files.video) return
    const media = manifest && manifest.media && typeof manifest.media === 'object' ? manifest.media : {}
    mediaSource.loadJobMedia({
      jobId: currentJobId.value,
      title: manifest.title || '',
      hasVideo: true,
      videoUrl: youtubeWorkflowClient.mediaUrl(currentJobId.value, 'video'),
      videoSource: media.videoSource || 'session-refresh'
    })
    if (typeof mediaSource.setVideoPreferred === 'function') mediaSource.setVideoPreferred(true)
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'panel-current-video-refresh',
      reason: 'optional video metadata refresh must not interrupt reader playback',
    })
  }
}

onMounted(() => {
  window.localStorage.removeItem(['youtubeWorkflow', 'apiKey'].join('.'))
  cleanupWorkflowOperationReceipts()
  syncVideoPreferred(videoPriority.value)
  readerPlaybackTracker.bindPlaybackTracking()
  ensureCurrentJobFromAudioMeta()
  observeBestEffort(replayReaderOutbox(), {
    operationId: 'reader-outbox-startup-replay',
    reason: 'reader outbox replay remains available for explicit retry after startup failure',
  })
  window.addEventListener('reader-marks-changed', handleReaderMarksChanged)
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handleReaderPageHide)
  window.addEventListener('pageshow', handleReaderPageShow)
})

onBeforeUnmount(() => {
  if (completionSignalTimer) window.clearTimeout(completionSignalTimer)
  if (materialNoticeTimer) window.clearTimeout(materialNoticeTimer)
  if (libraryRetryTimer) window.clearTimeout(libraryRetryTimer)
  completedTaskTimers.forEach((timer) => window.clearTimeout(timer))
  completedTaskTimers.clear()
  qualityActionGuard.dispose()
  qualityDialogController.dispose()
  panelDialogController.dispose()
  stopPolling()
  jobPollingScheduler?.dispose()
  jobPollingScheduler = null
  readerSessionLoader?.cancelLoad()
  readerSessionLoader = null
  handleBeforeUnload()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('pagehide', handleReaderPageHide)
  window.removeEventListener('pageshow', handleReaderPageShow)
  window.removeEventListener('reader-marks-changed', handleReaderMarksChanged)
  readerPlaybackTracker.unbindPlaybackTracking()
  readerMarksHydration.clear()
  disposeReaderSaveCoordinator()
  diagnosticsDownloader.dispose()
})

watch(panelOpen, async (open) => {
  if (!open) {
    panelDialogController.close()
    return
  }
  await nextTick()
  if (!panelDialogRoot.value) return
  panelDialogController.open(panelDialogRoot.value, {
    initialFocus: panelDialogRoot.value.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'),
    isPending: () => panelPending.value,
    onRequestClose: closePanel,
  })
})

watch(panelPending, (pending) => panelDialogController.setBusy(pending))

watch(qualityModal, async (modal) => {
  if (!modal) {
    qualityDialogController.close()
    return
  }
  await nextTick()
  if (!qualityDialogRoot.value) return
  qualityDialogController.open(qualityDialogRoot.value, {
    initialFocus: qualityDialogInitialFocus.value,
    statusElement: qualityDialogStatus.value,
    isPending: () => qualityPending.value,
    onRequestClose: closeQualityModal,
  })
})

watch(qualityPending, (pending) => qualityDialogController.setBusy(pending))

function makeLoader() {
  if (readerSessionLoader) return readerSessionLoader
  const audioPlayer = document.getElementById('audio-player')
  const applyCurrentAudioMeta = (meta) => {
    if (typeof window.applyCurrentAudioMeta === 'function') window.applyCurrentAudioMeta(meta)
    else runtimeState.currentAudioMeta = meta
  }
  const publisher = createReaderSessionPublisher({
    state: runtimeState,
    audioPlayer,
    mediaSource: window.__mediaSource,
    applyCurrentAudioMeta,
    processTranscript: window.processTranscript,
    processChunkData: window.processChunkData,
    scheduleGeneratedAnnotationIndexRefresh,
    applyReaderMarks: replaceReaderMarksVisible,
    syncReaderMarksVisuals: syncMarkedWordVisuals,
    bridgeToPinia,
    resetChunkDisplay: resetChunkChineseDisplay,
  })
  readerSessionLoader = createYoutubeWorkflowLoader({
    client: youtubeWorkflowClient,
    readerSessionPersistence: readerSessionPersistence,
    readerSessionOwner: window.__windowsOwnerReaderSessionConsumer || null,
    applyCurrentAudioMeta,
    processTranscript: window.processTranscript,
    processChunkData: window.processChunkData,
    audioPlayer,
    sessionPublisher: publisher,
    validateTranscriptData: window.DataUtils && window.DataUtils.validateTranscriptData,
    validateChunkData: window.DataUtils && window.DataUtils.validateChunkData,
    applyReaderMarks,
    annotationLightweightModule: window.__annotationLightweightModule,
    onReaderMarksLoaded(payload) {
      if (Number.isInteger(payload?.revision)) rememberReaderRevision('marks', String(payload.jobId || currentJobId.value || ''), payload.revision)
    },
    showToast: window.showToast
  })
  return readerSessionLoader
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
  window.setTimeout(() => commitLinkInput(), 0)
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
    const card = {
      id: `link-${Date.now()}-${++linkSequence}`,
      url,
      valid,
      duplicate: valid ? findWorkflowDuplicate(url) : null,
      metadataState: valid && extractYoutubeVideoId(url) ? 'loading' : 'idle',
      metadataTitle: '',
      metadataAuthor: '',
    }
    nextCards.push(card)
    if (card.metadataState === 'loading') observeBestEffort(hydrateLinkCardMetadata(card), {
      operationId: `material-link-metadata-${card.id}`,
      reason: 'video metadata is optional; the stable YouTube video ID remains usable when oEmbed is unavailable',
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
  return canonicalMaterialKey(value)
}

function existingMaterialKeys() {
  const keys = new Set()
  for (const card of linkCards.value) {
    if (card.valid) keys.add(normalizeMaterialUrl(card.url))
  }
  return keys
}

async function hydrateLinkCardMetadata(card) {
  const videoId = extractYoutubeVideoId(card.url)
  if (!videoId) return
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 4000)
  try {
    const endpoint = new URL('https://www.youtube.com/oembed')
    endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`)
    endpoint.searchParams.set('format', 'json')
    const response = await fetch(endpoint, { signal: controller.signal })
    if (!response.ok) throw new Error(`metadata ${response.status}`)
    const metadata = await response.json()
    card.metadataTitle = String(metadata?.title || '').trim()
    card.metadataAuthor = String(metadata?.author_name || '').trim()
    card.metadataState = 'ready'
  } catch (_error) {
    card.metadataState = 'unavailable'
  } finally {
    window.clearTimeout(timer)
  }
}

function refreshLinkDuplicates() {
  for (const card of linkCards.value) {
    card.duplicate = card.valid
      ? findWorkflowDuplicate(card.url)
      : null
  }
}

function linkCardStateText(card) {
  if (!card.valid) return '链接格式无效'
  if (card.duplicate) return duplicateStateText(card.duplicate)
  if (card.metadataState === 'loading') return '正在读取视频信息'
  return '可以添加'
}

function linkCardFallbackTitle(card) {
  const videoId = extractYoutubeVideoId(card?.url)
  return videoId ? `YouTube 视频 · ${videoId}` : shortUrl(card?.url)
}

function removeLinkCard(id) {
  linkCards.value = linkCards.value.filter((card) => card.id !== id)
  if (!linkCards.value.length) linkNotice.value = ''
}

async function enqueueUrls() {
  commitLinkInput()
  refreshLinkDuplicates()
  const cards = enqueuableLinkCards.value
  if (!cards.length) return
  if (geminiMode.value === 'real' && !apiKey.value.trim() && !credentialStatus.value.stored) return
  starting.value = true
  workflowMutationNotice.value = ''
  let submittedCount = 0
  try {
    for (const card of cards) {
      const payload = buildCreateJobPayload(card.url)
      const actionId = `create:${card.id}`
      try {
        const job = await runPendingWorkflowAction(actionId, 'create', '', payload, (action) => {
          return youtubeWorkflowClient.createJob(payload, workflowMutationOptions(action))
        })
        rememberWorkflowRevision(job)
        updateJob(card.metadataTitle ? { ...job, title: card.metadataTitle } : job)
        linkCards.value = linkCards.value.filter((item) => item.id !== card.id)
        forgetPendingWorkflowAction(actionId)
        submittedCount += 1
      } catch (err) {
        if (isWorkflowMutationConflict(err)) await handleWorkflowMutationConflict(err)
        else if (err?.code === 'MATERIAL_ALREADY_EXISTS') {
          card.duplicate = duplicateFromServerError(err, card.url)
          linkNotice.value = '已阻止重复处理；可打开已有素材或明确重新处理。'
        } else linkNotice.value = err && err.message ? err.message : String(err)
        break
      }
    }
    if (submittedCount) {
      linkNotice.value = ''
      workflowView.value = 'queue'
      startPolling()
    }
  } finally {
    starting.value = false
  }
}

function openPanel() {
  panelOpen.value = true
  workflowView.value = 'library'
  libraryRetryCount = 0
  if (libraryRetryTimer) {
    window.clearTimeout(libraryRetryTimer)
    libraryRetryTimer = 0
  }
  observeBestEffort(refreshQueue(), {
    operationId: 'material-center-task-refresh',
    reason: 'task status refresh must not block opening the fixed material panel',
  })
  observeBestEffort(refreshLibrary(), {
    operationId: 'material-center-library-refresh',
    reason: 'library refresh runs after the panel is already interactive',
  })
}

function setWorkflowView(view) {
  workflowView.value = view
  if (view === 'queue') refreshQueue()
  if (view === 'library') refreshLibrary()
  if (view === 'settings' || view === 'add') {
    loadBackendConfig()
    loadCredentialStatus()
  }
}

function closePanel() {
  panelOpen.value = false
  apiKey.value = ''
}

async function refreshQueue() {
  workflowRevisionNeedsRefresh = true
  await refreshJobsSnapshot(queueJobs.value.map((job) => job.jobId))
  refreshLinkDuplicates()
}

function requestWorkflowSnapshot(jobIds, signal, options = {}) {
  if (workflowSnapshotFlight) return workflowSnapshotFlight
  const ids = Array.isArray(jobIds) ? jobIds : []
  const includeAll = options.includeAll === true || ids.length === 0
  let flight
  flight = youtubeWorkflowClient.getJobsSnapshot(ids, {
    signal,
    includeAll,
  })
    .then((payload) => {
      rememberWorkflowRevision(payload)
      const jobs = payload && Array.isArray(payload.jobs) ? payload.jobs : []
      jobs.forEach(updateJob)
      return payload
    })
    .catch((error) => {
      workflowRevisionNeedsRefresh = true
      throw error
    })
    .finally(() => {
      if (workflowSnapshotFlight === flight) workflowSnapshotFlight = null
    })
  workflowSnapshotFlight = flight
  return flight
}

async function refreshJobsSnapshot(jobIds, signal) {
  const ids = Array.isArray(jobIds) ? jobIds : []
  const payload = await requestWorkflowSnapshot(ids, signal, { includeAll: ids.length === 0 })
  const jobs = payload && Array.isArray(payload.jobs) ? payload.jobs : []
  return jobs
}

async function refreshLibrary(options = {}) {
  const append = options.append === true
  if (libraryPending.value) return
  libraryPending.value = true
  try {
    const offset = append ? recentJobs.value.length : 0
    const items = await youtubeWorkflowClient.readerRecent({
      limit: libraryPageSize,
      offset,
      timeScope: libraryTimeScope.value,
    })
    const normalized = Array.isArray(items)
      ? items.filter((item) => item && item.jobId).map((item) => ({ ...item, ...(repairStates.get(item.jobId) || {}) }))
      : []
    recentJobs.value = append ? [...recentJobs.value, ...normalized] : normalized
    recentJobs.value.sort((left, right) => materialTimestamp(right) - materialTimestamp(left))
    libraryHasMore.value = normalized.length === libraryPageSize
    refreshLinkDuplicates()
    serviceOnline.value = true
    serviceStatusKnown.value = true
    libraryRetryCount = 0
    readerActivityNotice.value = ''
  } catch (err) {
    serviceStatusKnown.value = true
    if (err?.code === 'owner-not-ready') {
      serviceOnline.value = true
      readerActivityNotice.value = libraryRetryCount === 0
        ? 'Windows 后台正在启动，素材库会自动刷新…'
        : 'Windows 后台尚未就绪，请稍后再打开素材库。'
      if (libraryRetryCount === 0 && !libraryRetryTimer) {
        libraryRetryCount = 1
        libraryRetryTimer = window.setTimeout(() => {
          libraryRetryTimer = 0
          if (!panelOpen.value || workflowView.value !== 'library') return
          observeBestEffort(refreshLibrary(), {
            operationId: 'material-center-library-retry',
            reason: 'retry one transient Windows owner startup read after the panel is interactive',
          })
        }, 750)
      }
    } else {
      serviceOnline.value = false
      readerActivityNotice.value = err && err.message ? err.message : String(err)
    }
  } finally {
    libraryPending.value = false
  }
}

function refreshRecent() {
  return refreshLibrary()
}

function setLibraryTimeScope(scope) {
  if (libraryTimeScope.value === scope && recentJobs.value.length) return
  libraryTimeScope.value = scope
  recentJobs.value = []
  libraryHasMore.value = false
  refreshLibrary()
}

function loadMoreLibrary() {
  return refreshLibrary({ append: true })
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
  } catch (error) {
    const presented = recordBestEffortFailure(error, {
      operationId: 'panel-backend-config-load',
      reason: 'settings view keeps its current defaults when optional backend config is unavailable',
    })
    backendConfigNotice.value = `${presented.notice.message} (${presented.notice.operationId})`
  }
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
    apiKey.value = ''
    credentialNotice.value = options.silent ? '' : 'API Key 已保存'
  } catch (err) {
    credentialNotice.value = err && err.message ? err.message : String(err)
    if (options.silent) throw err
  }
}

function confirmDeleteCredential() {
  if (!window.confirm('清除 API Key 后，新任务将无法进行 AI 处理。确定清除吗？')) return
  deleteCredential()
}

async function deleteCredential() {
  try {
    credentialStatus.value = await youtubeWorkflowClient.deleteCredential()
    credentialNotice.value = 'API Key 已清除'
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
    diagnosticsDownloader.download(blob, `subtitle-workflow-diagnostics-${Date.now()}.zip`)
    backendConfigNotice.value = '诊断包已导出'
  } catch (err) {
    backendConfigNotice.value = err && err.message ? err.message : String(err)
  }
}

async function refreshJob(jobId) {
  try {
    const fresh = await youtubeWorkflowClient.getJob(jobId)
    updateJob(fresh)
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'panel-job-refresh',
      reason: 'polling retains the previous immutable job snapshot until the next scheduled refresh',
      details: { jobId },
    })
  }
}

function updateJob(fresh) {
  rememberWorkflowRevision(fresh)
  const index = queueJobs.value.findIndex((job) => job.jobId === fresh.jobId)
  const previous = index >= 0 ? queueJobs.value[index] : null
  if (previous?.title && !fresh.title) fresh = { ...fresh, title: previous.title }
  if (index >= 0) queueJobs.value[index] = fresh
  else queueJobs.value.push(fresh)
  if (fresh.status === 'ready' && previous && previous.status !== 'ready') {
    completionSignal.value = true
    visibleCompletedJobIds.value = [...new Set([...visibleCompletedJobIds.value, fresh.jobId])]
    const previousTaskTimer = completedTaskTimers.get(fresh.jobId)
    if (previousTaskTimer) window.clearTimeout(previousTaskTimer)
    completedTaskTimers.set(fresh.jobId, window.setTimeout(() => {
      visibleCompletedJobIds.value = visibleCompletedJobIds.value.filter((jobId) => jobId !== fresh.jobId)
      completedTaskTimers.delete(fresh.jobId)
    }, 5000))
    if (completionSignalTimer) window.clearTimeout(completionSignalTimer)
    completionSignalTimer = window.setTimeout(() => { completionSignal.value = false }, 5000)
    refreshLibrary()
  }
  if (terminalStatuses.has(fresh.status) && (!previous || previous.status !== fresh.status)) {
    refreshRecent()
    window.setTimeout(startPolling, 0)
  }
}

function startPolling() {
  if (!jobPollingScheduler) {
    jobPollingScheduler = createJobPollingScheduler({
      fetchJobs: (jobIds, signal) => refreshJobsSnapshot(jobIds, signal),
      onJobs: () => {},
      onError: (error) => {
        readerActivityNotice.value = error && error.message ? error.message : String(error)
      },
      isHidden: () => document.hidden,
      intervalMs: 2000,
      hiddenIntervalMs: 10000,
    })
  }
  const activeIds = queueJobs.value
    .filter((job) => !terminalStatuses.has(job.status))
    .map((job) => job.jobId)
  if (activeIds.length) jobPollingScheduler.start(activeIds)
  else jobPollingScheduler.stop()
}

function stopPolling() {
  jobPollingScheduler?.stop()
}

function openJob(job) {
  if (!job?.jobId || openingJobId.value) return
  clearMaterialNotice()
  openingJobId.value = job.jobId
  hidePanelAfterLoad()
  loadJob(job)
}

function openRecentJob(job) {
  openJob(normalizeRecentJob(job))
}

async function loadJob(job) {
  try {
    if (currentJobId.value && currentJobId.value !== job.jobId) {
      observeBestEffort(syncReaderActivity('switch'), {
        operationId: `reader-background-switch-save-${currentJobId.value}`,
        reason: 'captured reader progress persists in the background and never blocks opening the next material',
      })
    }
    readerSessionLoadInProgress = true
    const shouldResumeAudio = !!(getAudio() && !getAudio().paused)
    const result = await makeLoader().loadJobIntoReader(job.jobId, { replacePolicy: 'replace-current' })
    if (!result || result.status !== 'loaded') return
    clearMaterialRepairState(job.jobId)
    currentJobId.value = job.jobId
    updateReaderConflictVisibility()
    loadedReadyJobs.add(job.jobId)
    readerPlaybackTracker.startReaderSession(job)
    observeBestEffort(youtubeWorkflowClient.getReaderActivity(job.jobId).then((activity) => {
      if (Number.isInteger(activity?.revision)) rememberReaderRevision('activity', job.jobId, activity.revision)
    }), {
      operationId: `reader-background-activity-load-${job.jobId}`,
      reason: 'activity revision hydration is not required for the first rendered reader frame',
    })
    observeBestEffort(syncReaderActivity('open', { manifest: result && result.manifest }), {
      operationId: `reader-background-open-save-${job.jobId}`,
      reason: 'open activity persists after the material is already visible',
    })
    observeBestEffort(refreshLibrary(), {
      operationId: `reader-background-library-refresh-${job.jobId}`,
      reason: 'library ordering refresh is secondary to displaying the selected material',
    })
    const audio = getAudio()
    if (audio) audio.pause()
    if (shouldResumeAudio) resumeReaderAudioFromPanel()
  } catch (err) {
    showMaterialLoadFailure(job, err)
  } finally {
    readerSessionLoadInProgress = false
    if (openingJobId.value === job.jobId) openingJobId.value = ''
  }
}

function hidePanelAfterLoad() {
  panelOpen.value = false
}

function classifyMaterialLoadFailure(error) {
  const code = String(error?.code || error?.category || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()
  const combined = `${code} ${message}`
  if (/chunk|segment|translation/u.test(combined)) {
    return { message: 'AI 切分结果不可用，请重新 AI 切分', actionLabel: '重新 AI 切分', action: 'segmenting' }
  }
  if (/subtitle|transcript|caption/u.test(combined)) {
    return { message: '字幕不可用，请重新生成字幕', actionLabel: '重新生成字幕', action: 'transcribing' }
  }
  if (/credential|api.?key|auth|gemini/u.test(combined)) {
    return { message: 'API 认证失效，请检查设置', actionLabel: '检查设置', action: 'settings' }
  }
  if (/owner-not-ready|reader-session-(?:conflict|commit-unknown)|reader session owner/u.test(combined)) {
    return { message: 'Windows 阅读器状态同步失败，请稍后重新打开', actionLabel: '查看原因', action: 'details' }
  }
  if (/file|media|audio|range|missing|incomplete|404|410/u.test(combined)) {
    return { message: '本地素材不完整，请重新下载', actionLabel: '重新下载', action: 'downloading' }
  }
  const concise = String(error?.message || '素材暂时无法读取').trim().slice(0, 88)
  return { message: `${concise}，请查看原因`, actionLabel: '查看原因', action: 'details' }
}

function showMaterialLoadFailure(job, error) {
  const failure = classifyMaterialLoadFailure(error)
  repairStates.set(job.jobId, {
    needsRepair: true,
    repairReason: failure.message,
    repairAction: failure.action,
  })
  recentJobs.value = recentJobs.value.map((item) => (
    item.jobId === job.jobId ? { ...item, ...repairStates.get(job.jobId) } : item
  ))
  materialNotice.value = { ...failure, job, error }
  resumeMaterialNotice()
}

function clearMaterialRepairState(jobId) {
  repairStates.delete(jobId)
  recentJobs.value = recentJobs.value.map((item) => {
    if (item.jobId !== jobId) return item
    const { needsRepair: _needsRepair, repairReason: _repairReason, repairAction: _repairAction, ...readyItem } = item
    return readyItem
  })
}

function pauseMaterialNotice() {
  if (materialNoticeTimer) window.clearTimeout(materialNoticeTimer)
  materialNoticeTimer = 0
}

function resumeMaterialNotice() {
  pauseMaterialNotice()
  if (!materialNotice.value) return
  materialNoticeTimer = window.setTimeout(clearMaterialNotice, 10000)
}

function clearMaterialNotice() {
  pauseMaterialNotice()
  materialNotice.value = null
}

function runMaterialNoticeAction() {
  const notice = materialNotice.value
  if (!notice) return
  clearMaterialNotice()
  openPanel()
  if (notice.action === 'settings') {
    setWorkflowView('settings')
    return
  }
  if (notice.action === 'details') {
    setWorkflowView('library')
    expandedLibraryJobId.value = notice.job?.jobId || ''
    return
  }
  setWorkflowView('queue')
  if (notice.job) retryJob(notice.job, notice.action)
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
  if (!cleaned.length) {
    const stage = String(job?.stage || job?.status || '').toLowerCase()
    const fallback = {
      queued: '任务已排队，等待后台工作线程…',
      downloading: '正在下载视频素材…',
      transcribing: '正在使用 WhisperX 生成逐词字幕…',
      segmenting: '正在请求 Gemini 生成英语语块…',
      translating: '正在请求 Gemini 生成中文翻译…',
      validating: '正在校验字幕、语块和阅读器文件…',
    }
    return [fallback[stage] || '后台正在处理，等待下一条进度…']
  }
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

function jobSourceText(job) {
  const sourcePath = job && (
    job.audioPath
    || job.videoPath
    || job.sourcePath
    || (job.sourceMap && job.sourceMap.originalAudio && job.sourceMap.originalAudio.path)
    || (job.sourceMap && job.sourceMap.originalVideo && job.sourceMap.originalVideo.path)
    || (job.request && (job.request.audioPath || job.request.videoPath))
  )
  if (sourcePath) return shortPath(sourcePath)
  const url = job && (job.url || (job.request && job.request.url))
  if (url) return shortUrl(url)
  return job && job.jobId ? `任务 ${job.jobId}` : '暂无来源'
}

function taskSourceText(job) {
  const stamp = exactJobTime(job)
  const videoId = extractYoutubeVideoId(job?.request?.url || job?.url)
  return [videoId ? `YouTube · ${videoId}` : '', stamp].filter(Boolean).join(' · ') || jobSourceText(job)
}

function exactJobTime(job) {
  return exactDateTime(job?.updatedAt || job?.finishedAt || job?.createdAt)
}

function failureReasonText(job) {
  const error = job?.error || {}
  const reason = String(error.message || '').trim()
  const diagnosticText = [error.code, reason, ...(Array.isArray(job?.logSummary) ? job.logSummary : [])]
    .filter(Boolean)
    .join('\n')
  if (
    error.code === 'YOUTUBE_MEDIA_HTTP_403'
    || (/\b403\b|forbidden/iu.test(diagnosticText) && /youtube|yt-dlp|download video data/iu.test(diagnosticText))
  ) {
    return 'YouTube 媒体授权失败（HTTP 403），请重新处理'
  }
  if (reason) return reason
  const category = String(error.category || '').trim()
  return category ? `${errorLabel(category)}需要重新处理` : '处理未完成，请重试'
}

function libraryStamp(job) {
  return job?.lastActivityAt || job?.lastOpenedAt || job?.finishedAt || job?.createdAt
}

function libraryRelativeTime(job) {
  const stamp = libraryStamp(job)
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return '很久之前'
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.max(0, Math.floor((startToday - startDate) / (24 * 60 * 60 * 1000)))
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days <= 7) return `${days} 天前`
  return '很久之前'
}

function libraryExactTime(job) {
  return exactDateTime(libraryStamp(job))
}

function librarySourceText(job) {
  const videoId = extractYoutubeVideoId(job?.url || job?.request?.url)
  if (videoId) return `YouTube · ${videoId}`
  return job?.sourceType === 'legacy-import' ? '本地导入素材' : '学习素材'
}

function toggleLibraryMenu(job) {
  expandedLibraryJobId.value = expandedLibraryJobId.value === job?.jobId ? '' : job?.jobId || ''
}

function duplicateStateText(duplicate) {
  if (!duplicate) return ''
  if (duplicate.state === 'active') return '这个视频正在处理中'
  if (duplicate.state === 'failed') return '这个视频此前处理失败'
  return '这个视频已经处理过'
}

function duplicateFromServerError(error, url) {
  const existing = error?.detail?.existing || {}
  const status = String(existing.status || '').toLowerCase()
  return {
    key: error?.detail?.materialKey || canonicalMaterialKey(url),
    youtubeVideoId: extractYoutubeVideoId(url),
    job: { ...existing, request: { url: existing.url || url }, url: existing.url || url },
    state: terminalStatuses.has(status)
      ? status === 'failed' ? 'failed' : 'ready'
      : 'active',
    matches: [existing],
  }
}

async function deleteFailedTaskGroup(group) {
  const ids = group.attempts
    .filter((attempt) => attempt?.status === 'failed')
    .map((attempt) => attempt.jobId)
  if (!ids.length) return
  workflowMutationNotice.value = ''
  try {
    for (const jobId of ids) {
      await ensureWorkflowRevision()
      const deleted = await youtubeWorkflowClient.deleteJob(jobId, {
        expectedRevision: workflowRevision.value,
      })
      rememberWorkflowRevision(deleted)
      queueJobs.value = queueJobs.value.filter((job) => job.jobId !== jobId)
    }
    refreshLinkDuplicates()
  } catch (error) {
    if (isWorkflowMutationConflict(error)) await handleWorkflowMutationConflict(error)
    else workflowMutationNotice.value = error?.message || String(error)
  }
}

async function deleteLibraryRecord(job) {
  if (!job?.jobId) return
  const title = jobDisplayTitle(job) || librarySourceText(job)
  if (!window.confirm(`只删除素材库记录，不删除已生成文件。\n\n${title}\n\n确定继续吗？`)) return
  workflowMutationNotice.value = ''
  try {
    await ensureWorkflowRevision()
    const deleted = await youtubeWorkflowClient.deleteJob(job.jobId, {
      expectedRevision: workflowRevision.value,
    })
    rememberWorkflowRevision(deleted)
    recentJobs.value = recentJobs.value.filter((item) => item.jobId !== job.jobId)
    queueJobs.value = queueJobs.value.filter((item) => item.jobId !== job.jobId)
    expandedLibraryJobId.value = ''
    refreshLinkDuplicates()
  } catch (error) {
    if (isWorkflowMutationConflict(error)) await handleWorkflowMutationConflict(error)
    else workflowMutationNotice.value = error?.message || String(error)
  }
}

async function clearFailedTasks() {
  if (!window.confirm('只清除失败提示和失败任务记录，不会删除成功素材或复习数据。继续吗？')) return
  workflowMutationNotice.value = ''
  try {
    await ensureWorkflowRevision()
    const cleared = await youtubeWorkflowClient.clearFailedJobs({
      expectedRevision: workflowRevision.value,
    })
    rememberWorkflowRevision(cleared)
    queueJobs.value = queueJobs.value.filter((job) => job.status !== 'failed')
    refreshLinkDuplicates()
  } catch (error) {
    if (isWorkflowMutationConflict(error)) await handleWorkflowMutationConflict(error)
    else workflowMutationNotice.value = error?.message || String(error)
  }
}

async function confirmReprocess(job, explicitUrl = '') {
  const url = explicitUrl || job?.url || job?.request?.url
  if (!url) return
  const title = jobDisplayTitle(job) || linkCardFallbackTitle({ url })
  if (!window.confirm(`重新处理会创建一个新的后台任务，已有成功素材会继续保留。\n\n${title}`)) return
  const payload = { ...buildCreateJobPayload(url), forceReprocess: true }
  const actionId = `reprocess:${job?.jobId || canonicalMaterialKey(url)}:${Date.now()}`
  try {
    const created = await runPendingWorkflowAction(actionId, 'create', '', payload, (action) => (
      youtubeWorkflowClient.createJob(payload, workflowMutationOptions(action))
    ))
    updateJob(created)
    forgetPendingWorkflowAction(actionId)
    expandedLibraryJobId.value = ''
    setWorkflowView('queue')
    startPolling()
  } catch (error) {
    workflowMutationNotice.value = error?.message || String(error)
  }
}

function historySourceText(job) {
  return jobSourceText(job)
}

function jobStageFraction(job) {
  const stage = String(job?.stage || job?.status || '').toLowerCase()
  if (stage === 'queued') return '等待中'
  if (stage === 'downloading') return '1/4'
  if (stage === 'transcribing') return '2/4'
  if (stage === 'segmenting' || stage === 'translating') return '3/4'
  if (stage === 'validating' || stage === 'ready') return '4/4'
  return ''
}

function jobStageProgressText(job) {
  const stage = String(job?.stage || job?.status || '').toLowerCase()
  if (job?.status === 'failed') return '处理失败'
  if (job?.status === 'canceled') return '已取消'
  if (stage === 'queued') return '等待开始'
  if (stage === 'downloading') return '1/4 · 下载素材'
  if (stage === 'transcribing') return '2/4 · 生成字幕'
  if (stage === 'segmenting' || stage === 'translating') return '3/4 · AI 切分与翻译'
  if (stage === 'validating') return '4/4 · 正在检查'
  if (stage === 'ready') return '4/4 · 已完成'
  return statusText(job || {})
}

function jobProgressPercent(job) {
  if (!job) return 0
  const direct = Number(job.progressPercent ?? job.progress ?? job.percent)
  if (Number.isFinite(direct) && direct >= 0) return Math.max(0, Math.min(100, direct <= 1 ? direct * 100 : direct))
  const stage = String(job.stage || job.status || '')
  const fallback = {
    queued: 6,
    downloading: 25,
    transcribing: 50,
    segmenting: 75,
    translating: 75,
    validating: 92,
    ready: 100,
    failed: 100,
    canceled: 100
  }
  return fallback[stage] ?? fallback[job.status] ?? 0
}

function clampRatio(value) {
  const ratio = Number(value)
  if (!Number.isFinite(ratio) || ratio <= 0) return 0
  return Math.max(0, Math.min(1, ratio))
}

function readerProgressRatio(job) {
  if (!job) return 0
  const coverage = Number(job.overallCoverageRatio)
  if (Number.isFinite(coverage) && coverage > 0) return clampRatio(coverage)
  const position = Number(job.lastPositionSeconds)
  const duration = Number(job.durationSeconds)
  if (Number.isFinite(position) && position > 0 && Number.isFinite(duration) && duration > 0) {
    return clampRatio(position / duration)
  }
  return 0
}

function readerCompletedForDisplay(job) {
  return !!(job && (job.completed || readerProgressRatio(job) >= 0.97))
}

function readerProgressPercent(job) {
  if (!job) return 0
  if (readerCompletedForDisplay(job)) return 100
  return Math.max(0, Math.min(100, readerProgressRatio(job) * 100))
}

function recentTaskMetaText(job) {
  const stamp = formatShortDate(job && (job.finishedAt || job.updatedAt || job.createdAt))
  return stamp || '最近完成'
}

function readStatusText(job) {
  if (readerCompletedForDisplay(job)) {
    const count = Number(job.completedCount || 0)
    return count > 1 ? `已听完 ${count} 次` : '已听完'
  }
  if ((job && job.readStatus === 'in-progress') || readerProgressRatio(job) > 0) return '未听完'
  return '未开始'
}

function readerTimeText(job) {
  const stamp = job && (job.lastActivityAt || job.finishedAt || job.createdAt)
  if (!stamp) return '暂无阅读时间'
  return formatRelativeTime(stamp)
}

function readerProgressText(job) {
  const parts = []
  const ratio = readerProgressRatio(job)
  if (readerCompletedForDisplay(job)) {
    parts.push('已听完')
  } else if (ratio > 0) {
    parts.push(`已听 ${Math.max(1, Math.round(ratio * 100))}%`)
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

function recentOpenActionText(job) {
  if (!job) return '打开'
  if (job.jobId === currentJobId.value) return '当前阅读中'
  if (!readerCompletedForDisplay(job)) return '继续'
  return loadedReadyJobs.has(job.jobId) ? '重新打开' : '打开'
}

async function cancelJob(job) {
  const actionId = `cancel:${job.jobId}`
  workflowMutationNotice.value = ''
  try {
    const canceled = await runPendingWorkflowAction(actionId, 'cancel', job.jobId, {}, (action) => {
      return youtubeWorkflowClient.cancelJob(job.jobId, workflowMutationOptions(action))
    })
    updateJob(canceled)
    forgetPendingWorkflowAction(actionId)
  } catch (err) {
    if (isWorkflowMutationConflict(err)) await handleWorkflowMutationConflict(err)
    else workflowMutationNotice.value = err && err.message ? err.message : String(err)
  }
}

async function prioritizeJob(job) {
  const actionId = `prioritize:${job.jobId}`
  workflowMutationNotice.value = ''
  try {
    const updated = await runPendingWorkflowAction(actionId, 'prioritize', job.jobId, {}, (action) => {
      return youtubeWorkflowClient.prioritizeJob(job.jobId, workflowMutationOptions(action))
    })
    updateJob(updated)
    forgetPendingWorkflowAction(actionId)
  } catch (err) {
    if (isWorkflowMutationConflict(err)) await handleWorkflowMutationConflict(err)
    else workflowMutationNotice.value = err && err.message ? err.message : String(err)
  }
}

async function retryJob(job, stage = '') {
  const payload = { model: model.value, baseUrl: baseUrl.value, videoPriority: videoPriority.value }
  if (stage) payload.stage = stage
  if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
  const actionId = `retry:${job.jobId}:${stage || 'auto'}`
  workflowMutationNotice.value = ''
  try {
    const retried = await runPendingWorkflowAction(actionId, 'retry', job.jobId, payload, (action) => {
      return youtubeWorkflowClient.retryJob(job.jobId, payload, workflowMutationOptions(action))
    })
    updateJob(retried)
    forgetPendingWorkflowAction(actionId)
    qualityModal.value = null
    startPolling()
  } catch (err) {
    if (isWorkflowMutationConflict(err)) await handleWorkflowMutationConflict(err)
    else workflowMutationNotice.value = err && err.message ? err.message : String(err)
  }
}

async function retryQualityJob(job, stage) {
  await qualityActionGuard.run(() => retryJob(job, stage))
}

function closeQualityModal() {
  if (qualityPending.value) return
  qualityModal.value = null
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
  return text.length > 72 ? `${text.slice(0, 69)}…` : text
}

function shortPath(value) {
  const text = String(value || '')
  return text.length > 96 ? `…${text.slice(-93)}` : text
}

function listenText(job) {
  if (!job) return '未开始'
  const item = readerPlaybackTracker.getPlaybackState(job.jobId)
  if (item && item.completed) return '已听完'
  if (item && item.coverageRatio > 0) return '收听中'
  return '未开始'
}

function getReaderMedia() {
  const audio = document.getElementById('audio-player')
  if (typeof window !== 'undefined' && window.__mediaSource && typeof window.__mediaSource.getActiveMediaElement === 'function') {
    return window.__mediaSource.getActiveMediaElement(audio) || audio
  }
  return audio
}

function getAudio() {
  return getReaderMedia()
}

function resumeReaderAudioFromPanel() {
  const audio = getAudio()
  if (!audio || !audio.paused) return false
  observeBestEffort(Promise.resolve(audio.play()), {
    operationId: 'panel-audio-resume',
    reason: 'reader playback paused while loading material from the panel should resume when loading succeeds',
  })
  return true
}

function ensureCurrentJobFromAudioMeta() {
  if (currentJobId.value) {
    readerMarksHydration.startReaderMarksHydration(currentJobId.value)
    updateReaderConflictVisibility()
    return
  }
  const meta = runtimeState && runtimeState.currentAudioMeta
  const jobId = meta && meta.source === 'youtube-workflow' ? String(meta.jobId || '') : ''
  if (!jobId) return
  currentJobId.value = jobId
  readerPlaybackTracker.startReaderSession({ jobId })
  readerMarksHydration.startReaderMarksHydration(jobId)
  updateReaderConflictVisibility()
}

async function syncReaderActivity(event = 'progress') {
  if (readerSessionLoadInProgress && event !== 'switch') return null
  if (!currentJobId.value) return null
  const payload = readerPlaybackTracker.buildReaderActivityPayload(event)
  if (!payload) return null
  const ledger = getReaderActivityLedger(payload.jobId)
  ledger.submit({ jobId: payload.jobId, payload })
  await ledger.waitForIdle()
  return ledger.getState().status === 'saved' ? ledger.getState() : null
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

function normalizeReaderMarks(marks) {
  const words = runtimeState && Array.isArray(runtimeState.words) ? runtimeState.words : []
  const normalized = []
  for (const raw of Array.isArray(marks) ? marks : []) {
    if (!raw || typeof raw !== 'object') continue
    const globalIndex = Number(raw.globalIndex)
    if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= words.length) continue
    const word = words[globalIndex] || {}
    normalized.push({
      ...raw,
      globalIndex,
      word: String(raw.word || word.word || ''),
      start: Number.isFinite(Number(raw.start)) ? Number(raw.start) : word.start,
      sourceType: String(raw.sourceType || raw.source || 'manual-mark')
    })
  }
  return normalized
}

function getCurrentReaderMarks() {
  const markedMap = runtimeState && runtimeState.markedMap instanceof Map ? runtimeState.markedMap : null
  if (!markedMap) return []
  return normalizeReaderMarks(Array.from(markedMap.values()))
}

function syncMarkedWordVisuals(marks) {
  document.querySelectorAll('[data-word-index].marked').forEach((el) => el.classList.remove('marked'))
  marks.forEach((mark) => {
    if (marksStore && typeof marksStore.syncVisual === 'function') {
      marksStore.syncVisual(mark.globalIndex, true)
    } else {
      document.querySelectorAll(`[data-word-index="${mark.globalIndex}"]`).forEach((el) => el.classList.add('marked'))
    }
  })
}

function replaceReaderMarksVisible(marks) {
  if (!runtimeState || !(runtimeState.markedMap instanceof Map)) return []
  const normalized = normalizeReaderMarks(marks)
  runtimeState.markedMap.clear()
  normalized.forEach((mark) => runtimeState.markedMap.set(mark.globalIndex, mark))
  syncMarkedWordVisuals(normalized)
  bridgeToPinia()
  return normalized
}

async function applyReaderMarks(marks, options = {}) {
  const normalized = replaceReaderMarksVisible(marks)
  if (options.persist !== false) await audioStore.saveToDB('marks', normalized)
  if (typeof window.syncAnnotationGenerationEntryStatus === 'function') await window.syncAnnotationGenerationEntryStatus()
}

function submitCurrentReaderMarks() {
  ensureCurrentJobFromAudioMeta()
  if (!currentJobId.value) return
  const jobId = currentJobId.value
  return getReaderMarksLedger(jobId).submit({
    jobId,
    marks: getCurrentReaderMarks()
  })
}

function handleReaderMarksChanged() {
  if (readerSessionLoadInProgress) return
  ensureCurrentJobFromAudioMeta()
  if (!currentJobId.value) return
  if (readerMarksHydration.deferLocalChange(currentJobId.value)) return
  submitCurrentReaderMarks()
  syncReaderActivity('annotation')
}

function readerOutboxRequest(entry, expectedRevision, keepalive = false) {
  if (entry.kind === 'marks') {
    const payload = {
      marks: entry.intent.marks,
      expectedRevision,
      operationId: entry.operationId,
    }
    return keepalive
      ? youtubeWorkflowClient.keepaliveReaderMarks(entry.jobId, payload)
      : youtubeWorkflowClient.saveReaderMarks(entry.jobId, payload)
  }
  const payload = {
    ...entry.intent,
    jobId: entry.jobId,
    expectedRevision,
    activityOperationId: entry.operationId,
  }
  return keepalive
    ? youtubeWorkflowClient.keepaliveReaderActivity(payload)
    : youtubeWorkflowClient.recordReaderActivity(payload)
}

function isReaderConflictError(error) {
  return error?.category === 'conflict' || String(error?.code || '').endsWith('_REVISION_CONFLICT')
}

function setReaderOutboxState(entry, status, notice = '') {
  if (currentJobId.value !== entry.jobId) return
  if (entry.kind === 'marks') readerMarksSaveState.value = status
  else readerActivitySaveState.value = status
  if (notice) readerActivityNotice.value = notice
}

function clearReaderOutboxSuccessNotice() {
  if (readerActivityNotice.value.includes('本地最新意图仍未丢失')
    || readerActivityNotice.value.includes('最新进度仍保留')
    || readerActivityNotice.value.includes('权威版本暂时无法读取')) readerActivityNotice.value = ''
}

function settleReaderOutboxSuccess(entry, saved) {
  if (Number.isInteger(saved?.revision)) {
    rememberReaderRevision(entry.kind, entry.jobId, saved.revision)
  }
  if (entry.kind === 'activity') mergeRecentReaderItem(saved)
  if (!removeReaderOutboxEntry(entry)) {
    setReaderOutboxState(entry, 'error')
    return false
  }
  clearReaderConflict(entry.kind, entry.jobId, entry.operationId)
  setReaderOutboxState(entry, 'saved')
  clearReaderOutboxSuccessNotice()
  return true
}

async function retryReaderOutboxEntry(entry, expectedRevision) {
  try {
    return settleReaderOutboxSuccess(entry, await readerOutboxRequest(entry, expectedRevision))
  } catch (error) {
    setReaderOutboxState(entry, 'conflict', '学习记录存在并发冲突，需确认后重试')
    return false
  }
}

async function replayReaderOutboxEntry(entry) {
  setReaderOutboxState(entry, 'dirty')
  try {
    return settleReaderOutboxSuccess(entry, await readerOutboxRequest(entry, entry.expectedRevision))
  } catch (error) {
    if (isReaderConflictError(error)) {
      setReaderOutboxState(entry, 'conflict', '学习记录存在并发冲突，需确认后重试')
      const localIntent = entry.kind === 'marks'
        ? { jobId: entry.jobId, marks: entry.intent.marks }
        : { jobId: entry.jobId, payload: { ...entry.intent, jobId: entry.jobId } }
      await loadReaderConflict(
        entry.kind,
        entry.jobId,
        error,
        localIntent,
        { operationId: entry.operationId },
        { retry: (revision) => retryReaderOutboxEntry(entry, revision) },
      )
      return false
    }
    setReaderOutboxState(entry, 'error')
    return false
  }
}

function replayReaderOutbox() {
  if (readerOutboxReplayPromise) return readerOutboxReplayPromise
  readerOutboxReplayPromise = (async () => {
    const outbox = readReaderOutbox()
    if (!outbox.valid) return
    await Promise.all(outbox.entries.map((entry) => replayReaderOutboxEntry(entry)))
  })().finally(() => {
    readerOutboxReplayPromise = null
  })
  return readerOutboxReplayPromise
}

function queueReaderKeepalive(entry) {
  return observeBestEffort(readerOutboxRequest(entry, entry.expectedRevision, true), {
    operationId: `reader-outbox-keepalive-${entry.kind}`,
    reason: 'page close cannot await reader durability; the versioned outbox remains the recovery receipt',
  }).then((saved) => {
    if (saved) settleReaderOutboxSuccess(entry, saved)
  })
}

function handleReaderPageHide(event) {
  handleBeforeUnload(event)
}

function handleReaderPageShow(event) {
  if (!event?.persisted) return
  readerUnloadFlushed = false
  readerCloseGeneration += 1
  ensureCurrentJobFromAudioMeta()
  updateReaderConflictVisibility()
}

function handleBeforeUnload() {
  if (readerSessionLoadInProgress) return
  if (readerUnloadFlushed) return
  ensureCurrentJobFromAudioMeta()
  const payload = readerPlaybackTracker.buildReaderActivityPayload('close')
  if (!payload) return
  const closeGeneration = readerCloseGeneration
  const activityOperationId = `reader-activity-${payload.jobId}-${payload.sessionId}-close-${closeGeneration}`
  const marksEntry = createReaderOutboxEntry(
    'marks',
    { jobId: payload.jobId, marks: getCurrentReaderMarks() },
    `reader-marks-${payload.jobId}-${payload.sessionId}-close-${closeGeneration}`,
    getReaderRevision('marks', payload.jobId) ?? 0,
  )
  const activityEntry = createReaderOutboxEntry(
    'activity',
    payload,
    activityOperationId,
    getReaderRevision('activity', payload.jobId) ?? 0,
  )
  if (!marksEntry && !activityEntry) return
  readerUnloadFlushed = true
  readerMarksSaveState.value = 'dirty'
  readerActivitySaveState.value = 'dirty'
  if (marksEntry) {
    writeReaderOutboxEntry(marksEntry)
    observeBestEffort(queueReaderKeepalive(marksEntry), {
      operationId: 'reader-outbox-marks-keepalive-settle',
      reason: 'the persisted marks outbox remains authoritative when close-time settlement cannot finish',
    })
  }
  if (activityEntry) {
    writeReaderOutboxEntry(activityEntry)
    observeBestEffort(queueReaderKeepalive(activityEntry), {
      operationId: 'reader-outbox-activity-keepalive-settle',
      reason: 'the persisted activity outbox remains authoritative when close-time settlement cannot finish',
    })
  }
}

function resetChunkChineseDisplay() {
  if (runtimeState) {
    runtimeState.chunkCnVisible = false
    runtimeState.isHoldingChunkCn = false
    runtimeState.holdPrevChunkCnVisible = null
  }
  if (chunkStore) {
    chunkStore.chunkCNVisible = false
    chunkStore.isHoldingChunkCn = false
    chunkStore.holdPrevChunkCnVisible = null
  }
  document.querySelectorAll('.chunk-cn').forEach((el) => el.classList.add('hidden-cn'))
  try {
    window.localStorage.setItem('st.chunkCnVisible', 'false')
  } catch (error) {
    recordPanelSettingFailure(error, 'write', 'st.chunkCnVisible')
  }
  if (typeof window.updateChunkCnHoldBtn === 'function') window.updateChunkCnHoldBtn()
}

function loadTextSetting(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback
  } catch (error) {
    recordPanelSettingFailure(error, 'read', key)
    return fallback
  }
}

function saveTextSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value || ''))
  } catch (error) {
    recordPanelSettingFailure(error, 'write', key)
  }
}

function recordPanelSettingFailure(error, action, key) {
  if (action === 'read') {
    recordBestEffortFailure(error, {
      operationId: 'panel-setting-read',
      reason: 'optional panel preference falls back to its current default',
      details: { key },
    })
    return
  }
  recordBestEffortFailure(error, {
    operationId: 'panel-setting-write',
    reason: 'optional panel preference remains in memory for the current session',
    details: { key },
  })
}

</script>
