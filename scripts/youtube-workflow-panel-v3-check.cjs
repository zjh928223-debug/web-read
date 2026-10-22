const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8')
const panel = fs.readFileSync(path.join(root, 'src/components/YouTubeWorkflowPanel.vue'), 'utf8')
const library = fs.readFileSync(path.join(root, 'src/composables/use-workflow-library.js'), 'utf8')
const mutations = fs.readFileSync(path.join(root, 'src/composables/create-workflow-mutation-coordinator.js'), 'utf8')
const persistence = fs.readFileSync(path.join(root, 'src/composables/use-reader-session-persistence.js'), 'utf8')
const outboxStorage = fs.readFileSync(path.join(root, 'src/services/persistence/reader-outbox-storage.js'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
const workflowStyles = fs.readFileSync(path.join(root, 'src/styles/workflow-ui.css'), 'utf8')
const buttonIndex = fs.readFileSync(path.join(root, 'src/components/ui/button/index.js'), 'utf8')
const buttonVariants = fs.readFileSync(path.join(root, 'src/components/ui/button/button-variants.js'), 'utf8')
const inputComponent = fs.readFileSync(path.join(root, 'src/components/ui/input/Input.vue'), 'utf8')
const inputStyles = fs.readFileSync(path.join(root, 'src/components/ui/input/input-styles.js'), 'utf8')
const textareaComponent = fs.readFileSync(path.join(root, 'src/components/ui/textarea/Textarea.vue'), 'utf8')
const client = fs.readFileSync(path.join(root, 'src/composables/youtube-workflow-client.js'), 'utf8')
const service = fs.readFileSync(path.join(root, 'tools/subtitle-workflow/youtube_workflow/service.py'), 'utf8')
const core = fs.readFileSync(path.join(root, 'tools/subtitle-workflow/youtube_workflow/core.py'), 'utf8')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const readerRuntime = fs.readFileSync(path.join(root, 'src/composables/reader-runtime.js'), 'utf8')
const sessionInit = fs.readFileSync(path.join(root, 'src/composables/session-init.js'), 'utf8')

function ruleBodies(selector, declaration) {
  const token = `${selector} {`
  const bodies = []
  let offset = 0
  while (true) {
    const start = styles.indexOf(token, offset)
    if (start < 0) break
    const bodyStart = start + token.length
    const end = styles.indexOf('}', bodyStart)
    if (end < 0) break
    const body = styles.slice(bodyStart, end)
    if (new RegExp(`(?:^|\\n)\\s*${declaration}\\s*:`).test(body)) bodies.push({ start, body })
    offset = end + 1
  }
  return bodies
}

function firstRuleBody(selector) {
  const start = styles.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} should have a base rule`)
  const bodyStart = start + selector.length + 2
  const end = styles.indexOf('}', bodyStart)
  assert.ok(end >= 0, `${selector} base rule should close`)
  return styles.slice(bodyStart, end)
}

assert.ok(panel.includes("const workflowView = ref('library')"), 'material center should open to the library')
assert.ok(app.includes('<YouTubeWorkflowPanel') && app.includes("import YouTubeWorkflowPanel"), 'App.vue should mount the material workflow panel')
assert.ok(panel.includes('youtube-material-entry') && panel.includes('素材处理') && panel.includes('后台服务未启动'), 'material entry and deferred service guidance should remain connected')
assert.ok(panel.includes('<span>素材库</span>') && panel.includes('<span>任务</span>') && panel.includes('<span>设置</span>'), 'navigation should expose only library, tasks, and settings')
assert.ok(panel.includes('+ 添加素材'), 'add material should be a primary header action')
assert.ok(panel.includes('开始处理') && panel.includes('youtube-add-material-form'), 'add view should expose one compact primary flow')
assert.ok(panel.includes('linkCards') && panel.includes('youtube-material-link-input') && panel.includes('@submit.prevent="enqueueUrls"'), 'add flow should show parsed links and submit through the current form')
assert.ok(panel.includes('parseLinks') && panel.includes('isValidMaterialUrl') && panel.includes('normalizeMaterialUrl') && panel.includes('findWorkflowDuplicate'), 'link input should validate and canonicalize before duplicate lookup')
assert.ok(panel.includes('linkCardStateText') && panel.includes('linkNotice') && panel.includes('duplicateLinkCards') && panel.includes('primaryActionText'), 'link flow should connect validation, duplicate feedback, and state-aware submission')
assert.equal(panel.includes('导入旧素材目录'), false, 'legacy directory import should not appear in the frontend')
assert.equal(panel.includes('选择并扫描目录'), false, 'legacy folder scanning should not appear in the add view')
assert.equal(panel.includes('createNativePickerController'), false, 'retired legacy picker state should leave the panel component')
assert.equal(panel.includes('youtube-reader-video-priority'), false, 'video-priority controls should be removed from the frontend')
assert.equal(panel.includes('credentialCompactText'), false, 'processing configuration chips should be removed from the add view')
assert.equal(panel.includes('后台服务已连接'), false, 'healthy backend status should not add visual noise')
assert.equal(panel.includes('youtube-library-time-filter'), false, 'the retired material time filter should not have a UI entry')
assert.equal(panel.includes('setLibraryTimeScope'), false, 'the simplified panel should not change internal time scopes')
assert.ok(library.includes('client.readerRecent(') && library.includes('loadMoreLibrary'), 'material listing and pagination should retain their existing query owner')
assert.equal(panel.includes('按最近使用时间排列，点击即可打开。'), false, 'personal library should not explain its obvious ordering')
assert.equal(panel.includes('处理中任务静默运行；这里只保留进行中和需要处理的项目。'), false, 'task view should not repeat its background behavior')
assert.equal(panel.includes('管理素材处理使用的 Gemini API Key。'), false, 'personal settings should not explain the only visible setting')
assert.equal(panel.includes('data-reader-save-state'), false, 'background reader saves should not occupy a persistent foreground row')
assert.equal(panel.includes('学习记录保存失败，保留待重试'), false, 'background outbox failures should stay silent while retaining retry state')
assert.ok(library.includes('libraryPageSize = 20') && library.includes('function loadMoreLibrary(') && panel.includes('loadMoreLibrary'), 'library owner should load twenty rows through the panel continuation entry')
assert.equal(panel.includes('<small class="youtube-job-source">{{ librarySourceText(job) }}</small>'), false, 'library rows should not expose source labels or YouTube ids by default')
assert.ok(panel.includes('<small class="youtube-library-source-detail">{{ librarySourceText(job) }}</small>'), 'source labels and YouTube ids should live inside the expanded row details')
assert.ok(panel.includes('{{ jobRequestProvenanceText(job) }}') && panel.includes('任务请求模型：'), 'material task details should display the selected job request model instead of current settings')
assert.ok(panel.includes('请求模式：') && panel.includes('实际执行/路由模型：当前记录未提供'), 'material task details should distinguish recorded mode from unavailable final routing evidence')
assert.ok(panel.includes('request?.model') && panel.includes('request?.geminiMode'), 'material provenance labels must read the selected job request fields only')
assert.ok(panel.includes('groupTaskAttempts') && panel.includes('次尝试'), 'failed attempts should merge by material identity')
assert.ok(panel.includes('YOUTUBE_MEDIA_HTTP_403') && panel.includes('YouTube 媒体授权失败（HTTP 403），请重新处理'), 'YouTube media 403 failures should identify authorization without blaming the proxy node')
assert.ok(panel.includes('deleteFailedTaskGroup') && panel.includes('clearFailedTasks'), 'failed records should support single and bulk deletion')
assert.ok(panel.includes('只清除失败提示和失败任务记录，不会删除成功素材或复习数据'), 'bulk deletion must state its safe boundary')
assert.ok(panel.includes('deleteLibraryRecord') && panel.includes('删除记录'), 'successful material records should support deleting the library record')
assert.equal(panel.includes('删文件'), false, 'successful generated files must not be deletable from the library')
assert.ok(panel.includes('confirmReprocess') && panel.includes('forceReprocess: true'), 'reprocessing should be explicit and confirmed')
assert.ok(panel.includes('canonicalMaterialKey') && panel.includes('extractYoutubeVideoId'), 'YouTube URL variants should share a stable identity')
assert.ok(panel.includes('正在读取视频信息') && panel.includes('youtube.com/oembed'), 'new link cards should resolve human-readable video metadata')
assert.ok(panel.includes('MATERIAL_ALREADY_EXISTS'), 'stale clients should handle server-side duplicate rejection')
assert.match(
  panel,
  /<div class="youtube-workflow-service-status">\s*<div v-if="serviceStatusKnown && !serviceOnline" class="youtube-workflow-alert">/,
  'the service alert must stay hidden until a real library request reports the backend unavailable',
)
assert.equal(panel.includes('正在连接后台'), false, 'opening the material center must not show a blocking backend health check')
assert.ok(panel.includes('Gemini API Key') && panel.includes('更新 API Key'), 'settings should lead with the API key flow')
assert.ok(panel.includes('youtube-workflow-model-settings') && panel.includes('youtube-workflow-settings-model'), 'settings should expose one ordinary-layer material model input')
assert.ok(panel.indexOf('youtube-workflow-settings-model') < panel.indexOf('class="youtube-advanced-settings"'), 'material model input should stay outside advanced settings')
assert.ok(panel.includes('data-workflow-config-status') && panel.includes('backendConfigLoadState') && panel.includes('backendConfigSaveState'), 'configuration status should distinguish read and save states')
assert.ok(panel.includes('canSaveBackendConfig') && panel.includes('后台配置尚未成功读取，未提交任何配置'), 'config save must be guarded when backend fields are unknown')
for (const purposeText of ['素材转写', '素材切分', '素材翻译', '文章解释', '短义精简', '句子即时翻译']) {
  assert.ok(panel.includes(purposeText), `${purposeText} purpose explanation should remain visible in ordinary settings`)
}
assert.ok(panel.includes('confirmDeleteCredential') && panel.includes('清除已保存 API Key'), 'key deletion should live behind advanced settings and confirmation')
assert.ok(panel.includes('2/4 · 生成字幕') && panel.includes('3/4 · AI 切分与翻译'), 'tasks should expose four understandable progress stages')
assert.ok(library.includes('intervalMs: 2000') && library.includes('hiddenIntervalMs: 10000'), 'task polling owner should use the accepted visible and hidden intervals')
assert.ok(panel.includes('visibleCompletedJobIds') && library.includes('visibleCompletedJobIds') && library.includes('}, 5000)'), 'completed tasks should remain visible briefly through the library owner')
assert.ok(panel.includes('jobDisplayTitle') && panel.includes('jobStageProgressText') && panel.includes('jobProgressPercent'), 'queue rows should keep shared title and progress rendering')
assert.ok(panel.includes('openRecentJob') && panel.includes('youtube-library-open'), 'library materials should remain reopenable from the current library row')
assert.ok(library.includes('client.readerRecent') && panel.includes('mergeRecentReaderItem') && persistence.includes('recordReaderActivity'), 'library owner and reader activity should remain connected to the reader endpoints')
assert.ok(panel.includes('hidePanelAfterLoad()') && panel.indexOf('hidePanelAfterLoad()') < panel.indexOf('loadJob(job)'), 'opening should close the panel before loading the reader')
assert.ok(panel.includes('reader-background-switch-save') && panel.includes('observeBestEffort(syncReaderActivity'), 'switch progress should persist in the background')
assert.ok(panel.includes('readerPersistence.beginLoad(cancelReaderLoad)') && panel.includes('readerPersistence.endLoad(loadToken)') && persistence.includes('readerSessionLoadInProgress.value = true') && persistence.includes('if (readerSessionLoadInProgress.value || stopped) return'), 'programmatic session restore must not write one material marks into another material')
assert.ok(persistence.includes('activity revision hydration is not required for the first rendered reader frame') && panel.includes('readerPersistence.activateJob(job, loadToken)'), 'activity hydration must not block opening')
assert.equal(panel.includes('确认切换'), false, 'opening a material should not show a switch confirmation')
assert.equal(panel.includes('switchModal'), false, 'retired switch modal state should be removed')
assert.equal(panel.includes('youtube-task-capsule'), false, 'floating task capsule markup should be removed')
assert.equal(panel.toLowerCase().includes('capsule'), false, 'floating capsule behavior should be removed')
assert.equal(panel.includes('startPanelDrag'), false, 'fixed panel should not keep drag behavior')
assert.ok(panel.includes('AI 切分结果不可用，请重新 AI 切分') && panel.includes('本地素材不完整，请重新下载'), 'load errors should state reason and remedy directly')
assert.ok(panel.includes('Windows 阅读器状态同步失败，请稍后重新打开'), 'reader-session owner failures should not be presented as API authentication failures')
assert.ok(panel.includes('resetChunkDisplay: resetChunkChineseDisplay') && panel.includes('annotationLightweightModule: window.__annotationLightweightModule'), 'reader loading should reconnect generated chunk reset and annotation backfill')
assert.ok(persistence.includes('function getReaderMedia()') && persistence.includes('mediaSource?.getActiveMediaElement?.(audio)') && panel.includes('readerPersistence.getReaderMedia()'), 'panel should resolve the active reader media element for playback tracking')
assert.ok(persistence.includes('createReaderPlaybackTracker') && persistence.includes('readerPlaybackTracker.bindPlaybackTracking()') && persistence.includes('readerPlaybackTracker.unbindPlaybackTracking()') && app.includes('readerPersistence.start()') && app.includes('readerPersistence.stop()'), 'App should connect tracker setup and teardown through its unique persistence scope')
assert.ok(panel.includes('refreshPreferredVideo') && panel.includes('youtubeWorkflowClient.getSession(requestedJobId)') && panel.includes("youtubeWorkflowClient.mediaUrl(requestedJobId, 'video')"), 'optional video media refresh should preserve the requested reader target')
assert.equal(panel.includes('syncVideoPreferred(videoPriority.value)'), false, 'processing video priority must not overwrite the window preference')
assert.ok(panel.includes('clearMaterialNotice()') && panel.includes('clearMaterialRepairState(job.jobId)'), 'new and successful opens should clear stale material errors')
assert.ok(panel.includes('<Teleport to="#reader-article-status-root">') && panel.includes('aria-live="polite"'), 'opening feedback should remain visible in the reading area')
assert.ok(panel.includes('正在打开：${jobDisplayTitle(job)}') && panel.includes('打开失败：${jobDisplayTitle(job)}'), 'opening and failure feedback should identify the requested material')
const loadJobSource = panel.slice(panel.indexOf('async function loadJob(job)'), panel.indexOf('function showMaterialLoadFailure(job, error)'))
const loadedGuard = loadJobSource.indexOf("result.status !== 'loaded'")
const activationGuard = loadJobSource.indexOf('readerPersistence.activateJob(job, loadToken)')
const successFeedback = loadJobSource.indexOf('readerOpenMessage.value = `已打开：')
assert.ok(loadedGuard >= 0 && activationGuard >= 0 && successFeedback >= 0, 'loaded status, reader activation, and success feedback must all remain present')
assert.ok(loadedGuard < activationGuard, 'opening success requires the loader to have committed and published the requested material')
assert.ok(activationGuard < successFeedback, 'opening feedback must wait for reader activation')
assert.match(panel, /<Teleport to="body">\s*<div v-if="qualityModal" class="youtube-workflow youtube-subwindow youtube-quality-backdrop">/, 'quality report should teleport above the material center stacking context')
assert.ok(panel.includes("import { Button } from './ui/button/index.js'") && panel.includes('data-ui-owner="workflow"'), 'workflow actions should use the local shadcn Button owner boundary')
assert.ok(panel.includes("import { Input } from './ui/input/index.js'") && panel.includes("import { Textarea } from './ui/textarea/index.js'"), 'workflow fields should use the local shadcn Input and Textarea components')
assert.equal(panel.includes('<input'), false, 'workflow panel should not keep raw input component markup')
assert.equal(panel.includes('<textarea'), false, 'workflow panel should not keep raw textarea component markup')
assert.ok(panel.includes('rw:min-h-[76px]') && panel.includes('rw:max-h-[220px]') && panel.includes('rw:resize-y'), 'link textarea should keep its workflow-local geometry through prefixed utilities')
assert.ok(panel.includes('type="password"') && panel.includes('youtube-gemini-api-key-settings') && panel.includes('data-ui-owner="workflow"'), 'API key input should retain its password and owner contract')
for (const fieldName of [
  'youtube-workflow-settings-model',
  'youtube-workflow-base-url',
  'youtube-workflow-proxy-url',
  'youtube-workflow-cookies-path',
  'youtube-workflow-output-dir',
  'youtube-workflow-ytdlp-path',
  'youtube-workflow-whisperx-path',
]) {
  assert.ok(panel.includes(`name="${fieldName}"`) && panel.includes(`name="${fieldName}" autocomplete="off"`), `${fieldName} should retain its form attributes`)
}
assert.ok(inputComponent.includes('modelModifiers') && inputComponent.includes('props.modelModifiers.trim') && inputComponent.includes('data-slot="input"'), 'Input should adapt v-model modifiers while keeping the native input root')
assert.ok(inputComponent.includes('const isComposing = ref(false)') && inputComponent.includes('if (isComposing.value || !props.modelModifiers.trim'), 'Input should preserve its DOM buffer while composition is active')
assert.ok(inputStyles.includes('rw:disabled:pointer-events-none') && inputStyles.includes('rw:disabled:cursor-not-allowed') && inputStyles.includes('rw:disabled:opacity-50'), 'Input style recipe should retain the generated disabled recipe')
assert.ok(textareaComponent.includes('modelModifiers') && textareaComponent.includes('props.modelModifiers.trim') && textareaComponent.includes('data-slot="textarea"'), 'Textarea should adapt v-model modifiers while keeping the native textarea root')
assert.ok(textareaComponent.includes('const isComposing = ref(false)') && textareaComponent.includes('if (isComposing.value || !props.modelModifiers.trim'), 'Textarea should preserve its DOM buffer while composition is active')
assert.ok(textareaComponent.includes('rw:disabled:cursor-not-allowed') && textareaComponent.includes('rw:disabled:opacity-50'), 'Textarea should retain the generated disabled recipe')
assert.ok((panel.match(/data-ui-owner="workflow"/g) || []).length >= 20, 'workflow button migration should cover the panel and its teleported actions')
assert.ok(panel.includes('variant="default"') && panel.includes('variant="outline"') && panel.includes('variant="destructive"') && panel.includes('variant="ghost"'), 'workflow buttons should cover the mapped semantic variants')
assert.ok(panel.includes('size="icon"') && panel.includes('size="default"'), 'workflow buttons should use the standard action and icon sizes')
assert.ok(panel.includes('data-quality-initial-focus') && panel.includes("querySelector('button[data-quality-initial-focus]:not([disabled])')"), 'quality focus must resolve a real button inside the dialog')
assert.equal(panel.includes('ref="qualityDialogInitialFocus"'), false, 'quality focus must not retain a component ref')
assert.ok(workflowStyles.includes('@import "tailwindcss/theme.css"') && workflowStyles.includes('prefix(rw)'), 'workflow controls should keep the scoped Tailwind v4 prefix entry')
assert.ok(workflowStyles.includes('--primary: var(--rw-ui-primary)') && workflowStyles.includes('--destructive: var(--rw-ui-destructive)'), 'workflow controls should use the neutral theme tokens while retaining semantic destructive colors')

assert.ok(client.includes('async deleteJob(jobId, options = {})') && client.includes('async clearFailedJobs(options = {})'), 'failed-record mutations should carry the authoritative queue revision')
assert.match(panel, /<main class="youtube-workflow-content">\s*<p v-if="workflowMutationNotice"/, 'mutation notices must stay inside scrollable content instead of creating an implicit panel grid row')
assert.equal(panel.includes('当前 revision'), false, 'rare concurrency notices should not expose internal revision terminology')
assert.ok(service.includes('MATERIAL_ALREADY_EXISTS') && service.includes('_find_duplicate_material_locked'), 'service should enforce duplicate identity')
assert.ok(core.includes('def youtube_video_id') && core.includes('force_reprocess'), 'workflow request should support canonical identity and explicit reprocessing')

assert.ok(styles.includes('width: clamp(720px, 60vw, 960px)'), 'desktop panel should use the accepted adaptive width')
assert.ok(styles.includes('justify-content: flex-end') && styles.includes('.youtube-workflow-backdrop'), 'panel should be fixed to the right')
assert.ok(styles.includes('repeat(3, minmax(0, 1fr))'), 'narrow navigation should contain three destinations')
assert.equal(styles.includes('.youtube-task-capsule'), false, 'capsule styles should be deleted')
assert.equal(styles.includes('.youtube-material-float'), false, 'floating indicator styles should be deleted')
assert.ok(styles.includes('var(--glass-button-bg)') && styles.includes('var(--glass-blur-sm)'), 'unmigrated material controls should retain the shared liquid-glass compatibility styling')
assert.ok(styles.includes('.youtube-workflow-icon-btn:where(:not([data-ui-owner="workflow"]))'), 'unmigrated video controls should retain their native icon-button compatibility rule')
assert.equal(styles.includes('.youtube-reader-controls .small-btn:where(:not([data-ui-owner="workflow"]))'), false, 'retired reader controls compatibility rule should be removed')
assert.equal(styles.includes('--youtube-capsule-'), false, 'retired workflow capsule tokens should be removed')
assert.equal(styles.includes('quiet liquid-glass capsules'), false, 'retired workflow capsule rules should be removed')
assert.equal(styles.includes('shared blue glass capsules'), false, 'retired blue-text capsule styling should not remain')
assert.equal(styles.includes('.youtube-workflow .youtube-library-open {'), false, 'migrated library open actions must leave the old visual rule')
assert.equal(styles.includes('.youtube-workflow .youtube-workflow-section-tabs.youtube-workflow-nav button {'), false, 'migrated navigation actions must leave the old visual rule')
assert.equal(styles.includes('.youtube-workflow .youtube-filter-tabs button {'), false, 'migrated filter actions must leave the old visual rule')
assert.equal(styles.includes('.youtube-workflow button:where(:not([data-ui-owner="workflow"]))'), false, 'migrated workflow buttons must leave the retired leaf rule')
assert.equal(styles.includes('.youtube-workflow input:where(:not([data-ui-owner="workflow"]))'), false, 'migrated workflow inputs must leave the retired leaf rule')
assert.equal(styles.includes('.youtube-workflow textarea.youtube-material-link-input:where(:not([data-ui-owner="workflow"]))'), false, 'migrated workflow textarea must leave the retired leaf rule')
assert.equal(styles.includes('.youtube-workflow .youtube-api-key-field input:where(:not([data-ui-owner="workflow"]))'), false, 'migrated API inputs must leave the retired leaf rule')
assert.equal(styles.includes('.youtube-material-notice .youtube-material-notice-close:where(:not([data-ui-owner="workflow"]))'), false, 'material notice close styling should not be claimed by the migrated workflow owner')
const baseBackdropRule = firstRuleBody('.youtube-workflow-backdrop')
assert.match(baseBackdropRule, /position:\s*fixed/, 'the consolidated backdrop must retain fixed positioning')
assert.match(baseBackdropRule, /z-index:\s*2400/, 'the consolidated backdrop must retain the material stacking level')
assert.match(baseBackdropRule, /background:\s*color-mix\(in srgb,\s*#000\s+28%,\s*transparent\)/, 'the consolidated backdrop must keep the accepted dimming alpha')
assert.doesNotMatch(
  styles,
  /\.youtube-workflow-backdrop\s*\{\s*background:\s*transparent;\s*\}/,
  'the workflow backdrop must not retain a later transparent override',
)
assert.match(
  styles,
  /@media\s*\(min-width:\s*761px\)\s*\{\s*\.youtube-workflow-layout\s*\{\s*grid-template-columns:\s*132px\s+minmax\(0,\s*1fr\);\s*\}\s*\}/s,
  'the desktop two-column refinement must be scoped above the mobile breakpoint',
)
assert.match(
  styles,
  /@media\s*\(max-width:\s*760px\)[\s\S]*?\.youtube-workflow-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  'the mobile workflow layout must keep a single content column',
)
const basePanelRule = firstRuleBody('.youtube-workflow .youtube-workflow-panel')
assert.match(basePanelRule, /background:\s*var\(--pru-shell-surface\)/, 'the consolidated panel must remain opaque')
assert.match(basePanelRule, /padding:\s*0/, 'the consolidated panel must retain the accepted zero padding')
assert.match(basePanelRule, /box-shadow:\s*var\(--pru-shadow-shell\)/, 'the consolidated panel must retain the accepted shell shadow')
const baseHeaderRule = firstRuleBody('.youtube-workflow .youtube-workflow-header')
assert.match(baseHeaderRule, /padding:\s*16px\s+18px/, 'the consolidated header must retain the accepted padding')
assert.match(baseHeaderRule, /user-select:\s*auto/, 'the consolidated header must retain text selection behavior')
assert.equal(styles.includes('Material center cascade lock'), false, 'the material cascade lock should be closed after consolidation')
const panelGridRules = ruleBodies('.youtube-workflow .youtube-workflow-panel', 'grid-template-rows')
assert.ok(
  panelGridRules.some(({ body }) => /grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/.test(body)),
  'the panel grid must reserve an auto-sized row for the service status before the flexible content row',
)
assert.ok(styles.includes('--card-bg: #ffffff') && styles.includes('--card-bg: #252525'), 'light and dark panel surfaces must be concrete opaque theme colors')
assert.ok(workflowStyles.includes('@layer base') && workflowStyles.includes('appearance: none') && workflowStyles.includes('border-width: 0') && workflowStyles.includes('background-color: transparent'), 'workflow owner should provide only the local no-Preflight button base reset')
assert.ok(workflowStyles.includes('[data-ui-owner="workflow"]:is(input, textarea)') && workflowStyles.includes('[data-ui-owner="workflow"]:is(button, [role="button"])'), 'workflow owner cursor rules should distinguish editable fields from actions')
assert.equal(workflowStyles.includes('[data-ui-owner="workflow"]:focus'), false, 'workflow base must not override mouse focus or component focus-visible recipes')
assert.ok(buttonIndex.includes("export { buttonVariants } from './button-variants.js'"), 'Button index should re-export the extracted pure recipe')
assert.ok(buttonVariants.includes('rw:focus-visible:ring-ring/50') && buttonVariants.includes('rw:focus-visible:ring-destructive/20'), 'Button recipes must own normal and destructive focus-visible rings')
assert.equal(styles.includes('.youtube-workflow-section-tabs.youtube-workflow-nav button:where(:not([data-ui-owner="workflow"]))'), false, 'migrated navigation actions must leave the retired owner-exclusion rules')
assert.equal(styles.includes('.youtube-filter-tabs button:where(:not([data-ui-owner="workflow"]))'), false, 'migrated filter actions must leave the retired owner-exclusion rules')
assert.ok(styles.includes('.youtube-quality-backdrop') && styles.includes('z-index: 2600'), 'quality report should render above the material center backdrop')
assert.ok(styles.includes('.youtube-add-material-form') && styles.includes('.youtube-api-key-settings'), 'add and API settings surfaces should use the flat minimal layout')
const workflowRoots = ['.youtube-workflow', '.youtube-reader-controls', '.youtube-material-notice']
const workflowShellTokens = {
  '--pru-shell-bg': '--rw-ui-background',
  '--pru-shell-surface': '--rw-ui-card',
  '--pru-shell-row': '--rw-ui-secondary',
  '--pru-shell-row-hover': '--rw-ui-accent',
  '--pru-shell-text': '--rw-ui-foreground',
  '--pru-shell-muted': '--rw-ui-muted-foreground',
  '--pru-shell-border': '--rw-ui-border',
  '--pru-row-border': '--rw-ui-border',
}
for (const [sourceName, source] of [['workflow-ui.css', workflowStyles], ['styles.css', styles]]) {
  const rootRules = [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const rootSelector of workflowRoots) {
    const bodies = rootRules.filter(([, selectors]) => selectors.split(',').some((selector) => selector.trim() === rootSelector))
    for (const [token, neutralToken] of Object.entries(workflowShellTokens)) {
      const values = bodies.flatMap(([, , body]) => [...body.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim()))
      assert.deepEqual(values, sourceName === 'workflow-ui.css' ? [`var(${neutralToken})`] : [], `${rootSelector} ${token} must be owned only by the workflow neutral mapping`)
    }
  }
}

assert.ok(persistence.includes('createReaderSessionPersistence') && panel.includes('readerSessionPersistence:'), 'atomic reader session publishing must remain intact')
assert.ok(persistence.includes("from '../services/persistence/reader-outbox-storage.js'") && persistence.includes('keepaliveReaderActivity'), 'reader recovery and unload persistence must remain intact')
assert.ok(outboxStorage.includes('READER_OUTBOX_ENTRY_PREFIX') && outboxStorage.includes('readerOutboxEntryKey') && outboxStorage.includes('migrateLegacyReaderOutbox'), 'reader outbox storage should retain versioned keys and legacy migration')
assert.ok(persistence.includes('isTrustedReaderMarksOutboxEntry') && persistence.includes('localVersion: marksIntent.localVersion'), 'marks outbox replay must require trusted local-edit metadata and retain its local version')
assert.ok(persistence.includes('blockUntrustedReaderMarksOutbox') && persistence.includes('未自动发送'), 'source-unknown marks outbox entries must remain pending with an explicit notice')
assert.ok(outboxStorage.includes('export const READER_MARKS_OUTBOX_SOURCE') && outboxStorage.includes('intent.source === READER_MARKS_OUTBOX_SOURCE'), 'marks outbox trust must be bound to explicit source metadata')

const readerSettingsSource = index.match(/<details id="reader-settings"[^>]*>([\s\S]*?)<\/details>/u)?.[1] || ''
assert.ok(readerSettingsSource && readerSettingsSource.includes('阅读设置'), 'reader configuration should remain grouped under the reading settings entry')
for (const controlId of ['audio-file', 'transcript-file', 'import-marks-btn', 'export-json', 'export-md-all', 'btn-chunk-style']) {
  assert.ok(readerSettingsSource.includes(`id="${controlId}"`), `${controlId} should remain inside reading settings`)
}
assert.ok(index.includes('id="reader-mode-status-root"') && index.includes('id="toggle-chunk-btn"'), 'the existing mode switch should remain beside the reader mode status')
assert.equal(readerRuntime.includes('YouTubeWorkflowPanel'), false, 'reader-runtime.js should not gain material panel UI logic')
assert.equal(sessionInit.includes('YouTubeWorkflowPanel'), false, 'session-init.js should not gain material panel UI logic')



assert.ok(panel.includes('const readerPersistence = useReaderSessionPersistenceContext()') && panel.includes('const currentJobId = readerPersistence.currentJobId'), 'panel must inject the application scope and read its shared job ref')
assert.equal(panel.includes('useReaderSessionPersistence('), false, 'panel cannot create a fallback save scope')
assert.equal(panel.includes('readerPersistence.stop()'), false, 'panel unmount cannot stop application saving')
assert.equal(panel.includes('function handleBeforeUnload('), false, 'page close wiring has one persistence owner')
assert.equal(panel.includes('createReaderMarksHydration('), false, 'panel must not create a second hydration owner')
assert.ok(persistence.indexOf('for (const cancel of loaderCancellations) cancel()') < persistence.indexOf('handleBeforeUnload()', persistence.indexOf('function stop()')), 'root stop must cancel registered loaders before close flush')
assert.ok(panel.includes('unregisterReaderLoader()') && panel.includes('unsubscribeRecentReaderItem()'), 'panel must release its loader and UI subscription')
assert.ok(panel.includes('const workflowLibrary = useWorkflowLibrary(') && panel.includes('const workflowMutations = createWorkflowMutationCoordinator('), 'panel must create one owner of each workflow responsibility')
for (const retiredOwner of ['pendingWorkflowActions', 'workflowRevisionNeedsRefresh', 'workflowSnapshotFlight', 'jobPollingScheduler', 'completedTaskTimers', 'repairStates']) {
  assert.equal(panel.includes(retiredOwner), false, `${retiredOwner} must not have a second panel owner`)
}
assert.ok(library.includes('function dispose()') && panel.includes('workflowLibrary.dispose()') && panel.includes('workflowMutations.dispose()'), 'panel unmount must release workflow resources')
assert.ok(mutations.includes('expectedRevision: revision') && mutations.includes('removeWorkflowOperationReceipt(') && mutations.includes('action.inFlight'), 'mutation owner must retain revision, receipt, and single-flight contracts')

console.log('youtube workflow panel v3 check passed')
