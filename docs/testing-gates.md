# Read-Web 测试分层门

本文记录当前测试入口、证据边界和每个入口的 owner。每个 gate 都会先打印
included/excluded 清单；未执行的层不会被描述为已覆盖。

## 证据层

`npm run verify:test-inventory` 会审计 `package.json` 的直接命令、`npm run` 的
传递调用，以及 `scripts/` 下的可执行 Node 检查。结果写入
`docs/architecture/test-inventory.json`，每条记录都有 `category`、`layers`、
`owner`、`invocation`、canonical `aggregates` 和证据字段。混合检查的静态源码形状
只记录在 `architectureEvidence: ["source-shape"]` 这个证据面；它的 behavior、
browser、performance 或 release 结果不会被整脚本冒充 architecture aggregate。
分类器自测为：

```powershell
npm run verify:architecture:test-inventory
npm run verify:test-inventory:update # 变更脚本/入口后重新生成并审阅
```

分类含义如下：

| 层 | 证据含义 | 不能替代 |
| --- | --- | --- |
| `architecture` | 依赖关系、脚本/文件形状、兼容面存在性和迁移边界 | 真实功能行为、浏览器旅程、性能或发布恢复 |
| `behavior` | 调用公开 interface、DOM seam、真实模块或故障 adapter 后的结果/顺序 | 浏览器网络旅程和性能预算 |
| `browser` | 隔离 Vite/preview 中的页面、交互和故障旅程 | 发布级恢复与长时间性能 |
| `performance` | 性能预算、规模、延迟和资源稳定性 | 功能正确性 |
| `release` | clean-room、秘密/许可证/SBOM、manifest、恢复和回滚证据 | 任何较窄层的单独通过 |

读取源码后只判断 `includes`、`match`、`indexOf`、文件存在性或其他形状的
检查属于 `architecture`。它们不是 behavior 通过证据。`sourceRead` 仅记录
测试为加载真实模块而读取源码的事实，不会把这种读取自动升级为 source-shape。

## Fast gate

运行：

```powershell
npm run verify:fast
```

只查看计划：

```powershell
node scripts/verify-fast.mjs --list
```

Fast 明确执行：

1. `verify:test-inventory` 已提交清单新鲜度、owner 和 orphan 门禁；
2. `verify:architecture:test-inventory` 分类器自测；
3. `verify:architecture:source-shape` canonical source-shape aggregate；
4. `verify:behavior:migrated-interfaces` canonical behavior aggregate；
5. 工具链、事务/backup contract、playback/annotation/vocabulary/workflow
   behavior、Python service dependency inventory，以及固定端口/随机 browser-safe
   端口的 ownership documentation guard。

Fast 明确排除：browser journeys、build、Python integration suite、实时网络/
AI/TTS/词典/YouTube、performance、clean-room、发布秘密扫描和恢复/回滚。
终端会输出层摘要：

```text
architecture=EXECUTED (canonical), behavior=EXECUTED (canonical),
browser=EXCLUDED, performance=EXCLUDED, release=EXCLUDED
```

`verify:architecture:source-shape` 执行清单中有 owner 的 focused guards。
10.5 完成后，`runtime-state-source-check.cjs` 和
`video-player-module-check.cjs` 已恢复到 canonical architecture aggregate，不再有
10.5 临时排除。其他历史
`verify:<feature>` 名称继续作为兼容入口，canonical aggregate 是 fast/full 文档
和门禁使用的唯一聚合入口。

默认 `npm test` 现在执行 `verify:full` 的完整入口图：它覆盖 canonical
architecture、canonical behavior、隔离 browser journeys、build、persistence
fault evidence 和 Python backend suite；不会递归调用 `npm test`。`npm run
verify:vite` 仍是兼容的窄入口，不再代表默认测试覆盖面。

## 迁移 interface 的 behavior 覆盖

`npm run verify:behavior:migrated-interfaces` 直接执行真实模块和注入的公开
依赖，不以 `source.includes` 作为行为断言。关键映射如下：

| public seam | behavior check | 关键契约 |
| --- | --- | --- |
| reader runtime assembly | `reader-runtime-assembly-behavior-check.mjs` | adapter 启动顺序、二次初始化 disposal、反向释放和返回 seam |
| session runtime adapters | `session-runtime-adapters-behavior-check.mjs` | annotation 在 lifecycle 之前启动，依赖/DOM/global owner 正确注入 |
| retired compatibility | `retired-compatibility-behavior-check.mjs` | `session-facades` 的现存公开 delegation 可调用，退役 notes API 不再出现在新 window seam |
| ApplicationPersistence | `application-persistence-check.mjs` | 公开 persistence contract 和校验/提交行为 |
| ReaderSession / publisher | `reader-session-publisher-check.mjs` | capture/publish/restore 的 public session seam |
| workflow client/loader | `youtube-workflow-client-check.cjs`, `youtube-workflow-loader-check.cjs` | request/result/error contract |

旧的 focused behavior checks 保留在原路径；canonical aggregate 只是把已有价值
检查和新增迁移 interface 检查集中起来，不以一个统一 drain 脚本替换它们。

## Full gate

运行：

```powershell
npm run verify:full
```

只查看计划：

```powershell
node scripts/verify-full.mjs --list
```

Full 首先执行 `verify:fast`，因此会重复并明确执行 canonical architecture 和
behavior 两层；随后增加 persistence fault matrix、production build、固定隔离的
`4193` development browser journeys、`4194` production preview load、独立
production host/browser journeys、reader-session/compatibility browser fault
journeys、compatibility consumer-map deterministic capture 和 Python backend
unittest suite。除固定 Vite owner 外，自拥有 browser journeys 使用随机
browser-safe 端口；所有 browser 端口都排除 `5173/8765`。不得把 architecture
source-shape 通过写成 browser/full 行为通过。

Full 不启动真实 Material Workflow service，也不包含实时外部 API。长时间性能
和发布恢复属于 release gate。

## Release gate（当前明确阻断）

`npm run verify:release` 不是 `verify:full` 的别名。它保持独立的
performance、clean-room、release manifest、backup/restore 和 rollback stages；
`verify-full` 的 behavior/browser 结果只是其中一个 stage，architecture green
绝不能替代 behavior、performance 或 recovery evidence。

12.8 已在用户于 2026-08-17 明确确认后完成；`--list` 现在列出完整 stage 并报告
READY，默认执行完整 release gate。`verify:backup-restore-rehearsal`
的产物只是 isolated application-state foundation，不证明真实
IndexedDB/localStorage/workflow profile 的全应用恢复。12.2 的真实六域组合通过
跨进程 application-profile lease 在完整 owner commit 和 Local App Host 生命周期
内隔离读写，`atomicRevisionCommit` 为 true；atomic boundary gate 覆盖第一域后
并发 startup 阻断、硬退出、pending recovery 和 journal 终态。
`verify:workflow-application-backup-restore` 仍验证 Python owner 契约；这些检查只
使用隔离临时 profile，也不触碰真实学习数据。12.3 已通过显式人工授权的
`verify:real-profile-rehearsal` 完成：该入口只读真实 browser/workflow 源，将复制、
恢复、重开和报告全部写入显式隔离临时根，阻断所有网络请求，并要求六域
counts/checksums 及 Reader/Vocabulary/SRS/Preview/Annotation/workflow journeys 一致。
它必须显式提供 browser profile、origin、workflow data root、isolated root 和每个
额外 output root；不会被普通 `verify:full` 或无参数 release 自动调用。12.7 仍未完成。

12.4 由 `npm run verify:release-stability` 执行，并已接入 release stage。它在
built `dist` 的隔离 production host 上执行三次冷启/重启与真实 wall-clock 30 分钟
播放，持续 A/B 切换并采集 timeupdate、Long Task、JS heap、listener、Object URL
和浏览器错误；随后重跑 36 格 Quota/损坏/恢复矩阵、真实受控子进程取消及 50-job
取消后重启。默认报告根使用系统临时目录；该入口拒绝日用/next 保留端口并阻断外网。

12.5 由 `npm run verify:release-differential` 执行，并已接入 release stage。它用同一
fixture 分别构建旧版和 Next，在隔离临时目录与随机安全端口各跑三轮浏览器 journeys，
校验学习流程行为无退化，并按 `config/release-differential-budgets.json` 比较十项时延。
当前证据为两版各 21/21 journeys、零浏览器/网络错误、六项改善，总体比率 1.055；
旧版源目录只读，运行前后 git 状态必须完全一致。

12.6 的 `npm run release:manifest` 只接受 clean release candidate，生成 current、
previous 两份 manifest 和 staged release-state；manifest 包含 Git/版本/工具链/lock、
配置与数据兼容范围及逐 artifact SHA-256。`npm run release:health` 验证文件哈希并可
核对运行中 host identity；`npm run release:rollback` 在 previous 完整性通过后原子
切回 previous target。快捷方式和进程切换由 12.7 隔离演练消费，不在本阶段触碰日用版。

12.7 由 `npm run verify:release-shortcut-rollback` 执行。它只读并哈希当前桌面学习
快捷方式，将副本放到系统临时目录，再对副本执行原子 Next 切换、正常 rollback 和
模拟 health failure 自动 rollback；最后要求桌面源快捷方式哈希完全不变。底层迁移
入口默认拒绝 Desktop 写入，实际迁移必须额外提供显式确认参数并受 12.8 用户确认约束。

桌面 `英语学习.lnk` 当前指向 `E:\read-web-next\scripts\launch-next-preview.ps1`，
工作目录为 `E:\read-web-next`。原始目标保存在 ignored release state 中；需要恢复时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-shortcut-migration.ps1 -Action Rollback -ShortcutPath "$env:USERPROFILE\Desktop\英语学习.lnk" -StatePath output\release\desktop-shortcut-migration.json -AllowDesktopMutation
```

## 入口和 owner 规则

- 新的 architecture aggregate 必须使用 `verify:architecture:*`；新的 behavior
  aggregate/单项必须使用 `verify:behavior:*` 或在更具体的层级下命名。
- 现有短入口不机械重命名，以免破坏外部调用；它们是 compatibility aliases，
  文档、fast、full 只引用 canonical aggregate。
- 每个 package 直接命名的脚本由 `package.json#scripts.<name>` 负责；不被
  package 直接/传递调用的脚本必须显式归入
  `docs/architecture/script-inventory.json` 的 `releaseGate` 或 `devTool`。
- 入口/脚本改动后必须运行 `npm run verify:test-inventory` 和
  `npm run verify:script-inventory`，确认分类是 deterministic、owner 存在且无
  orphan。

12.2 已覆盖真实六域 adapters、durable checkpoints、rollback/quarantine、
冲突安全恢复、跨 owner 原子可见性、Local App Host 启动前强制 recovery seam
和运行期 profile lease。12.3 的真实只读源/隔离恢复证据及 12.4 的长时稳定性证据均已完成；其余 pending gates
完成前，任何 Full/基础 rehearsal 通过都不代表可以切换桌面快捷方式或接触真实
学习数据。

## 已知基线问题

Windows 下 `test_cancel_marks_running_job_canceled` 偶尔会在
`TemporaryDirectory` 清理期间遇到后台线程仍写入 `.workflow_state`，报
`WinError 145`。Full gate 保留该失败，不自动 retry 或忽略；应在 workflow
lifecycle 阶段修复线程终止与测试清理后再将其标记为稳定。
