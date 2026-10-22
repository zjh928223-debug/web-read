# Tailwind CSS v4 + shadcn-vue 迁移后的本轮收口方案

日期：2026-10-03（Asia/Shanghai）。状态：**方案已编写，尚未实施**。

本轮目标：修复已确认的预习设置弹窗键盘缺陷，统一冲突的样式归属，消除本轮指定范围的开发版/生产版样式差异，并清理两类已知迁移残留。完成条件以交互和样式结果为准，不以文件变短、CSS 数量下降或完全消除手写 CSS 为准。

**大文件拆分不在本轮范围，也不是本轮收口的前置条件。** YouTubeWorkflowPanel、vocabulary-preview、annotation、SrsReview 等文件的职责拆分，另列后续维护；不借本轮继续调整状态架构或 Vue/legacy 兼容边界。

此前 [F1–F6 最终施工交接](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-final-pass-handoff.md)的状态仍为“执行侧完成，等待独立只读终审”。本轮是审计发现后的新增局部修复，不覆盖此前交接，不把此前的执行自查改写为独立审核通过。

## 一、工作范围与顺序

| 顺序 | 工作项 | 要解决的问题 | 结束条件 |
| --- | --- | --- | --- |
| R1 | 预习设置弹窗键盘修复 | 打开后焦点仍在底层，Tab 可进入底层控件，Escape 无法关闭 | 初始焦点、双向 Tab、Escape、关闭后焦点恢复和保存中行为正确 |
| R2 | 指定 CSS 冲突收口 | 相同选择器散落覆盖；workflow 同一组颜色变量有两个来源 | 指定规则的最终来源清楚，三处 workflow 根使用现有 neutral 映射，布局与状态保持 |
| R3 | 开发版/生产版一致性 | CSS 加载顺序导致变量胜出不同；部分模糊效果在生产产物中失效 | 同状态下目标颜色、布局、滤镜的浏览器计算结果一致，并记录构建原因 |
| R4 | 少量迁移残留清理 | 已退役 chunk-note 变量；仅测试页消费的样式随产品加载 | 删除无消费变量，将确认仅用于 fixture 的样式限定在 fixture 内，现有测试功能保持 |

执行顺序为开场基线 → R1 → R2 → R3 → R4 → 最终回归。每项只做相关检查；全部完成后统一构建和浏览器验收，不为每一个 CSS 删除动作重复跑全仓库验证。

## 二、R1：接入现有弹窗控制器

主要文件：[PassagePreviewSettingsDialog.vue](E:/read-web-next-optimization/src/features/passage-preview/PassagePreviewSettingsDialog.vue)。复用 [dialog-controller.js](E:/read-web-next-optimization/src/services/runtime/dialog-controller.js) 的现有焦点、键盘、栈和释放能力。

1. 为弹窗根节点建立 ref，在 DOM 可用后注册控制器；选择加载期间仍可聚焦的初始目标。
2. 打开后焦点进入弹窗；Tab 和 Shift+Tab 在弹窗内循环，不能落到 reader 热键输入或其他底层控件。
3. 非保存期 Escape 关闭；关闭按钮、取消、遮罩关闭和保存成功关闭沿用当前入口，关闭后焦点回到实际打开按钮。
4. 保存期保持当前禁止关闭与禁用逻辑；Escape 被弹窗消费，不能传到底层 reader 并触发其他行为。优先使用现有 close 守卫实现，不直接假定必须修改共享控制器。
5. 卸载时释放控制器和监听；重开、切换页面后无重复监听、错误焦点恢复或悬空弹窗栈。

保留数量范围、整数校验、保存服务、已保存值重开恢复、取消不误保存和固定浅色学习界面。不会更换整个弹窗体系，也不会把设置保存改成另一种持久化流程。

测试补充放在现有 [passage-preview-browser-check.cjs](E:/read-web-next-optimization/scripts/passage-preview-browser-check.cjs)；确实需要修改共享控制器时，才同时调整 [dialog-controller-check.mjs](E:/read-web-next-optimization/scripts/dialog-controller-check.mjs)，并回归它的现有调用者。

## 三、R2：局部合并规则，确定颜色变量的唯一归属

主要文件：[styles.css](E:/read-web-next-optimization/styles.css)、[workflow-ui.css](E:/read-web-next-optimization/src/styles/workflow-ui.css)。

### 3.1 只处理这些已知重复规则族

- `.youtube-workflow-layout`：基础、桌面断点和手机断点之间的重复列宽定义。
- `.youtube-workflow-panel`：基础宽度、后置宽度，以及更具体的 scoped 规则。
- `.youtube-subwindow`：相邻规则对定位方式与 padding 的重复覆盖。
- `.youtube-workflow-header`、`.youtube-job-status-badge`：重复基础定义及其相应断点/状态规则。

先用一张小表记录每个目标选择器的“文件位置 / layer / media / specificity / 属性 / 当前胜出值 / 处理结果”。这只是人工可读的变更说明，不新增 CSS 推理验证器。

只有在同一生效条件下已被覆盖、且合并后不会影响其他属性的声明才删除或合并。media、主题、状态、父选择器不同的规则不能仅凭选择器名字相同就删除。需要保留的重复项注明原因，视为已审查；不要求清空此前统计的所有重复组。

保留实际桌面导航列、手机单列、弹窗可达性、控件分组与换行。保留 `reader-footprint` 的低优先级布局占位、现有 Tailwind layer 顺序与有效业务状态；不整体重排或拆分根 CSS，不以降低 `!important` 数量为目标。

### 3.2 workflow 颜色变量统一到现有框架映射

适用根只有 `.youtube-workflow`、`.youtube-reader-controls`、`.youtube-material-notice`；后三者必须同时处理，避免 Teleport 出去的窗口失去变量。

以下已有变量以 `workflow-ui.css` 中现行 `--rw-ui-*` neutral 映射作为唯一归属：

`--pru-shell-bg`、`--pru-shell-surface`、`--pru-shell-row`、`--pru-shell-row-hover`、`--pru-shell-text`、`--pru-shell-muted`、`--pru-shell-border`、`--pru-row-border`。

移除或统一 `styles.css` 在相同三个根上的冲突赋值，让开发版和生产版不再依赖这两个 CSS 文件谁后加载来决定颜色。旧 `:root` fallback 及其他变量只有确认无当前消费者后才删除；保留仍有消费者的字体、状态、active/failed 等业务表达。

这部分允许的外观变化，是将原来不一致的 workflow 颜色统一到已经使用的 neutral 配方；不是新配色方案。记录具体前后变化，不能宣称全部像素不变。reader 五项自定义颜色的存储与映射、学习界面的固定浅色、共享 Button 的现行 default/icon 36px 配方保持。

## 四、R3：先定位构建差异，再做最小修复

当前依据为上一轮只读审计和已留存的生产产物：变量存在不同来源，部分标准 `backdrop-filter` 在产物中只剩带前缀声明，Chromium 计算结果与源码不同。这是已知既有差异；本轮实施时必须用当前开场代码重新构建核实，不能直接把旧产物当作当前事实。

1. 使用开场阶段新构建的 Temp `before-dist`，记录两个 HTML 入口及其实际 CSS 加载顺序。
2. 在相同入口、视口、主题、页面状态下，对比目标元素的 computed style 与胜出规则；先完成 R2，再确认颜色差异已消除。
3. 对滤镜差异区分源码、Tailwind CSS 转换、Vite 后续处理和最终加载层叠。必要时用 Temp 候选构建做一次受控 A/B，找到实际产生差异的阶段。
4. 优先修正已证明有问题的局部声明或受支持的最小构建选项。只有原因明确且局部 CSS 无法解决时，才允许修改 [vite.config.mjs](E:/read-web-next-optimization/vite.config.mjs) 的相关 CSS 构建选项，并说明两个入口的影响范围。
5. 最终修复后重新构建到新的 Temp `after-dist`；浏览器访问该产物验收，不能编辑打包后的 CSS 代替修复源码。

禁止为消除差异而整体关闭优化、升级依赖、修改 node_modules、全局加 `!important`、取消 CSS 分块或随意调整脚本顺序。若只能靠这些大范围手段解决，则按第八节停止并报告，不把“已定位”算作“已修复”。

滤镜验收对象限定为正常可达的 reader 文件按钮、实际标注气泡、视频标题栏，以及本轮动到声明的其他实际消费者。保留仍在使用的 glass 变量，不扩展为重新设计全部玻璃效果。

## 五、R4：确认消费者后做两类小清理

### 5.1 退役 chunk-note 变量

文件：[theme.js](E:/read-web-next-optimization/src/pinia-stores/theme.js)。重新检索源码、模板、动态字符串和生成路径，确认下面五项只剩写入/清理定义后，移除生成值及清理列表项：

`--chunk-note-color`、`--chunk-note-glass-bg`、`--chunk-note-glass-border`、`--chunk-note-connector-default`、`--chunk-note-connector-shadow`。

仅删除因此变成无引用的计算。**当前 `pb` 同时被有效的 `--glass-panel-bg` 和 `--glass-panel-bg-strong` 使用，必须保留。** 不删历史持久化数据，不改 `themeCustomColors`、visualStyles 或其他现行存储键。

### 5.2 fixture 专用样式隔离

文件：[passage-preview.css](E:/read-web-next-optimization/src/features/passage-preview/passage-preview.css)、[passage-preview-rating-latency-harness.js](E:/read-web-next-optimization/scripts/fixtures/passage-preview-rating-latency-harness.js)。

确认 `.passage-preview-check-*` 和 `.passage-preview-rating` 的指定规则只由 [PassagePreviewCheckPage.vue](E:/read-web-next-optimization/src/features/passage-preview/PassagePreviewCheckPage.vue) 消费、且该页只有 fixture 入口后，将这些专用规则及对应手机断点移到拟新增的 `scripts/fixtures/passage-preview-check.css`，由 harness 显式导入。

这是测试样式归属修正，不是大文件拆分任务。保留测试页与延迟评分测试，不把原生测试按钮强行换肤。相邻的 `.passage-preview-shortcut-*`、notice、footer、row、switch 等产品共用规则保留原位；不按整段位置或名称前缀批量搬走。

若发现真实产品消费者，则保留该项并在清理表说明；不能为了完成删除数量而删有效代码。

## 六、文件与实施边界

| 文件范围 | 允许的变更 |
| --- | --- |
| PassagePreviewSettingsDialog.vue | 控制器接线、节点 ref、必要生命周期与键盘处理 |
| styles.css / workflow-ui.css | R2 指定规则、八个颜色变量，以及 R3 证实需要的局部滤镜声明 |
| theme.js | R4 的五个退役变量及真正无消费者的关联计算 |
| passage-preview.css / fixture harness / 新 fixture CSS | R4 指定测试页样式归属 |
| passage-preview-browser-check.cjs | R1 的真实浏览器回归断言 |
| vite.config.mjs / dialog-controller.js 及其检查 | 条件文件；先证明需要，限定为本轮缺陷的最小修复 |
| 新的本轮交接文档 | 记录增量、结果、未运行项与保留理由；不覆盖旧交接 |

不改依赖版本、共享控件配方、IndexedDB schema、SRS 算法、Host/持久化架构、runtime 配置或薄入口。保留开场所有已修改/未跟踪工作，尤其 WhisperX/语言处理工作。

开场用新的 Temp 目录保存 git status、拟修改文件副本和哈希，并在修改前构建 `before-dist`；回滚依据是这些开场字节，不是 HEAD。不得执行会覆盖既有 dirty 的 restore/reset/clean。遇到同文件并发修改先核对增量，不覆盖对方工作。

## 七、固定验收与必要检查

### 7.1 本轮验收表

| 编号 | 必须满足的条件 | 证据 |
| --- | --- | --- |
| A1 | 设置弹窗初始焦点在内部；Tab/Shift+Tab 无泄漏；Escape、各关闭路径恢复焦点；重开无重复监听 | 实际打开、键盘操作、activeElement、关闭/重开结果 |
| A2 | 保存校验、保存后重开、取消不误保存、保存中禁用/拒绝关闭保持；保存期键盘不触发底层 | 正常服务边界上的请求与 UI 状态；不直接写组件 saving 状态 |
| A3 | R2 指定规则已合并或有明确保留原因；颜色变量归属唯一；布局、断点和业务状态保持 | 简短规则处理表、computed style、目标截图 |
| A4 | 当前 source 与最终 after-dist 的目标颜色、几何与有效滤镜一致，两个生产入口正常加载 | 当前构建身份、实际加载顺序、同场景对比、页面错误记录 |
| A5 | 五项退役变量无消费后清理；测试专用规则不随产品加载，fixture 行为与样式保持 | 消费者检索、CSS 入口/产物检查、评分延迟浏览器检查 |
| A6 | 本轮文件增量可辨；开场工作、数据配置、脚本顺序和配方保持；必要检查结果如实记录 | 本轮增量、相关检查日志及 PASS/FAIL/NOT_RUN 状态 |

A1–A6 都满足，才可说本轮执行收口完成。代码完成与独立审核结论分别记录；未运行项或未修复的一致性问题不能包装成通过。

### 7.2 浏览器矩阵

对当前 source 和最终 after-dist 分别执行下列必要范围，不重演所有历史 F1–F6 旅程：

- 主 reader：1280×800、390×844，分别检查 light、dark、custom-light、custom-dark，共八种上下文。检查目标 workflow 面板、三种变量根、设置弹窗、控件 36px 配方、横向溢出和手机关闭可达性。
- 学习入口：独立 `srs-review.html` 的两种宽度；reader 内实际 SRS 至少检查 1280 light 和 390 dark，确认固定浅色与控件不受根 CSS 修改干扰。
- 滤镜消费者：经正常素材打开流程得到非空材料，再实际打开标注气泡和视频；至少覆盖两种宽度及 light/dark。若修改构建选项会影响更多现有滤镜消费者，将这些消费者纳入 A4，仍不增加其他业务旅程。
- 边界断点：R2 改动断点规则时补测 760/761px 两侧，只核对对应布局变化，不扩成新的完整主题矩阵。

页面等待使用 DOM 就绪与具体业务 ready 条件。正常 fixture 可以提供服务响应与合成媒体，但必须沿用真实组件/业务入口；不得 force 点击不可见控件、直接塞私有状态、写媒体时间或拿壳页面截图冒充材料旅程。

保存期需要受控观察时，只在真实保存请求边界暂缓响应，确保实际 UI 进入保存期后再操作键盘，随后正常释放请求。输出截图与关键值即可，不新建庞大的证据格式或判定系统。

### 7.3 检查命令的适用范围

基础环境：`npm run verify:toolchain`、`npm run verify:browser-port-policy`。

R1：`npm run verify:dialog-controller`、`npm run verify:lifecycle-scope`、`npm run verify:keyboard-boundary`、`npm run verify:passage-preview:unit`、`npm run verify:passage-preview-shortcuts`，以及更新后的 `node scripts/passage-preview-browser-check.cjs`。

R2–R4：`npm run verify:theme-controls-module`、`npm run verify:glass-effects`、`npm run verify:style-editor-module`、`npm run verify:reader-controls-runtime`、`npm run verify:reader-app-runtime`、`npm run verify:youtube-workflow-panel`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:srs-review`、`npm run verify:srs-review-ui-v2`、`npm run verify:passage-preview:rating-latency-browser`。

最终边界：`npm run verify:script-order`、`npm run verify:legacy-deletion`、`git diff --check`、构建、`npm run verify:vite`、`npm run verify:production-preview`。

构建使用 `npm run build -- --outDir <本轮新Temp目录>/after-dist`；源码检查和 production 检查分别绑定正确 URL，production 检查必须实际服务本轮 after-dist，不能误用仓库中的旧 dist。fixture harness 的开发浏览器检查和生产产品检查用途不同，不能相互替代。

运行前读取浏览器脚本的服务/fixture 前置要求；不要直接跑包含线上 TTS 请求的 passage-preview 聚合命令。上述相关检查各跑一次，只有新改动、失败或未解决疑点才重跑相应项。本轮不为 CSS/弹窗收口另开全仓库架构或性能验收。

手动 optimization 预览沿用 `config/runtime.optimization.json` 与 `scripts/launch-optimization-preview.ps1`，端口 5184/8776、数据根 `E:\ReadWebData\SubtitleWorkflow-Optimization`。自动化临时静态产物服务使用现有 browser-port-policy 安全端口分配，只绑定 loopback。不得占用日常 reader 端口、接管未知监听或更改数据根来使测试通过。

## 八、停止规则与交付

- 发现需要拆大文件、改状态所有权、改变数据契约、升级框架或重写样式体系，停止该扩展，报告原因和已完成部分；不自动纳入本轮。
- 同一任务连续两次修复/复审仍失败，按 AGENTS.md 停止自动循环，重新评估任务边界；不得静默开始第三轮。
- 新增支持脚本接近 500 行或超过其 reviewed baseline 两倍，暂停说明复杂度。本轮优先复用现有检查，不能为验收再写一套应用实现。
- 环境或端口阻断时，记录具体 NOT_RUN 与影响范围，继续不依赖它的工作；不把旧结果、静态 fixture 或任意日志文本当作真实旅程通过。
- 新审核仅按 A1–A6，或具体 P0–P2 产品/数据/回滚故障提出阻断；不把建议性大文件拆分追加为验收要求。

实施后的交付只需：本轮文件增量；R1–R4 完成/保留说明；一张 A1–A6 结果表；构建与相关检查结果；有代表性的前后截图和样式值；明确尚未解决项。独立只读审核由用户安排，本方案不会自动创建新聊天或代理。

完成标准是：**现有换肤结果在源码与生产版中一致，已知弹窗缺陷消除，指定残留有明确归属，后续维护可以正常进行。** 大文件仍然较大，不影响这轮达到上述标准。
