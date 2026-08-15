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
仍待 10.5 生产迁移的 `runtime-state-source-check.cjs` 和
`video-player-module-check.cjs` 会列在 architecture 的 excluded 清单中，并在
迁移完成后恢复；聚合会探测这两个预期失败，若检查转绿或失败原因漂移则要求
立即删除排除项。它们不能被当作行为或发布证据。其他历史
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

当前 release 会先列出并阻断未完成的 12.2、12.3、12.4、12.5、12.6、12.7、12.8；`--list` 只查看清单并
成功退出，默认执行以非零退出表示不可发布。`verify:backup-restore-rehearsal`
的产物只是 isolated application-state foundation，不证明真实
IndexedDB/localStorage/workflow profile 的全应用恢复。真实六域组合的
`atomicRevisionCommit` 保持为 false，`verify:application-backup-real-restore`
只证明它在写入前 fail closed；`verify:application-backup-restore-faults` 的
顺序/故障证据使用隔离的 file-backed foundation target，不能冒充跨 owner
原子可见性。`verify:workflow-application-backup-restore` 仍验证 Python owner
契约；这些检查只使用隔离临时 profile，不证明尚未完成的 12.2/12.3/12.7，
也不触碰真实学习数据。

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

12.2 仍保持未勾选：当前证据覆盖真实六域 adapters、durable checkpoints、
rollback/quarantine、冲突安全恢复和 fault evidence，但跨 owner 原子可见性及
真实应用启动路径的强制 recovery seam 仍未完成。12.3 和其余 pending gates
完成前，任何 Full/基础 rehearsal 通过都不代表可以切换桌面快捷方式或接触真实
学习数据。

## 已知基线问题

Windows 下 `test_cancel_marks_running_job_canceled` 偶尔会在
`TemporaryDirectory` 清理期间遇到后台线程仍写入 `.workflow_state`，报
`WinError 145`。Full gate 保留该失败，不自动 retry 或忽略；应在 workflow
lifecycle 阶段修复线程终止与测试清理后再将其标记为稳定。
