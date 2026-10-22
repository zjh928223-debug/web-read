<template>
  <Teleport to="#youtube-reader-controls-root">
    <div class="youtube-reader-controls">
      <Button
        type="button"
        variant="outline"
        size="default"
        class="small-btn youtube-material-entry"
        data-ui-owner="workflow"
        @click="openPanel"
      >
        <span>素材处理</span>
        <small v-if="activeTaskCount" class="youtube-material-entry-count is-active">{{ activeTaskEntryText }}</small>
        <small v-if="failedTaskCount" class="youtube-material-entry-count is-failed">{{ failedTaskCount }}</small>
        <small v-if="completionSignal" class="youtube-material-entry-count is-complete">✓</small>
      </Button>
    </div>
  </Teleport>

  <Teleport to="#reader-article-status-root">
    <div class="reader-article-status" :aria-busy="openingJobId ? 'true' : 'false'">
      <strong>{{ openingJobId ? articleTitleBeforeOpen : currentArticleTitle }}</strong>
      <span role="status" aria-live="polite" aria-atomic="true">{{ readerOpenMessage }}</span>
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
            <Button
              type="button"
              variant="default"
              size="default"
              class="youtube-add-material-button"
              data-ui-owner="workflow"
              @click="setWorkflowView('add')"
            >
              + 添加素材
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="youtube-workflow-close-button"
              data-ui-owner="workflow"
              aria-label="关闭"
              title="关闭"
              @click="closePanel"
            >
              ×
            </Button>
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
            <Button
              type="button"
              :variant="workflowView === 'library' ? 'secondary' : 'ghost'"
              size="default"
              data-ui-owner="workflow"
              data-view="library"
              :aria-pressed="workflowView === 'library'"
              :data-active="workflowView === 'library' ? 'true' : 'false'"
              @click="setWorkflowView('library')"
            >
              <span>素材库</span>
            </Button>
            <Button
              type="button"
              :variant="workflowView === 'queue' ? 'secondary' : 'ghost'"
              size="default"
              data-ui-owner="workflow"
              data-view="queue"
              :aria-pressed="workflowView === 'queue'"
              :data-active="workflowView === 'queue' ? 'true' : 'false'"
              @click="setWorkflowView('queue')"
            >
              <span>任务</span>
              <small v-if="activeTaskCount">{{ activeTaskCount }}</small>
              <small v-else-if="failedTaskCount" class="is-failed">{{ failedTaskCount }}</small>
            </Button>
            <Button
              type="button"
              :variant="workflowView === 'settings' ? 'secondary' : 'ghost'"
              size="default"
              data-ui-owner="workflow"
              data-view="settings"
              :aria-pressed="workflowView === 'settings'"
              :data-active="workflowView === 'settings' ? 'true' : 'false'"
              @click="setWorkflowView('settings')"
            >
              <span>设置</span>
            </Button>
          </nav>

          <main class="youtube-workflow-content">
            <p v-if="workflowMutationNotice" class="youtube-workflow-hint" data-workflow-mutation-notice role="status" aria-live="polite" data-tone="warning">
              {{ workflowMutationNotice }}
            </p>
            <section v-if="workflowView === 'add'" class="youtube-workflow-add-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>添加素材</h3>
                </div>
              </div>

              <form class="youtube-workflow-form youtube-add-material-form" @submit.prevent="enqueueUrls">
                <label class="youtube-material-link-label">
                  <span>视频链接</span>
                  <Input
                    v-if="!batchInputExpanded"
                    v-model.trim="linkInput"
                    class="youtube-material-link-input"
                    name="youtube-material-link"
                    type="url"
                    autocomplete="off"
                    placeholder="粘贴视频链接"
                    data-ui-owner="workflow"
                  />
                  <Textarea
                    v-else
                    v-model.trim="linkInput"
                    class="youtube-material-link-input rw:min-w-0 rw:min-h-[76px] rw:max-h-[220px] rw:resize-y"
                    name="youtube-material-link"
                    autocomplete="off"
                    rows="2"
                    placeholder="粘贴 YouTube 链接；多个链接请每行一个"
                    data-ui-owner="workflow"
                    @keydown.enter.ctrl.prevent="commitLinkInput"
                    @paste="handleLinkPaste"
                  />
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  class="youtube-batch-input-toggle"
                  data-ui-owner="workflow"
                  :aria-expanded="batchInputExpanded"
                  :disabled="starting || (batchInputExpanded && linkCards.length + parseLinks(linkInput).length > 1)"
                  @click="batchInputExpanded = !batchInputExpanded"
                >{{ batchInputExpanded ? '收起批量添加' : '批量添加' }}</Button>
                <p v-if="!batchInputExpanded && linkCards.length + parseLinks(linkInput).length > 1" class="youtube-workflow-hint" role="status">多个链接请展开“批量添加”。</p>

                <div class="youtube-link-card-list">
                  <article v-for="(card, index) in linkCards" :key="card.id" class="youtube-link-card" :data-valid="card.valid" :data-duplicate="card.duplicate ? 'true' : 'false'">
                    <div class="youtube-link-main">
                      <strong>{{ card.metadataTitle || linkCardFallbackTitle(card) }}</strong>
                      <small v-if="!card.valid || card.duplicate || card.metadataState === 'loading'" class="youtube-link-state-text">{{ linkCardStateText(card) }}</small>
                      <span v-if="card.metadataAuthor" class="youtube-link-author">{{ card.metadataAuthor }}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="default"
                      class="youtube-link-remove"
                      data-ui-owner="workflow"
                      :aria-label="`移除第 ${index + 1} 条链接`"
                      @click="removeLinkCard(card.id)"
                    >
                      移除
                    </Button>
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
                  <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="setWorkflowView('settings')">去设置</Button>
                </div>
                <div class="youtube-primary-actions youtube-add-submit-row">
                  <Button type="submit" variant="default" size="default" data-ui-owner="workflow" :disabled="starting || !canEnqueue">
                    <span>{{ primaryActionText }}</span>
                  </Button>
                </div>
              </form>
            </section>

            <section v-if="workflowView === 'queue'" class="youtube-workflow-process-view youtube-workflow-page">
              <div class="youtube-workflow-page-head">
                <div>
                  <h3>任务</h3>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  data-ui-owner="workflow"
                  @click="refreshQueue"
                >
                  刷新
                </Button>
              </div>
              <div class="youtube-workflow-toolbar">
                <span>{{ taskSummary }}</span>
                <Button
                  v-if="failedTaskCount"
                  type="button"
                  variant="outline"
                  size="default"
                  class="youtube-clear-failures"
                  data-ui-owner="workflow"
                  @click="clearFailedTasks"
                >
                  清除失败记录
                </Button>
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
                    <small class="youtube-job-source">{{ jobRequestProvenanceText(group.displayJob) }}</small>
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
                    <Button
                      v-if="group.displayJob.status === 'queued'"
                      type="button"
                      variant="outline"
                      size="default"
                      data-ui-owner="workflow"
                      @click="prioritizeJob(group.displayJob)"
                    >
                      置顶
                    </Button>
                    <Button
                      v-if="group.statusKind === 'failed'"
                      type="button"
                      variant="default"
                      size="default"
                      data-ui-owner="workflow"
                      @click="retryJob(group.displayJob)"
                    >
                      重试
                    </Button>
                    <Button
                      v-if="group.statusKind === 'failed'"
                      type="button"
                      variant="destructive"
                      size="default"
                      data-ui-owner="workflow"
                      @click="deleteFailedTaskGroup(group)"
                    >
                      删除记录
                    </Button>
                    <Button
                      v-if="group.statusKind === 'active'"
                      type="button"
                      variant="ghost"
                      size="default"
                      data-ui-owner="workflow"
                      @click="cancelJob(group.displayJob)"
                    >
                      取消
                    </Button>
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
              <p v-if="readerActivityNotice" class="youtube-workflow-hint" data-tone="warning">{{ readerActivityNotice }}</p>
              <section class="youtube-workflow-history youtube-material-library-list">
                <div v-if="libraryPending && !recentJobs.length" class="youtube-workflow-empty">正在读取素材库…</div>
                <div v-else-if="!recentJobs.length" class="youtube-workflow-empty">暂无素材</div>
                <article
                  v-for="job in recentJobs"
                  :key="job.jobId"
                  class="youtube-workflow-job youtube-workflow-library-job"
                  :data-status="job.needsRepair ? 'needs-repair' : 'ready'"
                >
                  <div class="youtube-workflow-job-main">
                    <strong class="youtube-job-title">{{ jobDisplayTitle(job) }}</strong>
                    <div class="youtube-job-status-line">
                      <span>{{ libraryTimeLabel(job) }} · {{ libraryRelativeTime(job) }}</span>
                      <span>{{ libraryExactTime(job) }}</span>
                      <span v-if="job.needsRepair" class="youtube-library-repair-state">需要修复</span>
                    </div>
                  </div>
                  <div class="youtube-workflow-job-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      class="youtube-library-open"
                      data-ui-owner="workflow"
                      :disabled="openingJobId === job.jobId"
                      @click="openRecentJob(job)"
                    >
                      打开
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="youtube-library-more"
                      data-ui-owner="workflow"
                      aria-label="更多操作"
                      :aria-expanded="expandedLibraryJobId === job.jobId ? 'true' : 'false'"
                      @click="toggleLibraryMenu(job)"
                    >
                      ···
                    </Button>
                  </div>
                  <div v-if="expandedLibraryJobId === job.jobId" class="youtube-library-row-menu">
                    <small class="youtube-library-source-detail">{{ librarySourceText(job) }}</small>
                    <small class="youtube-library-source-detail">{{ jobRequestProvenanceText(job) }}</small>
                    <small class="youtube-library-source-detail">{{ jobRouteProvenanceText(job) }}</small>
                    <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="confirmReprocess(job)">重新处理</Button>
                    <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="showQuality(job)">查看处理详情</Button>
                    <Button type="button" variant="destructive" size="default" data-ui-owner="workflow" @click="deleteLibraryRecord(job)">删除记录</Button>
                  </div>
                </article>
                <Button
                  v-if="libraryHasMore"
                  type="button"
                  variant="outline"
                  size="default"
                  class="youtube-library-load-more"
                  data-ui-owner="workflow"
                  :disabled="libraryPending"
                  @click="loadMoreLibrary"
                >
                  {{ libraryPending ? '加载中…' : '加载更多' }}
                </Button>
              </section>
              <Button
                v-if="readerConflictVisible"
                type="button"
                variant="outline"
                size="default"
                data-ui-owner="workflow"
                data-reader-conflict-action
                @click="resolveReaderConflict"
              >确认并保存本地最新意图</Button>
            </section>

            <section v-if="workflowView === 'add'" class="youtube-add-duplicate-help" aria-live="polite">
              <div v-for="card in duplicateLinkCards" :key="`duplicate-${card.id}`" class="youtube-duplicate-material-notice">
                <div>
                  <strong>{{ card.metadataTitle || jobDisplayTitle(card.duplicate.job) }}</strong>
                  <span>{{ duplicateStateText(card.duplicate) }}</span>
                </div>
                <div class="youtube-workflow-actions">
                  <Button
                    v-if="card.duplicate.state === 'ready'"
                    type="button"
                    variant="default"
                    size="default"
                    data-ui-owner="workflow"
                    @click="openRecentJob(card.duplicate.job)"
                  >
                    打开已有素材
                  </Button>
                  <Button
                    v-if="card.duplicate.state === 'active'"
                    type="button"
                    variant="outline"
                    size="default"
                    data-ui-owner="workflow"
                    @click="setWorkflowView('queue')"
                  >
                    查看当前任务
                  </Button>
                  <Button
                    v-if="card.duplicate.state === 'failed'"
                    type="button"
                    variant="outline"
                    size="default"
                    data-ui-owner="workflow"
                    @click="retryJob(card.duplicate.job)"
                  >
                    重试
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    data-ui-owner="workflow"
                    @click="confirmReprocess(card.duplicate.job, card.url)"
                  >
                    明确重新处理
                  </Button>
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
                  <Input v-model="apiKey" type="password" name="youtube-gemini-api-key-settings" autocomplete="off" aria-label="Gemini API Key" placeholder="输入新的 API Key" data-ui-owner="workflow" />
                </label>
                <div class="youtube-credential-actions">
                  <Button
                    type="button"
                    variant="default"
                    size="default"
                    data-ui-owner="workflow"
                    :disabled="!apiKey.trim()"
                    @click="saveCredential"
                  >
                    {{ credentialStatus.stored ? '更新 API Key' : '保存 API Key' }}
                  </Button>
                </div>
                <p v-if="credentialNotice" class="youtube-workflow-hint">{{ credentialNotice }}</p>
              </section>
              <p v-else class="youtube-workflow-hint">当前为本地开发模式，无需配置 API Key。</p>

              <section class="youtube-workflow-config-card youtube-workflow-model-settings" aria-labelledby="youtube-workflow-model-settings-title">
                <div class="youtube-workflow-config-heading">
                  <div>
                    <h4 id="youtube-workflow-model-settings-title">素材处理模型</h4>
                    <p>用于本页新素材任务的 AI 切分与素材翻译。它不会改写已有任务的来源记录。</p>
                  </div>
                  <span class="youtube-workflow-config-mode">{{ workflowModeText }}</span>
                </div>
                <label>
                  <span>本页新素材任务的当前模型</span>
                  <Input v-model.trim="model" type="text" name="youtube-workflow-settings-model" autocomplete="off" placeholder="gemini-2.5-flash" data-ui-owner="workflow" />
                </label>
                <div class="youtube-workflow-config-state-grid">
                  <div>
                    <span>页面当前选择</span>
                    <strong data-workflow-current-model>{{ currentModelText }}</strong>
                  </div>
                  <div>
                    <span>后台已读配置</span>
                    <strong data-workflow-backend-model>{{ backendModelText }}</strong>
                  </div>
                </div>
                <p
                  class="youtube-workflow-config-status"
                  data-workflow-config-status
                  :data-config-read-state="backendConfigLoadState"
                  :data-config-save-state="backendConfigSaveState"
                  role="status"
                  aria-live="polite"
                >
                  {{ backendConfigStateText }}
                </p>
                <div class="youtube-primary-actions youtube-workflow-config-actions">
                  <Button
                    type="button"
                    variant="default"
                    size="default"
                    class="youtube-save-config-button"
                    data-ui-owner="workflow"
                    data-workflow-config-save
                    :disabled="!canSaveBackendConfig"
                    @click="saveBackendConfig"
                  >
                    {{ backendConfigSaveButtonText }}
                  </Button>
                </div>
                <p v-if="backendConfigNotice" class="youtube-workflow-hint" data-workflow-config-notice>{{ backendConfigNotice }}</p>
              </section>

              <section class="youtube-workflow-purpose-summary" aria-labelledby="youtube-workflow-purpose-title">
                <h4 id="youtube-workflow-purpose-title">这些能力分别用于什么</h4>
                <dl>
                  <div>
                    <dt>素材转写</dt>
                    <dd>由后端独立调用本地 WhisperX，从素材音频生成逐词字幕；当前设置接口不提供本次转写的模型记录。</dd>
                  </div>
                  <div>
                    <dt>素材切分</dt>
                    <dd>把转写字幕整理成可学习的语块；新素材任务使用上面的本页模型。</dd>
                  </div>
                  <div>
                    <dt>素材翻译</dt>
                    <dd>为素材语块生成中文翻译；它与素材切分共用本次素材任务的请求模型。</dd>
                  </div>
                  <div>
                    <dt>文章解释</dt>
                    <dd>解释弹窗有自己的模型选择和请求路径，不跟随这里的素材模型。</dd>
                  </div>
                  <div>
                    <dt>短义精简</dt>
                    <dd>为复习候选生成短义；当前请求使用后端默认，不读取解释弹窗的模型选择。</dd>
                  </div>
                  <div>
                    <dt>句子即时翻译</dt>
                    <dd>走独立的句子翻译服务和缓存路径，不按素材模型重新标记已有句子翻译。</dd>
                  </div>
                </dl>
              </section>

              <Button
                type="button"
                variant="outline"
                size="default"
                class="youtube-advanced-toggle"
                data-ui-owner="workflow"
                :aria-expanded="showAdvanced ? 'true' : 'false'"
                @click="showAdvanced = !showAdvanced"
              >
                <span>{{ showAdvanced ? '收起高级设置' : '高级设置' }}</span>
              </Button>
              <div v-if="showAdvanced" class="youtube-advanced-settings">
                <label>
                  <span>Base URL（可选，使用代理网关时填写）</span>
                  <Input v-model.trim="baseUrl" type="text" name="youtube-workflow-base-url" autocomplete="off" placeholder="留空使用官方默认地址" data-ui-owner="workflow" />
                </label>
                <label>
                  <span>代理</span>
                  <Input v-model.trim="proxyUrl" type="text" name="youtube-workflow-proxy-url" autocomplete="off" placeholder="例如 http://127.0.0.1:7897，留空关闭" data-ui-owner="workflow" />
                </label>
                <label>
                  <span>cookies 文件</span>
                  <Input v-model.trim="cookiesPath" type="text" name="youtube-workflow-cookies-path" autocomplete="off" placeholder="YouTube cookies 文件路径" data-ui-owner="workflow" />
                </label>
                <label>
                  <span>输出目录</span>
                  <Input v-model.trim="outputDir" type="text" name="youtube-workflow-output-dir" autocomplete="off" placeholder="生成文件输出目录" data-ui-owner="workflow" />
                </label>
                <label>
                  <span>yt-dlp 路径</span>
                  <Input v-model.trim="ytDlpPath" type="text" name="youtube-workflow-ytdlp-path" autocomplete="off" placeholder="yt-dlp.exe" data-ui-owner="workflow" />
                </label>
                <label>
                  <span>WhisperX 路径</span>
                  <Input v-model.trim="whisperxPath" type="text" name="youtube-workflow-whisperx-path" autocomplete="off" placeholder="whisperx.exe" data-ui-owner="workflow" />
                </label>
                <div class="youtube-primary-actions">
                  <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="refreshMaintenance">维护状态</Button>
                  <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="checkCleanup">检查旧文件</Button>
                  <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="confirmCleanup">清理旧文件</Button>
                  <Button type="button" variant="outline" size="default" data-ui-owner="workflow" @click="downloadDiagnosticsPackage">导出诊断包</Button>
                </div>
                <p class="youtube-workflow-hint">维护状态用于查看后端存储情况；检查旧文件会先列出清理候选，清理需再次确认；诊断包用于排查处理问题。</p>
                <div v-if="geminiMode === 'real' && credentialStatus.stored" class="youtube-advanced-danger-row">
                  <Button type="button" variant="destructive" size="default" data-ui-owner="workflow" @click="confirmDeleteCredential">清除已保存 API Key</Button>
                </div>
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
            <strong id="youtube-quality-dialog-title">处理详情</strong>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="youtube-workflow-close-button"
              data-ui-owner="workflow"
              data-quality-initial-focus
              aria-label="关闭处理详情"
              title="关闭"
              :disabled="qualityPending"
              @click="closeQualityModal"
            >
              x
            </Button>
          </header>
          <p>{{ jobDisplayTitle(qualityModal.job) }}</p>
          <p class="youtube-library-source-detail">{{ jobRequestProvenanceText(qualityModal.job) }}</p>
          <p class="youtube-library-source-detail">{{ jobRouteProvenanceText(qualityModal.job) }}</p>
          <p ref="qualityDialogStatus" role="status" aria-live="polite" aria-atomic="true">{{ qualityIssueSummary(qualityModal.report) }}</p>
          <ul v-if="qualityModal.report.issues && qualityModal.report.issues.length" class="youtube-quality-issues">
            <li v-for="(issue, index) in qualityModal.report.issues.slice(0, 8)" :key="index">
              {{ qualityIssueText(issue) }}
            </li>
          </ul>
          <details class="youtube-quality-statistics">
            <summary>查看统计与技术信息</summary>
            <p>{{ qualityModal.report.chunkCount || 0 }} 个语块 · {{ qualityModal.report.wordCount || 0 }} 个词</p>
            <ul v-if="qualityModal.report.issues && qualityModal.report.issues.length">
              <li v-for="(issue, index) in qualityModal.report.issues" :key="index">{{ issue.code }}：{{ issue.message }}</li>
            </ul>
          </details>
          <section class="youtube-quality-repair" aria-labelledby="youtube-quality-repair-title">
            <strong id="youtube-quality-repair-title">修复素材</strong>
            <div class="youtube-workflow-actions">
              <Button type="button" variant="outline" size="default" data-ui-owner="workflow" :disabled="qualityPending" @click="retryQualityJob(qualityModal.job, 'segmenting')">重新 AI 切分</Button>
              <Button type="button" variant="outline" size="default" data-ui-owner="workflow" :disabled="qualityPending" @click="retryQualityJob(qualityModal.job, 'translating')">重新翻译</Button>
            </div>
          </section>
          <div class="youtube-quality-close-row">
            <Button type="button" variant="ghost" size="default" data-ui-owner="workflow" :disabled="qualityPending" @click="closeQualityModal">关闭</Button>
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
        <Button type="button" variant="default" size="default" data-ui-owner="workflow" @click="runMaterialNoticeAction">{{ materialNotice.actionLabel }}</Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="youtube-material-notice-close"
          data-ui-owner="workflow"
          aria-label="关闭提示"
          @click="clearMaterialNotice"
        >
          ×
        </Button>
      </aside>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button } from './ui/button/index.js'
import { Input } from './ui/input/index.js'
import { Textarea } from './ui/textarea/index.js'
import { useAudioStore } from '../pinia-stores/audio.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { runtimeState } from '../composables/runtime-state-facade.js'
import { buildCurrentSentenceDocId } from '../composables/reader-public-facades.js'
import { bridgeToPinia } from '../composables/pinia-bridge-module.js'
import { scheduleGeneratedAnnotationIndexRefresh } from '../composables/session-facades.js'
import { youtubeWorkflowClient } from '../composables/youtube-workflow-client.js'
import { createYoutubeWorkflowLoader } from '../composables/youtube-workflow-loader.js'
import { createReaderSessionPublisher } from '../composables/reader-session-publisher.js'
import { useReaderSessionPersistenceContext } from '../composables/reader-session-persistence-context.js'
import { useWorkflowLibrary } from '../composables/use-workflow-library.js'
import { createWorkflowMutationCoordinator } from '../composables/create-workflow-mutation-coordinator.js'
import { createObjectUrlDownloader } from '../services/runtime/download-object-url.js'
import { createDialogController, createPendingActionGuard } from '../services/runtime/dialog-controller.js'
import { observeBestEffort, recordBestEffortFailure } from '../services/runtime/best-effort.js'
import { readWorkflowOperationReceipt } from '../services/workflow/operation-receipt.js'
import {
  canonicalMaterialKey,
  exactDateTime,
  extractYoutubeVideoId,
  findDuplicateMaterial,
  groupTaskAttempts,
} from '../services/workflow/material-center-model.js'

const terminalStatuses = new Set(['ready', 'failed', 'canceled'])
const readerPersistence = useReaderSessionPersistenceContext()
const audioStore = useAudioStore()
const chunkStore = useChunkStore()
const transcriptStore = useTranscriptStore()
const currentArticleTitle = computed(() => {
  if (!transcriptStore.segments.length) return '尚未打开文章'
  const meta = audioStore.currentAudioMeta
  const docId = buildCurrentSentenceDocId({ segments: transcriptStore.segments })
  const localName = audioStore.localTranscriptTitles[docId]
  if (localName) return localName.replace(/\.(json|srt|vtt)$/iu, '')
  return meta?.name ? meta.name.replace(/\.audio$/u, '') : '已导入本地字幕'
})
const articleTitleBeforeOpen = ref('尚未打开文章')
const readerOpenMessage = ref('从素材库打开材料，或在阅读设置中导入本地文件')

const panelOpen = ref(false)
const linkInput = ref('')
const batchInputExpanded = ref(false)
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
const backendConfigLoadState = ref('idle')
const backendConfigSaveState = ref('idle')
const backendConfigSnapshot = ref(null)
const maintenanceInfo = ref(null)
const showAdvanced = ref(false)
const starting = ref(false)
const workflowView = ref('library')
const expandedLibraryJobId = ref('')
const openingJobId = ref('')
const videoPriority = ref(true)
const qualityPending = ref(false)
const panelDialogRoot = ref(null)
const qualityDialogRoot = ref(null)
const qualityDialogStatus = ref(null)
const qualityModal = ref(null)
const materialNotice = ref(null)
const currentJobId = readerPersistence.currentJobId
const loadedReadyJobs = new Set()
let linkSequence = 0
let readerSessionLoader = null
let materialNoticeTimer = 0
const diagnosticsDownloader = createObjectUrlDownloader()
const panelDialogController = createDialogController()
const qualityDialogController = createDialogController()
const qualityActionGuard = createPendingActionGuard({ onChange: (pending) => { qualityPending.value = pending } })
const backendConfigFields = Object.freeze([
  'model',
  'baseUrl',
  'proxyUrl',
  'cookiesPath',
  'outputDir',
  'ytDlpPath',
  'whisperxPath',
])
const backendConfigFieldRefs = {
  model,
  baseUrl,
  proxyUrl,
  cookiesPath,
  outputDir,
  ytDlpPath,
  whisperxPath,
}
const locallyEditedConfigFields = new Set()
let applyingBackendConfig = false
let backendConfigLoadToken = 0
const panelPending = computed(() => starting.value)
const { readerSessionPersistence, readerConflictVisible, resolveReaderConflict, applyReaderMarks, syncMarkedWordVisuals, syncReaderActivity } = readerPersistence
const workflowLibrary = useWorkflowLibrary({
  onRevision: payload => workflowMutations.rememberWorkflowRevision(payload),
  onRevisionUnavailable: () => workflowMutations.invalidateWorkflowRevision(),
  onJobsChanged: refreshLinkDuplicates,
  canRetryLibrary: () => panelOpen.value && workflowView.value === 'library',
  hasUntrustedMarksNotice: readerPersistence.hasUntrustedMarksNotice,
})
const workflowMutations = createWorkflowMutationCoordinator({
  requestWorkflowSnapshot: workflowLibrary.requestWorkflowSnapshot,
  refreshQueue: workflowLibrary.refreshQueue,
})
const {
  queueJobs, recentJobs, libraryPending, libraryHasMore,
  serviceOnline, serviceStatusKnown, libraryNotice: panelReaderNotice,
  completionSignal, visibleCompletedJobIds, refreshQueue, refreshLibrary,
  refreshRecent, refreshJob, updateJob, loadMoreLibrary,
  startPolling, mergeRecentReaderItem, clearMaterialRepairState,
} = workflowLibrary
const {
  workflowMutationNotice, rememberWorkflowRevision, runPendingWorkflowAction,
  forgetPendingWorkflowAction, workflowMutationOptions, isWorkflowMutationConflict,
  handleWorkflowMutationConflict,
} = workflowMutations
const readerActivityNotice = computed(() => readerPersistence.readerActivityNotice.value || panelReaderNotice.value)
const unsubscribeRecentReaderItem = readerPersistence.subscribeRecentReaderItem(mergeRecentReaderItem)
const cancelReaderLoad = () => readerSessionLoader?.cancelLoad()
const unregisterReaderLoader = readerPersistence.registerLoadCancellation(cancelReaderLoad)
let panelDisposed = false

const geminiMode = computed(() => {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('workflowMode') || window.localStorage.getItem('youtubeWorkflow.devMode') || 'real'
  return ['mock', 'off'].includes(requested) ? requested : 'real'
})
const workflowModeText = computed(() => ({
  real: '真实模式',
  mock: '开发模拟',
  off: 'AI 已关闭',
}[geminiMode.value] || geminiMode.value))
const currentModelText = computed(() => String(model.value || '').trim() || '未填写')
const backendConfigIsComplete = computed(() => {
  const snapshot = backendConfigSnapshot.value
  return backendConfigLoadState.value === 'loaded'
    && !!snapshot
    && backendConfigFields.every((key) => Object.prototype.hasOwnProperty.call(snapshot, key))
})
const backendModelText = computed(() => {
  if (backendConfigLoadState.value === 'loading') return '正在读取…'
  if (backendConfigLoadState.value === 'failed') return '未确认（读取失败）'
  if (backendConfigLoadState.value !== 'loaded') return '未确认（尚未读取）'
  if (!Object.prototype.hasOwnProperty.call(backendConfigSnapshot.value || {}, 'model')) return '未提供（未知）'
  return String(backendConfigSnapshot.value?.model || '').trim() || '已读取为空（后端默认）'
})
const backendConfigDraftChanged = computed(() => {
  if (!backendConfigIsComplete.value) return locallyEditedConfigFields.size > 0
  return backendConfigFields.some((key) => {
    const current = String(backendConfigFieldRefs[key].value || '').trim()
    const saved = String(backendConfigSnapshot.value?.[key] || '').trim()
    return current !== saved
  })
})
const canSaveBackendConfig = computed(() => backendConfigIsComplete.value && backendConfigSaveState.value !== 'saving')
const backendConfigSaveButtonText = computed(() => backendConfigSaveState.value === 'saving' ? '保存中…' : '保存后台配置')
const backendConfigStateText = computed(() => {
  if (backendConfigLoadState.value === 'loading') return '正在读取后台配置；读取完成前不会提交配置。'
  if (backendConfigLoadState.value === 'failed') return '后台配置读取失败，保存已保护；当前输入只代表本页选择。'
  if (backendConfigSaveState.value === 'saving') return '保存中…'
  if (backendConfigSaveState.value === 'failed') return '保存失败，保留当前输入，可重试。'
  if (backendConfigSaveState.value === 'saved') return '已确认保存：后台已返回本次配置。'
  if (backendConfigLoadState.value === 'loaded' && !backendConfigIsComplete.value) return '后台配置读取不完整，未知字段不会被提交。'
  if (backendConfigDraftChanged.value) return '当前选择或设置尚未保存。'
  if (backendConfigLoadState.value === 'loaded') return '后台配置已读取；当前页面选择尚未执行本次保存。'
  return '尚未读取后台配置；当前输入不会被标为已保存。'
})
const enqueuableLinkCards = computed(() => linkCards.value.filter((card) => card.valid && !card.duplicate))
const duplicateLinkCards = computed(() => linkCards.value.filter((card) => card.valid && card.duplicate))
const invalidLinkCards = computed(() => linkCards.value.filter((card) => !card.valid))
const pendingValidLinkCount = computed(() => parseLinks(linkInput.value).filter((link) => isValidMaterialUrl(link)).length)
const enqueuableMaterialCount = computed(() => enqueuableLinkCards.value.length + pendingValidLinkCount.value)
const canEnqueue = computed(() => {
  if (!batchInputExpanded.value && parseLinks(linkInput.value).length + linkCards.value.length > 1) return false
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

function noteBackendConfigEdit(key) {
  if (applyingBackendConfig) return
  locallyEditedConfigFields.add(key)
  if (backendConfigSaveState.value !== 'saving') backendConfigSaveState.value = 'idle'
}

watch(model, (value) => {
  saveTextSetting('youtubeWorkflow.model', value)
})
watch(baseUrl, (value) => {
  saveTextSetting('youtubeWorkflow.baseUrl', value)
})
for (const key of backendConfigFields) {
  watch(backendConfigFieldRefs[key], () => noteBackendConfigEdit(key), { flush: 'sync' })
}
watch(() => audioStore.lastLocalImport, () => {
  if (openingJobId.value || !transcriptStore.segments.length) return
  readerOpenMessage.value = `已打开：${currentArticleTitle.value}`
  clearMaterialNotice()
})

async function refreshPreferredVideo() {
  const requestedJobId = currentJobId.value
  const mediaSource = window.__mediaSource
  if (!requestedJobId || !mediaSource?.getState?.().videoPreferred) return
  if (mediaSource.getState().videoAvailable || typeof mediaSource.loadJobMedia !== 'function') return
  try {
    const manifest = await youtubeWorkflowClient.getSession(requestedJobId)
    if (panelDisposed || currentJobId.value !== requestedJobId || !mediaSource.getState().videoPreferred) return
    const files = manifest?.files || {}
    if (!files.video) return
    mediaSource.loadJobMedia({
      jobId: requestedJobId,
      title: manifest.title || '',
      hasVideo: true,
      videoUrl: youtubeWorkflowClient.mediaUrl(requestedJobId, 'video'),
      videoSource: manifest.media?.videoSource || 'session-refresh'
    })
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'panel-current-video-refresh',
      reason: 'optional video metadata refresh must not interrupt reader playback',
    })
  }
}

onMounted(() => {
  window.localStorage.removeItem(['youtubeWorkflow', 'apiKey'].join('.'))
  workflowMutations.cleanupReceipts()
  refreshPreferredVideo()
})

onBeforeUnmount(() => {
  panelDisposed = true
  if (materialNoticeTimer) window.clearTimeout(materialNoticeTimer)
  qualityActionGuard.dispose()
  qualityDialogController.dispose()
  panelDialogController.dispose()
  workflowLibrary.dispose()
  workflowMutations.dispose()
  unregisterReaderLoader()
  readerSessionLoader = null
  unsubscribeRecentReaderItem()
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
  const initialFocus = qualityDialogRoot.value.querySelector('button[data-quality-initial-focus]:not([disabled])')
  qualityDialogController.open(qualityDialogRoot.value, {
    initialFocus,
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
    applyReaderMarks,
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
    showToast: window.showToast
  })
  return readerSessionLoader
}

function commitLinkInput() {
  const links = parseLinks(linkInput.value)
  if (!links.length) return
  if (!batchInputExpanded.value && links.length > 1) {
    linkNotice.value = '多个链接请展开“批量添加”。'
    return
  }
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
  if (!canEnqueue.value) return
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
          return youtubeWorkflowClient.createJob(action.payload, workflowMutationOptions(action))
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
  workflowLibrary.resetLibraryRetry()
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

async function loadBackendConfig() {
  if (backendConfigSaveState.value === 'saving') return
  const loadToken = ++backendConfigLoadToken
  backendConfigLoadState.value = 'loading'
  backendConfigSaveState.value = 'idle'
  backendConfigSnapshot.value = null
  backendConfigNotice.value = ''
  try {
    const config = await youtubeWorkflowClient.getConfig()
    if (loadToken !== backendConfigLoadToken) return
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('后台配置读取响应无效')
    backendConfigSnapshot.value = { ...config }
    backendConfigLoadState.value = 'loaded'
    applyingBackendConfig = true
    try {
      for (const key of backendConfigFields) {
        if (!Object.prototype.hasOwnProperty.call(config, key) || locallyEditedConfigFields.has(key)) continue
        const value = String(config[key] ?? '')
        if (key === 'model' && !value.trim()) continue
        backendConfigFieldRefs[key].value = value
      }
    } finally {
      applyingBackendConfig = false
    }
  } catch (error) {
    if (loadToken !== backendConfigLoadToken) return
    backendConfigLoadState.value = 'failed'
    backendConfigSnapshot.value = null
    const presented = recordBestEffortFailure(error, {
      operationId: 'panel-backend-config-load',
      reason: 'settings view keeps its current choices and protects unknown backend fields when config is unavailable',
    })
    backendConfigNotice.value = `${presented.notice.message}（未提交配置）`
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
  if (backendConfigSaveState.value === 'saving') return
  if (!backendConfigIsComplete.value) {
    backendConfigNotice.value = backendConfigLoadState.value === 'loaded'
      ? '后台配置字段尚未完整读取，未提交任何配置。'
      : '后台配置尚未成功读取，未提交任何配置。'
    return
  }
  backendConfigSaveState.value = 'saving'
  backendConfigNotice.value = ''
  try {
    const payload = {
      model: model.value,
      baseUrl: baseUrl.value,
      proxyUrl: proxyUrl.value,
      cookiesPath: cookiesPath.value,
      outputDir: outputDir.value,
      ytDlpPath: ytDlpPath.value,
      whisperxPath: whisperxPath.value
    }
    const saved = await youtubeWorkflowClient.saveConfig(payload)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('后台保存响应无效')
    const confirmedSnapshot = { ...(backendConfigSnapshot.value || {}), ...saved }
    backendConfigSnapshot.value = confirmedSnapshot
    const pendingDraftFields = backendConfigFields.filter((key) => {
      const current = String(backendConfigFieldRefs[key].value || '').trim()
      const confirmed = String(confirmedSnapshot[key] || '').trim()
      return current !== confirmed
    })
    locallyEditedConfigFields.clear()
    pendingDraftFields.forEach((key) => locallyEditedConfigFields.add(key))
    if (pendingDraftFields.length) {
      backendConfigSaveState.value = 'idle'
      backendConfigNotice.value = `上次提交已保存；当前编辑尚未保存（${pendingDraftFields.join('、')}）。`
    } else {
      backendConfigSaveState.value = 'saved'
      backendConfigNotice.value = `已保存后台配置：${saved.outputDir || outputDir.value || '默认输出目录'}`
    }
  } catch (err) {
    backendConfigSaveState.value = 'failed'
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

function openJob(job) {
  if (!job?.jobId || openingJobId.value) return
  clearMaterialNotice()
  articleTitleBeforeOpen.value = currentArticleTitle.value
  readerOpenMessage.value = `正在打开：${jobDisplayTitle(job)}…`
  openingJobId.value = job.jobId
  hidePanelAfterLoad()
  loadJob(job)
}

function openRecentJob(job) {
  openJob(normalizeRecentJob(job))
}

async function loadJob(job) {
  if (panelDisposed) return
  const loadToken = readerPersistence.beginLoad(cancelReaderLoad)
  if (loadToken === null) {
    openingJobId.value = ''
    readerOpenMessage.value = `未打开：${jobDisplayTitle(job)}，请先处理阅读记录冲突`
    return
  }
  try {
    if (currentJobId.value && currentJobId.value !== job.jobId) {
      observeBestEffort(syncReaderActivity('switch'), {
        operationId: `reader-background-switch-save-${currentJobId.value}`,
        reason: 'captured reader progress persists in the background and never blocks opening the next material',
      })
    }
    const shouldResumeAudio = !!(getAudio() && !getAudio().paused)
    const result = await makeLoader().loadJobIntoReader(job.jobId, { replacePolicy: 'replace-current' })
    if (!result || result.status !== 'loaded' || panelDisposed || !readerPersistence.isCurrentLoad(loadToken)) return
    clearMaterialRepairState(job.jobId)
    if (!readerPersistence.activateJob(job, loadToken)) return
    readerOpenMessage.value = `已打开：${result.manifest?.title || jobDisplayTitle(job)}`
    readerPersistence.endLoad(loadToken)
    loadedReadyJobs.add(job.jobId)
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
    if (!panelDisposed && readerPersistence.isCurrentLoad(loadToken)) showMaterialLoadFailure(job, err)
  } finally {
    readerPersistence.endLoad(loadToken)
    if (openingJobId.value === job.jobId) {
      openingJobId.value = ''
      if (readerOpenMessage.value.startsWith('正在打开：')) readerOpenMessage.value = `已取消打开：${jobDisplayTitle(job)}`
    }
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
  readerOpenMessage.value = `打开失败：${jobDisplayTitle(job)}。${failure.message}`
  workflowLibrary.recordMaterialRepair(job.jobId, {
    needsRepair: true,
    repairReason: failure.message,
    repairAction: failure.action,
  })
  materialNotice.value = { ...failure, message: `打开失败：${jobDisplayTitle(job)}。${failure.message}`, job, error }
  resumeMaterialNotice()
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

function libraryTimeLabel(job) {
  if (job?.lastActivityAt) return '最近活动'
  if (job?.lastOpenedAt) return '最近打开'
  if (job?.finishedAt) return '处理完成'
  return job?.sourceType === 'legacy-import' ? '导入' : '创建'
}

function libraryExactTime(job) {
  return exactDateTime(libraryStamp(job))
}

function librarySourceText(job) {
  const videoId = extractYoutubeVideoId(job?.url || job?.request?.url)
  if (videoId) return `YouTube · ${videoId}`
  return job?.sourceType === 'legacy-import' ? '本地导入素材' : '学习素材'
}

function jobRequestProvenanceText(job) {
  const request = job && job.request && typeof job.request === 'object' ? job.request : null
  const model = String(request?.model || '').trim() || '未记录'
  const rawMode = String(request?.geminiMode || request?.gemini_mode || '').trim().toLowerCase()
  const mode = {
    real: '真实模式',
    mock: '开发模拟',
    off: '未调用远程模型',
  }[rawMode] || (rawMode || '未记录')
  return `任务请求模型：${model} · 请求模式：${mode}`
}

function jobRouteProvenanceText(job) {
  return '实际执行/路由模型：当前记录未提供'
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
      await workflowMutations.deleteJob(jobId)
      workflowLibrary.removeQueueJobs([jobId])
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
    await workflowMutations.deleteJob(job.jobId)
    workflowLibrary.removeLibraryRecord(job.jobId)
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
    await workflowMutations.clearFailedJobs()
    workflowLibrary.removeFailedJobs()
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
  if (!window.confirm(`素材：${title}\n阶段：重新下载、生成字幕、AI 切分与翻译\n\n将创建新任务；不会主动删除已有素材和阅读记录，但重新生成的文件可能与原结果共用目录，标注位置不保证一致。完成后需主动打开新结果。\n\n继续重新处理吗？`)) return
  const payload = { ...buildCreateJobPayload(url), forceReprocess: true }
  const actionId = `reprocess:${job?.jobId || canonicalMaterialKey(url)}:${Date.now()}`
  try {
    const created = await runPendingWorkflowAction(actionId, 'create', '', payload, (action) => (
      youtubeWorkflowClient.createJob(action.payload, workflowMutationOptions(action))
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
      return youtubeWorkflowClient.cancelJob(action.targetJobId, workflowMutationOptions(action))
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
      return youtubeWorkflowClient.prioritizeJob(action.targetJobId, workflowMutationOptions(action))
    })
    updateJob(updated)
    forgetPendingWorkflowAction(actionId)
  } catch (err) {
    if (isWorkflowMutationConflict(err)) await handleWorkflowMutationConflict(err)
    else workflowMutationNotice.value = err && err.message ? err.message : String(err)
  }
}

async function retryJob(job, stage = '') {
  if (stage && !confirmStageRetry(job, stage)) return
  const payload = { model: model.value, baseUrl: baseUrl.value, videoPriority: videoPriority.value }
  if (stage) payload.stage = stage
  if (geminiMode.value === 'real' && apiKey.value.trim()) payload.apiKey = apiKey.value
  const actionId = `retry:${job.jobId}:${stage || 'auto'}`
  workflowMutationNotice.value = ''
  try {
    const retried = await runPendingWorkflowAction(actionId, 'retry', job.jobId, payload, (action) => {
      return youtubeWorkflowClient.retryJob(action.targetJobId, action.payload, workflowMutationOptions(action))
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

function confirmStageRetry(job, stage) {
  const processing = stage === 'segmenting' ? 'AI 切分及后续翻译' : '翻译'
  return window.confirm(`素材：${jobDisplayTitle(job)}\n阶段：${processing}\n\n将创建重试任务，重新生成的 AI 结果可能覆盖检查点中的旧文件；缺少检查点时后台可能从更早阶段继续。不会主动删除阅读记录，但新结果的标注位置不保证一致。完成后需主动打开新结果。\n\n继续修复吗？`)
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
  if (!report) return '暂无检查结果，暂时无法判断素材是否可读。'
  const total = Array.isArray(report.issues) ? report.issues.length : 0
  if (report.ok === true && !total) return '检查未发现问题，可以打开阅读。'
  if (total) return `发现 ${total} 个问题，部分内容可能影响阅读；请查看下方原因，再选择是否修复。`
  return '检查尚未确认通过，暂时无法判断素材是否可读。'
}

function qualityIssueText(issue) {
  return {
    timestamp_reverse: '字幕的结束时间早于开始时间，播放定位可能不准确。',
    timestamp_order: '字幕时间顺序不一致，播放定位可能不准确。',
    empty_translation: '部分语块缺少中文翻译。',
    empty_source: '部分语块缺少英文原文。',
    invalid_range: '部分语块的单词范围无效。',
    long_chunk: '部分语块较长，可以按需要重新切分。',
    chunk_transcript_mismatch: '语块与字幕的单词范围不匹配。',
  }[issue?.code] || '存在未识别的处理问题，请展开技术信息查看原因。'
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
  const item = readerPersistence.getPlaybackState(job.jobId)
  if (item && item.completed) return '已听完'
  if (item && item.coverageRatio > 0) return '收听中'
  return '未开始'
}

function getAudio() {
  return readerPersistence.getReaderMedia()
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
