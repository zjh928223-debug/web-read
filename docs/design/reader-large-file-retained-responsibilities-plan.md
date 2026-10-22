# 第 6 项：先整理必须保留的阅读保存职责

日期：2026-10-03。状态：首轮施工方案已准备，尚未施工。

本方案已扩展为 [第 6 项分轮总施工方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/README.md)。以下保留为前一版背景；施工以总方案、共同约定及对应 R1–R9 文件为准。

本文件的编号沿用父对话最后给出的六项清单：第 1 项为 SRS 退出修复，第 2、3 项为退役状态和闲置代码清理，第 4 项为有限 CSS 清理，第 5 项为用户规划功能撤除，第 6 项为按保留职责整理大文件。不要与整体审视报告内部的八个候选编号混用。

A 对应第 1 项，B 对应第 2、3 项，C 对应第 4 项；三线的既定限定范围已经独立 PASS，见[最终复审](C:/Users/0/AppData/Local/Temp/reader-srs-media-A-independent-review-20261003-e379c684/review.md)。历史额外检查 FAIL/NOT_RUN/NOT_VERIFIED 保留。

用户正在编写第 5 项。本轮先准备第 6 项中不依赖功能取舍的第一轮：集中阅读标记、活动、补发和关闭保存的接线。保持现有功能、调用顺序、UI 和持久化契约。素材面板整体拆分、功能撤除和后端大文件拆分在功能清单确定后再排，不将整个第 6 项当作一轮任务。

## 1. 首轮目标与明确限制

目前 `YouTubeWorkflowPanel.vue` 已调用独立 tracker、save coordinator、marks hydration 和 outbox storage，但还自行组装并承担这些服务之间的保存协议、事件和卸载接线。素材操作与阅读保存要在同一大文件中来回阅读。

首轮将这组接线集中到 `src/composables/use-reader-session-persistence.js`，复用现有服务。面板只保留素材操作、加载状态、UI 和对阅读保存的必要调用。新文件是行为所有者，不能只是把原函数逐个包装转发，或把十几项私有 callback 原封不动做成调用方责任。

这一轮仍由当前面板实例建立和释放保存实例，保持现有启动/卸载时序；**抽出代码并不等于删除面板后保存已经独立存活**。若第 5 项决定删除素材面板，还必须另做应用级保存生命周期归属迁移并独立验收，不能直接删除面板。

不改组件 template/CSS、布局、入口、业务 API、IndexedDB schema、storage key、revision/operationId、冲突策略、可信 marks 来源或保留功能。不上移到 reader-runtime/session-init，不新增 window 发布。SRS 修复、B/C 清理和原有 WhisperX/语言处理 dirty 均保持。

## 2. 文件范围

产品只允许：

- `src/components/YouTubeWorkflowPanel.vue` 的 script：调用新所有者，移除已完整迁移的保存实现。
- 新增 `src/composables/use-reader-session-persistence.js`：集中 tracker/coordinator/hydration 装配、mark 可见状态适配、活动提交、outbox 和事件生命周期。

应保持实现字节不变：`use-reader-save-coordinator.js`、`create-reader-marks-hydration.js`、`reader-playback-tracker.js`、`reader-session-persistence.js`、`reader-outbox-storage.js`、`latest-wins-ledger.js`、`youtube-workflow-client.js`。如本次抽取必须改这些服务，先说明具体原因并重新限定范围，不顺带重写它们。

测试允许按消费证明最小同步：`youtube-workflow-panel-v3-check.cjs`、`workflow-reader-marks-ledger-check.mjs`、`reader-marks-activity-conflict-check.mjs`、`marks-store-check.cjs`、`video-player-module-check.cjs`。迁移后的所有者断言读新文件，面板接线断言继续读面板；不能把两文件随意拼成一份文本让旧断言假通过，不能删除行为断言。

允许在现有 `youtube-workflow-panel-reader-recovery-browser-check.mjs` 中最小增加 Temp outDir/证据保留配置，以便完整运行原真实 journey 且不改工作区 dist；不新增另一个大型浏览器框架。测试文件及新模块按现有 inventory 规则登记，只更新对应记录；README/PROJECT_MAP 只同步本轮真实职责。其它文档数字和偏好 key 问题不夹带修复。

## 3. 顺序与调用者

1. **保存 opening**：当前工作区原字节、相关文件 SHA256、HEAD/status/精确 diff 写入独有 Temp；这是已汇合 ABC 的基线，不从 HEAD 覆盖 dirty。记录模板、CSS、依赖和现有基础服务哈希。
2. **画出并确认当前接口**：面板模板消费 notice/conflict；`makeLoader()` 传 session persistence 并应用 marks；`loadJob()` 标识加载期、保存 switch、启动新会话、恢复 activity revision；库项消费 playback state；mounted/unmount 消费绑定/补发/关闭保存。先列出这些真实消费者，再确定新模块对外接口。
3. **集中行为所有权**：迁移现有装配和 `ensureCurrentJobFromAudioMeta`、marks normalization/restore/edit、activity submit、outbox request/replay/conflict/keepalive、pagehide/pageshow/beforeunload。继续使用同一 currentJobId ref；加载状态以读取接口提供，避免新模块持有过期副本。媒体选择继续遵守当前 media-source/audio fallback。
4. **保持顺序**：初始化不得在 hydration/coordinator 就绪前触发回调；session source-ready 与加载期抑制保持；mounted 仍先绑定 tracker、解析当前 job、启动补发并绑定事件；unmount 仍先取消 loader，再关闭保存、移除事件、解除 tracker、清 hydration、dispose coordinator。不要抽成自动 onMounted/onBeforeUnmount 导致顺序隐式变化。
5. **收窄面板接线**：只暴露已确认的 UI 状态和加载/保存/恢复/生命周期操作；不要把全部私有 outbox 函数、ledger map 或底层对象通通导出。加载器已有 session persistence 依赖可保留显式接口，不能再实现一套 persistence。
6. **同步检查、完整验证、交接**：按下表执行，之后停止产品写入，等待独立只读复审。首轮通过仅表示保存职责抽取完成，不宣布第 6 项整体完成。

## 4. 固定验收

| 标准 | 必须达到 |
| --- | --- |
| L1 所有权与布局 | 保存接线只有一个所有者；面板没有复制的 outbox/marks 生命周期实现；template/CSS 字节不变，现行素材操作保留。 |
| L2 marks | restore 不变成本地 edit；可信 edit 带 sourceRevision/localVersion；迟到恢复不覆盖本地编辑或权威数据；同步 Pinia/标记视觉/本地 session 保存保持。 |
| L3 activity/切换 | 当前 job/session 的播放、progress、annotation、open/switch/close 行为保持；切换时旧任务请求不污染新任务状态，加载期不错误保存新旧混合数据。 |
| L4 关闭与补发 | pagehide/beforeunload 同一关闭代只结算一次；先同步写 outbox 再 keepalive；失败保留、成功按原操作身份清除；来源不明 marks 不自动发送。 |
| L5 恢复与冲突 | 原持久化 key/schema/幂等/冲突/revision 规则不变；重开补发和 bfcache pageshow 的关闭代行为保持；不将人工派发事件称为真实 bfcache。 |
| L6 生命周期 | 实际 mount/unmount 的事件绑定、tracker、loader 取消、关闭 flush、hydration/coordinator 释放保持原顺序，无重复监听或重建多个保存实例。 |
| L7 完整必要检查 | 原行为和下列必要旅程完整通过，无必要 NOT_RUN/NOT_VERIFIED；证据绑定最终源码，原失败保留。 |

必要 focused 检查：完整 `verify:youtube-workflow-panel`、`verify:workflow-reader-ledger`、`verify:reader-session-persistence`，以及 `reader-marks-activity-conflict-check.mjs`、`marks-store-check.cjs`、`video-player-module-check.cjs`、现行 tracker/hydration/outbox 专属检查（执行前从 package/inventory 确认正式入口，不能猜命令名）。

必要浏览器旅程使用当前 `youtube-workflow-panel-reader-recovery-browser-check.mjs` 的完整原检查：conflict/reload/single-flight、close/outbox/auth、并发不同/同 job、bfcache 收据代、legacy outbox migration、invalid quarantine、quota fail-closed。不得只运行 BFCache contract-only 或简化组件 mock 代替。原脚本使用真实临时 API Host；这证明该测试 Host 的受控旅程，不证明用户运行服务/真实素材/跨机或自然音频。

另外需在实际组件夹具中明确观察 mount→marks edit→卸载：DOM 确实退出、关闭保存只一代、迟到回调不再创建监听/提交第二次。同卡/切卡路径由上面原检查覆盖，不额外建设庞大矩阵。若现有原 journey 已覆盖该卸载，引用真实断言与产物即可，不重复造测试。

静态必要检查：新 JS 与修改检查脚本的语法、`git diff --check`、inventory/documentation 正式门禁、精确增量和原模板/CSS/基础服务哈希。既有 ABC 测试未受影响时按身份继承，不为本轮重做主题矩阵或 SRS 13 场景。

## 5. 运行隔离与证据

完整 recovery 脚本当前默认执行 repo build 并使用工作区 dist。施工时须先加入可配置 Temp dist，使 build 的 outDir 与 Host dist 指向同一绝对目录；全部业务 data/cache/artifacts 使用独有 Temp，测试使用自己创建的随机 loopback 端口，不碰 5184/8776 试用服务及每日端口。不得裸跑脚本后才说明它覆盖了工作区 dist。

保留 fresh 构建输入/产物哈希、测试原始 stdout/stderr/exit、请求/旅程身份及实际截图。未知外网请求阻断，合成素材来源明确。不能将 route mock、手动生命周期事件、播放方法 probe 升级为真实跨机/自然播放证明。测试只停止自有服务；finally 关闭 browser/Host，保留证据而不是清掉失败目录。

support script 超过约 500 行或两倍已审基线时按 AGENTS 说明并收窄；既有长检查不借本次增加第二套保存实现。连续两次同任务修复/复审失败停止自动迭代，交接原因和最小下一步。

回滚使用本轮 opening 与反向增量，先检查当前 SHA256；已有后续改动只反向本轮 hunks。禁止 reset/restore HEAD/clean 或覆盖原 ABC/WhisperX dirty。没有数据契约变更，不进行数据回滚。

## 6. 后续节奏

首轮估计施工与完整自检 1–2 小时，独立审核另计，失败排查另计。此估计不是全部大文件整理的总耗时。

等第 5 项清单完成，再根据保留功能选择下一轮：素材 UI/操作、预习/SRS 的剩余职责，或后端仍保留的任务生命周期。每轮一个明确所有者、既定消费者和必要行为验收。若素材面板要删除，应先单独完成应用级阅读保存生命周期迁移，再删 UI。
