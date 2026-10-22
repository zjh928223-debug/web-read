# R1：集中阅读保存接线，保持原生命周期归属

状态：待施工。可现在开始；无需等待第 5 项。施工/完整自检估计 1–2 小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。本轮方案取代前一版首轮方案的执行细节；不宣布第 6 项整体完成。

## 1. 结果与消费者

将素材面板里的阅读保存接线移到专有 composable，继续复用现有 tracker/coordinator/hydration/outbox。本轮仍由面板建立、启动、释放实例，先保证机械迁移与行为相同；R2 再改变生命周期归属。

现有消费者：
- 面板模板：readerActivityNotice、readerConflictVisible 和冲突解决。
- makeLoader：readerSessionPersistence 与 applyReaderMarks。
- loadJob：加载期抑制、旧 job switch 保存、新 session/start/open、activity revision。
- 库项：getPlaybackState。
- mounted/unmount：tracker、marks/beforeunload/pagehide/pageshow、startup replay、loader 取消和 flush/dispose。

## 2. 精确文件范围

产品：修改 E:/read-web-next-optimization/src/components/YouTubeWorkflowPanel.vue 的 script；新增 E:/read-web-next-optimization/src/composables/use-reader-session-persistence.js。template/CSS/App/入口顺序不变。

基础服务保持字节：use-reader-save-coordinator.js、create-reader-marks-hydration.js、reader-playback-tracker.js、reader-session-persistence.js、reader-outbox-storage.js、latest-wins-ledger.js、youtube-workflow-client.js。只能消费它们，不重写语义。

检查可按职责迁移最小修改：scripts/youtube-workflow-panel-v3-check.cjs、workflow-reader-marks-ledger-check.mjs、reader-marks-activity-conflict-check.mjs、marks-store-check.cjs、video-player-module-check.cjs。现有 scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs 可增加 Temp dist/证据保留选项，不删原旅程。inventory 与 PROJECT_MAP 对应条目按共同约定更新。

## 3. 按顺序施工

1. 保存 opening，记录真实调用关系、template/CSS与基础服务哈希；本轮基线包含最新 ABC 成果。
2. 在新 composable 建立同一组 tracker/coordinator/hydration 与私有 unload/replay 状态，沿用同一个 currentJobId ref。加载期读取当前值，不能捕获开工时的布尔副本。
3. 搬迁 ensureCurrentJobFromAudioMeta、marks normalization/visible restore/edit/submit、activity submit、outbox request/trust/conflict/replay/keepalive 与页面事件。同一职责只留一份实现。
4. 接回 loader 与 loadJob：session persistence 对象不换实现；权威 marks 恢复、Pinia/DOM 同步、switch/open 的 job/session/operationId 保持。
5. 用少量真实消费操作接回 UI和面板生命周期，不导出私有 maps/全部 ledger/outbox函数，不引入万能 ctx。
6. 保持顺序：mounted 先 tracker bind→解析 job→replay→事件绑定；unmount 先取消 loader→关闭 flush→移除事件→tracker unbind→hydration clear→coordinator dispose。不用 composable 自动 hooks 隐式改变顺序。
7. 更新源码归属检查的读取目标及真实测试 staging，运行完整必要检查，做 final/patch/交接后停止写入。

## 4. 固定验收 R1-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 单一所有者 | 面板只装配/调用，新文件拥有完整保存接线，未复制状态和业务协议。 |
| A2 marks | restore 不变 edit，迟到恢复不覆盖本地 edit/权威 marks，sourceRevision/localVersion 和 Pinia/DOM/session 保存保持。 |
| A3 activity | progress/annotation/open/switch/close 的 job/session 与加载期抑制保持，切卡不污染新状态。 |
| A4 close/outbox | 同代只关闭一次，先同步 outbox再keepalive；成功按操作身份清除，失败保留，来源不明 marks 不发送。 |
| A5 recovery | conflict/retry、不同/同 job 并发、legacy migration、quarantine、quota fail-closed、bfcache关闭代的原必要旅程全部通过。 |
| A6 lifecycle | 原启动/取消/flush/监听/释放顺序保持；真实组件卸载，不重复提交或遗留监听。 |
| A7 边界与证据 | template/CSS/基础服务字节保持，必要检查完整通过，fresh构建/日志/回滚与自有服务关闭齐备。 |

## 5. 实际验证入口

在优化工作区完整执行：
- npm.cmd run verify:youtube-workflow-panel
- npm.cmd run verify:workflow-reader-ledger
- npm.cmd run verify:reader-session-persistence
- node scripts/reader-marks-activity-conflict-check.mjs
- node scripts/reader-marks-hydration-check.mjs
- node scripts/reader-playback-tracker-check.mjs
- node scripts/marks-store-check.cjs
- node scripts/video-player-module-check.cjs
- node scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs（先完成下述隔离）
- 共同语法/diff/inventory/documentation检查。

recovery 原脚本完整七组 journey 必须运行；默认会构建 repo dist，应先让 build --outDir 与 Host dist 指向同一 Temp，数据/cache也在本轮 Temp，保留失败证据。不得只跑 BFCache contract-only，或以新简化 mock 代替原必要旅程。

另需观察实际组件 mount→marks edit→真实 unmount：DOM退出、关闭保存一代、监听解除；如原脚本已覆盖，引用原断言；否则在现有 fixture 加一个有限场景，不建设第二个长 runner。未知外网阻断，API使用自有测试Host。完整 npm test、用户试用Host、自然播放仍不属于本轮。

## 6. 交接、回滚、停止

逐项写 R1-A1–A7、自检命令/原 exit、迁移表、new module接口、opening/final/template哈希与patch，说明仍依赖面板生命周期。按共同约定回滚；先恢复面板消费再移除无后续消费的新文件。

若必须修改存储格式/基础服务语义、模板CSS或 reader-runtime 入口，先停该扩展重新限定；两次连续失败按 AGENTS 停止。独立 PASS 后才能进入 R2。

