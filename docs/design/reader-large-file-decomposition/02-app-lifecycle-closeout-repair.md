# R2：限定补测与收尾方案

日期：2026-10-03。状态：待用户决定继续；本文仅规划，不恢复施工或改变现行验收标准。

执行对话为“第6项 · 前端一线”。原方案：[R2 应用保存生命周期](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/02-app-lifecycle.md)。当前交接：[R2 检查点](C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/R2-20261003-b762f234/handoff.md)。R1 已独立整轮 PASS，不重做 R1 补修。

## 1. 当前判断与未完成项

R2 已完成 App 唯一保存范围、Panel 注入和加载取消登记的施工，执行侧 11 项 focused、session-load-browser、第二次原七组恢复旅程、原根卸载及当前生产阅读交互通过；新增生命周期整组仍 FAIL，不能视为 R2 独立 PASS。

两次浏览器失败分别为 close-outbox-replay-auth 的收据残留，以及新增根取消→flush→stop 断言。第一项后续原旅程已通过，旧失败保持。第二项没有写出断言后的完整 panel-lifecycle.json，需要补充原 trace 才能下结论。test-inventory 另有 recovery runner 的 evidence.sourceRead 从 false→true 漂移。

源码显示新增场景在 dispatchPageHide(page, false) 后继续同一页面的 Panel 重挂和素材切换，未恢复关闭世代。产品 handleReaderPageShow 只在 persisted=true 时恢复关闭世代；这支持夹具事件序列有问题的判断，但尚不足以证明它是唯一原因。不得为了通过测试修改产品关闭锁、在切换 job 时任意重置它、删除顺序断言或把非持久离开与持久返回强行配对。

## 2. 此次继续的边界

用户选择继续后，只允许先做下列两文件的限定改动：

- scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs：修正新增场景的生命周期序列，提前留存原 trace，沿用现有 runner、真实 App/Panel/loader 和保存模块。
- docs/architecture/test-inventory.json：按 recovery runner 的 path 定位，仅同步确实变化的 evidence.sourceRead；保留 R1 的 SRS 元数据修复，不重生成整份清单。

当前产品文件、生命周期 Vue 夹具、loader、基础保存服务、模板/CSS、HTTP、schema/key/revision/operationId、配置、package、薄入口均冻结。若补证显示真实产品问题，此次测试收尾授权不覆盖额外产品修改：停止，报告具体 R2-A3/A4 故障及最小产品修复范围，再定界。不得因测试中途失败扩充用例体系、增加第三方依赖或新增业务模拟实现。

只在实际必要检查全部通过后，允许更新原 R2 方案范围内的 README/PROJECT_MAP/CURRENT_PROJECT_STATUS，写入已经实现的生命周期归属；交接和证据写入新的独有 Temp。这些说明不能代替产品验收，也不写“独立 PASS”。父对话拥有的方案、dispatch 和后续功能安排不由执行者覆盖。

## 3. 实施顺序

1. 保存当前 R2 checkpoint 为补测 opening：两个授权文件原字节、SHA256、git status/HEAD；核对 App/Panel/composable/context/夹具与 checkpoint 身份。保留现有 R1、两份独立审核及 R2 两轮失败原字节。外部功能规划文档不算本线增量，不得覆盖。
2. 修正生命周期序列。优先将同页继续场景明确建模为 synthetic pagehide(persisted=true)→pageshow(persisted=true)，在返回后再进行 Panel 重挂/切换/根卸载，并保留请求、session/open 计数及世代记录。两端必须配对，不能只补一个 pageshow(true)。这是合成恢复合同测试，不证明真实 BFCache。
3. 保留原七组恢复及原组件卸载中的非持久关闭覆盖，不因第2步修改这些原旅程。如果新增 Panel 场景必须单独证明非持久关闭，则将它作为该页面的终点，并在新页面/上下文启动根取消场景；不要在非持久关闭后继续旧页面。避免不必要的新上下文或测试复制。
4. 在根顺序断言前写出观察到的 shutdown、traceStart、cancel/close/stop 索引、counts、job/session、请求及错误。失败时也保留已有观察；使用小范围 try/finally 或现有证据助手，不通过捕获异常把失败改成成功。路由 hold 在 finally 释放，自有 context/Host 正常关闭。
5. 同步唯一清单字段，核对结构 diff 只有本项 sourceRead；runner 语法检查通过后再启动一次 fresh 完整受影响回归。
6. 回归通过后核对产品冻结、模板及生产 CSS、既有检查/历史身份；必要项齐全后补本轮事实文档、closing/patch/回滚和逐项状态。交接 WAIT_REVIEW，停止写入。

现 runner 约1450行，来自约1213行的已审 R1 基线。本次继续只修上述序列、证据保存和元数据；优先复用现有 helper，新增代码保持小增量，不新增支持脚本或第二套业务实现。这是对已超过500行支持脚本的收窄说明，不授予继续扩展测试平台的权限。

## 4. 必要检查与隔离

记录每个实际命令的 stdout/stderr/exit、时间和调用参数。沿用优化配置选择的 Python，独有 Temp build/data/staging/pycache、随机 loopback 服务；不启停用户5184/8776或日常服务，不使用真实材料数据。

依次执行：

1. node --check scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs
2. npm.cmd run verify:test-inventory
3. npm.cmd run verify:script-inventory
4. npm.cmd run verify:current-documentation
5. git diff --check
6. node scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs

第6项在仅本次命令子环境启用 READ_WEB_RECOVERY_INTERACTIONS=1、READ_WEB_RECOVERY_LIFECYCLE=1、READ_WEB_RECOVERY_KEEP_TEMP=1；READ_WEB_RECOVERY_ROOT/DIST/ARTIFACTS 指向本次新 Temp，绝不复用两轮失败产物。以 parent-sentinel-data 子环境值复核 runner 自行覆盖 READ_WEB_SUBTITLE_DATA_ROOT 的 R1 隔离边界，两个 Host 默认 app 的 bootstrap-data 与显式 manager 均记录。

完整 runner 必须包含原七组恢复、真实根卸载、当前生产阅读交互及新增 Panel/根取消全场景，不能 contract-only、过滤失败旅程或关闭 lifecycle 开关交付。原交互脚本仍用同一 fresh 构建的真实模块，保留实际媒体/API边界。

11项 focused 与 session-load-browser 可在实现/检查/依赖哈希无漂移时继承本次 R2 原始执行结果，明确注明“继承，未重跑”；有相关变化则补对应检查，不无理由重复全仓。文档更新后重做受影响的文档门禁、diff、closing 身份记录。完整 npm test/verify:full、正式 verify:vite/production-preview alias、真实用户数据/设备仍照实际 NOT_RUN/NOT_VERIFIED，不改历史状态。

## 5. 限定收尾验收与独立复审

下列仅是对 R2 既定 A1–A6 的缺口收尾映射，不新增产品规范：

| 项目 | 通过条件 | 原标准 |
| --- | --- | --- |
| C1 夹具序列与证据 | 合成 hide/show合同一致；原关闭覆盖保留；成功或失败均有实际 trace；不靠产品状态强制重置求PASS。 | A2/A3/A5 |
| C2 完整生命周期 | Panel离开后的marks/progress/close、同实例重挂、取消/失败loading解除、根cancel→flush→stop及迟到回调检查全到达并通过；相关错误如实分类。 | A1–A4/A6 |
| C3 既有行为与门禁 | fresh完整原七旅程、原根卸载、生产交互及清单/语法/diff/文档必要项通过；focused继承身份成立。 | A4–A6 |
| C4 身份、隔离、回滚 | 产品及模板/CSS冻结、两文件精确diff、旧失败保存、Host退出、opening/closing/patch/最小回滚齐备。 | 原R2共同约定 |

执行自检通过后交 WAIT_REVIEW，由父对话独立检查两文件增量、原始失败/新trace、固定R2-A1–A6与必要回归，才决定R2整轮是否PASS。R1 PASS不替代R2 PASS。其他线不因自检通过自动开工。

## 6. 停止、放行与后续

AGENTS.md 的规则为：同任务连续两次修复/复审失败后停止自动迭代，由用户决定。本次文档不视为用户已经选择继续，不向前端一线发送施工消息。

若用户授权此限定继续，执行一次完整 fresh 验证；再次出现失败或真实产品故障即保留证据、停止并报告，不自动追加下一次修复循环。不要用多次重复执行获得一个成功结果来收口。

回滚仅在核对 closing 后反向此次 runner 与元数据 hunks，保留R2原产品施工、R1正确closing与旧dirty；不回滚到HEAD，不删除测试数据或历史证据。

R2独立PASS后，再依据已有功能保留决定安排R3/R4及R7等下一轮；各线仍需明确调度。原R5与“删除本文扫描”需求重叠，放行前重新定界。新功能需求仍不加入此次补测。

估计：限定补测及交接约20–45分钟净工作量，独立复审另计；环境和失败定位可能增加时间。
