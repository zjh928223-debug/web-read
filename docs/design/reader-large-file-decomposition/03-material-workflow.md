# R3：整理素材列表、轮询与变更操作，保留面板展示

状态：待R2独立PASS，且第5项确认素材列表/任务操作的保留范围。若素材面板退休，本轮取消，转第5项删除并保留R2保存范围。施工/自检估计2–3小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。

## 1. 本轮结果

面板只协调可见状态、弹窗/表单、打开材料与渲染；列表分页/请求重试/轮询归列表所有者，revision/operation receipt/single-flight归变更所有者。复用现有 material-center-model、job-polling-scheduler、operation-receipt，不再次拆其纯逻辑。

本轮不拆Vue可见template，不同时撤入口或改UI风格。credentials/config、quality弹窗、native picker仍按当前归属保留；第5项删除的职责不搬新模块。

## 2. 精确范围

产品修改 E:/read-web-next-optimization/src/components/YouTubeWorkflowPanel.vue 的script；新增 src/composables/use-workflow-library.js 与 src/composables/create-workflow-mutation-coordinator.js。R2保存上下文与基础客户端/loader保持契约和实现字节；确需消费新通知只改面板接线。

迁移候选：refreshJobsSnapshot、refreshLibrary/loadMoreLibrary、库分页retry和polling；rememberWorkflowRevision/getPendingWorkflowAction/forget/workflowMutationOptions/runPendingWorkflowAction/ensureWorkflowRevision/handleConflict及其私有状态。cancel/prioritize/retry/delete等现行动作继续通过协调器发起；建立从每个保留按钮到client的消费表。

检查最小同步 scripts/youtube-workflow-panel-v3-check.cjs、youtube-workflow-panel-v3-browser-check.cjs、job-polling-scheduler-check.mjs（现有基础行为断言保持）、对应workflow receipt/check入口；清单/docs仅本轮。template/CSS/App/后端不改。

## 3. 按顺序施工

1. 对照第5项保留表，保存R2 closing与本轮opening。枚举列表/任务/删除/重试/优先/配置入口，不能通过“过时”标签推断删除。
2. 先迁移list request与分页状态：refresh single-flight、查询scope/pageSize、去重、完成任务显示/timer、library retry及signal传递保持；UI展示字段仍读同一ref。
3. 将轮询的start/stop/dispose归列表范围，复用jobPollingScheduler；job切换/面板关闭/根卸载不遗留listener/timer，不改轮询节奏或SSE协议。
4. 搬迁mutation revision/receipt/fingerprint/inflight状态和conflict处理，操作开始捕获target/payload，不用当前UI变更后的值结算旧请求。
5. 每个保留动作接同一mutation接口；idempotency receipt写入/忘记时机、expected revision、失败重试与notice保持，不能给每个点击生成不同重复写operation。
6. loader/openJob继续消费R2上下文，不再次持有核心保存。credentials/config/quality controller的busy与focus读取对接新refs，未迁移职责留原位。
7. 更新所属源码断言与完整浏览器操作，fresh生产版computed对照，交接停止。

## 4. 固定验收 R3-A1–A6

| 标准 | 必须达到 |
| --- | --- |
| A1 列表 | 初始/翻页/筛选/重试/重复返回的项目、顺序、分页与notice等价。 |
| A2 任务生命周期 | polling只一份，进度/完成/failed/canceled与关闭释放保持；未启动隐藏任务来源。 |
| A3 变更一致性 | 同payload幂等、并发single-flight、revision冲突与重试保持；旧target结果不覆盖新选中项目。 |
| A4 操作 | 所有第5项保留的cancel/prioritize/retry/delete/open/config/credential操作有真实入口验证，未降低busy保护。 |
| A5 保存 | 打开/切换材料仍走R2范围，mark/activity/卸载outbox不丢、不重复。 |
| A6 UI与结构 | template/CSS相同，无新DOM层级；dark/light保留theme的panel/backdrop/disabled/focus样式在生产计算对照一致。 |

## 5. 完整检查与浏览器

- npm.cmd run verify:youtube-workflow-panel
- npm.cmd run verify:youtube-workflow-panel-behavior：实际底层browser脚本通过READ_WEB_URL连接本轮fresh随机服务，完整原场景；保留panel/backdrop配色断言，不再沿用过时配色。
- npm.cmd run verify:youtube-workflow-client
- npm.cmd run verify:youtube-workflow-loader
- npm.cmd run verify:youtube-workflow-batch-jobs
- node scripts/reader-marks-activity-conflict-check.mjs
- node scripts/reader-playback-tracker-check.mjs
- npm.cmd run verify:job-polling-scheduler
- node scripts/youtube-workflow-operation-receipt-check.cjs
- 一条实际open→mark edit→switch→page close保存旅程；可引用当前完整recovery运行中的相关journey，不能用单纯call mock代替。
- 共同静态门禁。

视口1280×720、390×844，当前dark/light（若第5项保留custom，加custom）分别真实打开材料面板，检查列表、分页、展开项、quality弹窗、disabled与关闭后focus。before/after同fixture生产CSS/computed对照，不做无关学习页矩阵。

## 6. 回滚与下一轮

交接迁移表、两个新模块接口、完整操作清单、原日志/源码产物身份，R3-A1–A6分项。回滚仅本轮Panel/新文件增量，不动R2共享保存范围与第5项删除。若必须迁移配置/credential/provider或拆template才能完成，先另定范围，不把它塞入两个万能模块。

