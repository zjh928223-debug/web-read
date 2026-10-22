# 第 6 项分轮施工：共同执行与验收约定

日期：2026-10-03。状态：规划完成，产品施工未开始。本文件与各轮方案一起交给执行者；各轮验收标准在施工前固定，不能在复审时扩成新的无限任务。

## 1. 目标、编号与功能门槛

第 6 项是“按保留职责整理大文件”。ABC 已完成的是父对话六项清单中的第 1–4 项，不是本目录这些轮次。第 5 项功能撤除由用户规划、另行执行，本目录不授权顺带撤功能。

计划为 **8 轮施工 + 第 9 轮合并验收**。轮次按职责划分，不按行数分割，不要求所有文件低于某个行数。现有职责明确的 backup、migration、durable owner、词汇事务/事件及已拆 focused 模块不因为较长就再次拆分。核心阅读、标记和会话保存按保留处理；用户若决定撤掉核心保存，R2 开工前须重定边界。

R1、R2 可先做；R2 必须等 R1 独立 PASS。R3–R8 开工前将其涉及功能逐项与第 5 项清单对照：确认保留才拆；准备撤除但尚未撤的功能先等第 5 项相应撤除完成，不在本轮帮它重建新模块；已经撤除的职责记录“因功能退休取消该子范围”，不能写成测试 PASS。混合保留/撤除时，只按已保留的独立职责重新列清单；若改变本轮核心目标，先改施工方案，后施工。

允许实施者根据真实调用者调整新模块内部函数命名。各轮给出的新文件路径是施工目标，不是当前存在事实。不得把“接口设计尚可微调”当作任意新增文件、功能、第三方依赖或基础架构的授权。

## 2. 工作区、数据与运行隔离

- 唯一写入目标：E:/read-web-next-optimization。无 worktree，无提交、promotion、快捷方式改动或日常/历史树操作。
- 保存 opening 使用当前已汇合 ABC 的原字节，保留 WhisperX/语言处理及所有既有 dirty；不能以 HEAD/reset/restore/clean 回滚。
- SeekPlayerDB v1 / files / id 不变。storage key、Host profile/domain、revision、operationId、缓存格式、schema、迁移/回滚契约均不改。
- reader-runtime.js、session-init.js、index.html 脚本顺序不加功能、不重排；不恢复 src/stores 或退休 window 发布。
- 不启停或替换用户的 5184/8776 试用服务。不接管 5174/8766 或任何未知端口/进程。受控测试可用自己创建的随机 loopback 服务和独有 Temp 数据/产物。
- 手工优化预览若以后另获启动授权，使用 config/runtime.optimization.json 和 scripts/launch-optimization-preview.ps1；测试 Host 不能冒称为用户的试用 Host。
- Node staging/build/outDir/cache/artifacts 和 Python data/config/cache/pycache 使用本轮独有 Temp。Python通过现有 run-python-command.mjs 选择配置环境，不裸用系统 Python、不改依赖。
- JS 检查的 staging 如默认在仓库 node_modules 下，可最小配置或使用只改变临时目录的 preload；保留实际命令与隔离说明，完整原断言必须执行。浏览器 fresh 非持久上下文，Service Worker block；合成夹具未知外网/WebSocket 阻断，自己的 Host 静态/API明确放行。

## 3. 每轮统一步骤

1. 读当前 AGENTS、README、PROJECT_MAP、本轮方案、共同约定及前轮 closing/独立结论。核对本轮功能保留条件；不自动启动新对话/代理。
2. 保存本轮责任文件 opening 原字节、SHA256/bytes、git status/HEAD 与精确 diff，写独有 Temp。保存受保护模板/CSS/基础服务及上一轮收口文件身份。R1 开工时另保存当前已汇合 ABC 的总基线与 fresh Temp 生产构建，供 R9 保留入口对照；不得用 HEAD 或用户旧试用快照冒充。候选定位用当前函数/调用者，文档历史行号只是导航。
3. 列出迁移职责的所有产品调用者、动态 DOM/Teleport、生命周期、测试 staging 和 Tailwind source 消费者；记录“旧函数→新所有者→调用者”的迁移表。
4. 从一个完整职责开始机械搬迁，接回真实消费者，再删除原实现。状态、锁、计时器、缓存、异步代号在一个所有者中；不能复制状态、构造巨大万能 ctx、到处做透传 wrapper 或把私有操作通通公开。
5. 同步来源检查：实现断言读真正的新实现，组件装配断言读组件；不拼接源码假装旧文件仍实现所有行为，不删/弱化现行行为断言。测试 staging 加载新真实依赖，不把新模块 stub 掉以求通过。
6. 执行本轮必要完整检查和真实入口旅程；查看相关 page/console/请求错误及截图。每个命令保存 stdout/stderr/exit；失败和未运行原样保留。修复影响哪些检查只补那些，不靠重复全量提高可信度。
7. 更新对应 inventory 和真实架构说明，只写本轮已实现事实。生成 final 身份、opening→final patch、消费者表、逐项验收、回滚说明与未覆盖项。
8. “执行自检完成，待独立复审”后停止写入。独立读审按本轮已定标准或具体 P0–P2 产品/数据/回滚故障判断；只有必要项通过才给该轮独立 PASS。上一轮 PASS 后才开始依赖轮。

## 4. 每轮共同必要检查

每轮执行 git diff --check、修改 JS/检查脚本的语法、对应正式 focused 入口及本轮列出的必要浏览器/HTTP旅程。新增模块的 Vue/ESM 解析以 fresh Vite 构建或真实 staging 为准，node --check 不能单独证明 Vue 依赖有效。

涉及结构/清单时运行：
- npm.cmd run verify:test-inventory
- npm.cmd run verify:script-inventory
- npm.cmd run verify:current-documentation

只更新本轮对应清单记录。若 checker 原因要求重生成，先保存 before，检查生成 diff 没有混入无关变化。没有新增正式检查时不为了本轮重写 package.json；确需新增检查，在施工前列明一个真实行为缺口，注册入口和 inventory，单项支持脚本保持有限。

每轮完整 npm test/verify:full 默认为 NOT_RUN；共同约定不强制每轮全仓重跑。正式 verify:vite/production-preview/wrapper 若默认端口、dist 或在线服务不满足隔离，不裸跑再解释；安全调整或精确记录实际底层命令，不冒称未执行的 alias PASS。

## 5. Tailwind / shadcn-vue 与外观保持

当前 src/styles/workflow-ui.css 使用 source(none) 和显式 @source。动态 UI 字符串搬出已扫描文件时，只允许补准确的新 @source 路径，不改主题、variant、选择器、声明或优先级。新 SRS 文件若仍在 ../features/srs-review 目录内，已有目录 source 覆盖；不能重复增加无效来源。R5/R6 的新动态 DOM 文件须单独覆盖。

CSS源文件只准出现该轮明确允许的 @source 增量；没有该例外的轮次 template/CSS 字节不变。搬 UI 后使用 before/after Temp **生产构建**，相同真实入口与合成数据、相同视口/主题/状态，观察生成 utilities 和 computed style、可达操作、自然换行与 focus；截图不能单独替代几何/交互。目标是保持已有布局与皮肤，不增加一轮换肤。

## 6. 证据、回滚与停止

证据验证器限于结构、路径、字节哈希、显式状态；不得从 arbitrary log text “证明”真实重启、网络、用户旅程。浏览器/真实 HTTP 是否发生由原始测试和独立审核解释。合成媒体调用不证明扬声器发声，手工 pagehide/pageshow 不证明真实 bfcache，生产 fixture 不证明真实用户数据。

每轮交接至少包含：基线与代码身份、文件增量、职责/调用者、完整命令结果与原日志、旅程/截图及范围、服务清理、原失败/未覆盖、按 opening 回滚的方法。R9 对已验收并无漂移范围继承，不把 FAIL/NOT_RUN/NOT_VERIFIED 改字当补测。

回滚先验证 current hash 等于该轮 closing；有后续写入只反向本轮 hunks。只删除该轮创建且无后续消费的新文件，先核对绝对路径在优化工作区内；不递归清仓、不覆盖原 dirty，不对数据做回滚。

遵守 AGENTS：同任务连续两次修复/复审失败停止自动迭代，由用户决定继续/拆分/简化；支持脚本超过约 500 行或两倍审过基线需说明并收窄，不能造第二套业务实现。产品模块没有统一“500行上限”，但迁出仍是多职责大包时必须重审设计而不是庆祝行数下降。

## 7. 工期与写入协调

估时按当前代码、完整自检的净工作量给出，失败排查/环境等待及独立复审另计，不保证墙钟时间。九轮全部保留时施工及合并自检约 13.5–24 小时，独立复审合计另约 4–8 小时；被第 5 项取消的范围可减少。

R1→R2 串行；R3、R4、R5、R6 可在各自功能保留且 R2 PASS 后做独立准备。实际并行施工必须另行明确调度和文件写入归属，尤其共享 workflow-ui.css、package/inventories/docs，由单个写入者串行合并。R7→R8 串行，两者同改 service.py。R9 最后执行。本方案本身不创建新对话。

