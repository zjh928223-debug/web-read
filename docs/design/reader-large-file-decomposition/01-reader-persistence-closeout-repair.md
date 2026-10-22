# R1 限定收尾修复方案

日期：2026-10-03。执行对话：第6项 · 前端一线（`01a1017d-1624-7fc0-a1d8-e1cc567c4b36`）。用户已在父对话明确授权“给出修复方案让R1去收尾”。本方案只授权下述两项补修，完成后停止写入，交接 WAIT_REVIEW；不授权 R2。

必读：[R1 原方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/01-reader-persistence.md)、[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)、[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-r1-independent-review-20261003-3e8c971a/review.md)。原 R1-A1–A6 已独立通过，A7 尚未通过，原始失败记录保持。

## 1. 精确范围与结果

只允许修改两个项目文件：

1. `E:/read-web-next-optimization/scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs`：在 `startBackend` 的 Python child `env` 内明确覆盖默认 app 数据根。
2. `E:/read-web-next-optimization/docs/architecture/test-inventory.json`：仅补齐 SRS media lifecycle 检查的一条来源元数据。

产品代码、模板/CSS、基础保存服务、service.py、runtime.optimization.json、package.json 和其它清单/架构文件保持原字节。两项补修不改变 marks/activity、HTTP、storage、revision、operationId 或面板生命周期。父对话编写的本方案/调度说明属于外部文档变更，不算执行者增量，也不得覆盖。

目标：正式 recovery runner 自身将默认 Python app 与显式测试 manager 都限制在独有 Temp；正式 test-inventory 通过；原七组恢复旅程和真实卸载场景保持完整通过。

## 2. 开工与身份核对

1. 在 `C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/` 下创建新的唯一补修证据目录，建议 `R1-closeout-repair-<唯一后缀>`。保留原 `R1/` 及父审查目录原字节，不复用旧 dist/数据/日志。
2. 保存本次两个责任文件的 opening 原字节/SHA256/bytes、当前 git status/HEAD、精确 opening→current diff。不得 restore HEAD/reset/clean。
3. 核对原执行 `R1/final-manifest.json` 与父审 `identity-audit.json`：R1 产品、新 composable、基础服务、受保护模板/CSS和未改检查应无漂移。原 runner 与 inventory 在修改前分别匹配原 final/opening 身份。若有未经说明的漂移，先停止写入并报告，不能整文件覆盖。
4. 保留全部旧 FAIL/NOT_RUN/NOT_VERIFIED；不读取或回滚真实业务数据、不删除优化数据目录中已经留下的 service initialized 日志。

## 3. 按顺序修复

### 3.1 默认 Python app 数据隔离

在正式 runner 的 `startBackend(port, tempRoot)` 中，Python `spawn` 的 `env` 对象内、`...gateEnvironment(selectedPython)` 之后增加：

```js
READ_WEB_SUBTITLE_DATA_ROOT: path.join(tempRoot, 'bootstrap-data'),
```

保留已有 PYTHONPYCACHEPREFIX、READ_WEB_TEST_DIST/PORT/ROOT/TOKEN 及配置 Python 选择逻辑。该覆盖必须在子进程启动、任何 Python 导入之前生效，并覆盖可能继承的父环境值。

原因：导入 service.py 会执行默认 `app = create_app()`；此实例早于显式 FakeWorkflow manager 创建。仅给显式 manager 设置 output/state 无法隔离默认实例。无需修改后端入口、全局运行配置或删除默认 app。

禁止以父 shell 的数据根覆写作为修复。正式 runner 应独立保证这条边界，不能删原七组旅程/卸载断言、开启 contract-only 或 stub 新保存模块。

### 3.2 同步一项测试清单

找到 `tests` 中 `path === "scripts/srs-review-media-lifecycle-browser-check.mjs"` 的条目，将其 `evidence.sourceShape` 改为：

```json
[
  "asserts-file-shape",
  "asserts-source-text"
]
```

其它字段和条目保持；不要以数组索引209作为永久定位依据。该差异是 opening 已有的元数据遗漏，不是本轮新增产品回归。

可对照父审 `test-inventory-current-candidate.json`，先确认候选与当前仅上述字段不同；直接应用最小 hunk。没有必要运行全仓清单重生成或整份覆盖；生成候选不代替最终正式 check。

## 4. 完整必要检查与隔离证明

所有命令记录 stdout/stderr/exit/开始结束时间，独有 Temp 保留 fresh dist、数据、staging、pycache 与浏览器原始证据。沿用既有 runner 的 `READ_WEB_RECOVERY_ROOT/DIST/ARTIFACTS/KEEP_TEMP` 选项；原 npm/build 参数、配置 Python和自有随机 loopback Host保持。默认完整 runner 是正式验证入口。

依次执行：

```text
node --check scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs
npm.cmd run verify:test-inventory
npm.cmd run verify:script-inventory
npm.cmd run verify:current-documentation
git diff --check
node scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs
```

最后一项必须完整运行 conflict/retry、不同/同job并发、close/outbox/auth、BFCache关闭代、legacy migration、quarantine、quota fail-closed 七组原旅程，以及真实组件卸载。runner 自带 fresh Temp 生产构建，不能引用父审或原执行旧产物替代。

**数据隔离检查方式**：完整运行前，仅在本次命令子环境中将 `READ_WEB_SUBTITLE_DATA_ROOT` 设为本次证据目录下另一个未使用的 `parent-sentinel-data` 路径。该值用于验证正式 runner 能覆盖继承值，也保证回归时不会碰真实数据。不得修改用户/系统环境变量。父值不作为正确数据根；正确路径由 runner 根据它自己的 tempRoot 创建 `bootstrap-data`。

运行后检查：

- 默认 app 的 `service initialized` 日志出现在 `<runner tempRoot>/bootstrap-data/.workflow_state/logs/service.log`；保存该精确路径与初始化行。
- `parent-sentinel-data` 没有初始化日志或其它默认 app 产物。若出现在 sentinel，隔离验收 FAIL，不能用“反正也是 Temp”改成 PASS。
- 显式 FakeWorkflow manager 的 output/state 仍在 runner 自己的 tempRoot 内，API与静态均使用本次同一 fresh dist/自有 Host。
- 保存 pageerror、console、requestfailed、截图与各 journey 结果；故意 abort/401/409/quota 等原错误照实记录，不要求伪造零错误。
- 实际 Vue app.unmount 的 DOM退出、四项窗口监听解除、五项tracker监听减少、单代close/outbox及卸载后不再写入保持；不扩大要求其它合法媒体监听全部为0。
- 记录自建Host PID/端口及退出后进程不存在、端口不监听，browser已关闭。服务清理只处理自己创建的进程，不碰5184/8776或未知进程。

真实 BFCache persisted=true 仍可保留 NOT_VERIFIED；沿用原 runner synthetic fallback 与父审既有范围，不为补修新增浏览器兼容性工程。原生产 CSS 与当前源码未变化则继承父审字节对照；fresh CSS若出现差异应报告原因，不能顺带换肤。

## 5. 固定补修验收

| 编号 | 必须达到 |
| --- | --- |
| R1-F1 | 正式 runner child env 在Python导入前覆盖数据根；默认app日志在bootstrap-data，sentinel未被使用；所有测试数据在独有Temp。 |
| R1-F2 | 清单仅SRS条目补入asserts-source-text；最终正式verify:test-inventory exit0，旧FAIL原样保留。 |
| R1-F3 | runner语法、script-inventory、current-documentation、diff均通过；完整recovery原七旅程+真实unmount与fresh构建通过。 |
| R1-F4 | 两文件精确diff、opening/final身份、原R1产品/基础服务/模板CSS无漂移，日志/服务退出/回滚齐备。 |

八项保存 focused 可继承父审 PASS，前提是其实现/检查脚本与父审哈希无漂移；没有产品变化时不重复全量。若有必要的新变化或失败，只追加对应相关检查。完整 npm test/verify:full、verify:vite、verify:production-preview alias、自然播放、用户试用Host、真实用户数据旅程继续 NOT_RUN。

## 6. 交接、回滚、停止

1. 写新 `repair-handoff.md`：R1-F1–F4逐项自检、两文件增量、数据根证明、完整命令/原exit、fresh产物/截图、服务清理、旧失败引用、全部NOT_RUN/NOT_VERIFIED、opening/final/patch及回滚。
2. 可更新前端一线顶层 `handoff.md` 的摘要，明确“限定补修执行结束，WAIT_REVIEW，R1仍未独立整轮PASS，R2未施工”，链接新交接及父审报告。原 `R1/handoff.md` 和旧原始日志保留原字节，避免覆盖历史FAIL。
3. 回滚先核对两文件 current 等于本次final；无漂移只逆向本次两项hunks，不逆向整轮R1产品迁移，不删除bootstrap或真实数据，不restore HEAD。后续有写入时重新限定hunks。
4. 自检通过后停止写入，等待父对话按R1-F1–F4独立复审并关闭A7。不得自宣R1独立PASS，不自动施工R2/R3/R5，不新建对话/代理/自动化，不跨对话发送消息。
5. 用户此次授权一次限定补修，不取消AGENTS连续两次修复/复审失败停止规则。同任务再次复审失败达到阈值时停止，由用户重新决定；不能静默第三轮。支持脚本保持有限，优先复用原runner，禁止新增第二套长业务测试实现。

估计：补修与完整自检约20–45分钟，独立复审另计；失败排查/环境等待不保证墙钟时间。
