# 第六阶段 P2：剩余常用窗口整理与 UI 重构收尾

日期：2026-09-26。状态：用户已确认 P2 全部完成，按约定 UI 范围收口；P2-01、P2-02 产品改动分别已提交为 `19122f0`、`c9c18b1`。依据当前源码和已完成 P1-D 的交接编写。

## 1. 本阶段的具体取舍

**本轮安排三项：AI 解释标注窗口 → 文章预习／生词整理窗口 → CSS 收尾与常用操作抽查。** 不再固定凑五项，也不要求把所有原生 CSS 和控件换掉。

源码确认 index.html 有三个实际入口：`btn-annotation-backfill-ai`、`btn-preview-vocabulary`、`btn-settle-article-vocabulary`。reader-app-runtime.js 分别初始化现有控制器。窗口内部仍通过 createElement 创建原生 DOM，继续用这种方式；复用已有原生控件样式助手，不迁成新的 Vue 子应用。

| 区域 | 本轮决定 | 依据 |
|---|---|---|
| AI解释标注 | 整理普通按钮、模型／密钥字段及局部颜色 | 可达常用入口，仍有旧裸按钮和局部装饰叠加 |
| 当前文章预习、整理本篇生词 | 整理普通动作和字段，共享容器浅色语义 | 两个窗口共用 CSS 和控制模块，需要同项串行处理 |
| 解释历史记录卡、释义展开行、发音／移出按钮、结算缩放把手 | 保留专用 DOM 和几何，只在确有颜色冲突时局部修正 | 不是普通表单按钮，直接套固定尺寸会改变内容和事件行为 |
| 视频浮层 | 本轮保留 | 30px 标题栏、24px 图标和拖拽／缩放计算已配合使用，尚无本轮必须重构的证据 |
| 字幕、Chunk 正文、释义泡泡 | 本轮保留 | 专用定位、排版和交互的维护收益不足以支持本轮改造 |
| PersonalizationShadowPage、CheckPage、旧不可达样式编辑器 | 保留既有用途和样式 | 不为 UI 统一恢复入口或推广低使用频率页面 |

这里“保留”是明确完成边界，不自动产生下一批迁移欠账。若执行时发现入口已由其他改动移除，核对一次后记录为保留即可，不把入口重新接回来。

## 2. 顺序与时间

| 顺序 | 独立执行文件 | 施工 | 审核 | 合计 |
|---|---|---|---|---|
| P2-01 | [AI 解释标注窗口与原生控件样式接入](./ui-refactor-p2/task-p2-01-annotation-dialog.md) | 40–60 分钟 | 15–20 分钟 | 55–80 分钟 |
| P2-02 | [文章预习与生词整理窗口](./ui-refactor-p2/task-p2-02-vocabulary-dialogs.md) | 45–65 分钟 | 15–25 分钟 | 60–90 分钟 |
| P2-03 | [旧样式清理与最终收口](./ui-refactor-p2/task-p2-03-final-review.md) | 20–30 分钟 | 10–15 分钟 | 30–45 分钟 |
| 合计 | 三项串行 | 105–155 分钟 | 40–60 分钟 | **145–215 分钟，约 2 小时 25 分钟至 3 小时 35 分钟** |

时间为估算，包含一次审核，不含环境等待或无关故障处理。P2-01 建立本批最少的样式衔接，P2-02 直接复用；两项都改 styles.css、学习语义样式，按顺序执行，避免重复加入覆盖规则。P2-03 只收尾前两项，不重新审计全站。

## 3. 已确定的简单实现方式

### 3.1 继续使用原生 DOM，复用已有配方

- 普通按钮使用 `src/lib/native-control-styles.js` 的 applyNativeControlStyles；字段使用 `src/lib/native-input-styles.js` 的 applyNativeInputStyles。均在实际节点建立、原 className 设置完成后调用，保留节点、type、事件、disabled、ARIA 和 DOM 引用。
- 只装饰任务列明的普通控件，不修改通用 createElement 让所有 button 自动套样式。只调用一次，不在每次 setBusy/render 状态刷新时叠加配方。
- 关闭 ghost/icon-sm；普通次动作 outline/sm；主要动作 default/sm；模型／密码字段 default 档，interaction 明确为 text。原生助手默认输入 interaction 为 hotkey，不能漏掉覆盖，否则普通输入会变成不可选文字的录键外观。
- 多行历史卡、发音图标、移出叉号和拖拽把手继续使用现有专用规则。无需新增组件库、窗口管理器、全局状态或表单系统。

### 3.2 使用已有学习浅色变量，避免再建一套主题

两个模块目前容器主要为浅色硬编码；本轮明确保持浅色。目标 dialog 根加 `data-ui-theme="light"`，普通迁移控件加 `data-ui-owner="learning"`。在 learning-ui.css 中将已有变量映射和局部控件基础规则扩到两个明确根：`.annotation-backfill-dialog`、`.vocabulary-preview-dialog`。不把 `.srs-review-page` 类加到弹窗上借用布局。

App.vue 已加载 learning-ui.css，main.js 已加载唯一 Tailwind 入口 workflow-ui.css。只在该入口补两个动态模块的精确 `@source`；不新增构建入口、不全库扫描。现有 dark variant 已排除固定浅色域，glass-effects.js 已识别 learning owner，不必再写新的装饰观察器。

styles.css 中这两个窗口仍在旧通用 button／glass 匹配范围，而其排除列表尚未包括 learning。P2-01 为相关旧规则补 learning 排除，同时处理本窗口局部 button/input 覆盖；P2-02 再处理自身局部规则。只移除装饰冲突，保留 hidden、布局、scroll、busy、业务状态 class 和原生消费者。

### 3.3 普通控件变一致，窗口行为保持

保留原 createDialogController、打开／关闭条件、提交顺序、生成状态、候选勾除与批次归属。文章结算的拖拽、缩放、释义展开和事件冒泡均不重写。`当前文章预习` 是 vocabulary-preview-module.js 内的窗口，与 P1-C 的 PassagePreviewPage 首次接触流程不同，不重开 C03/C04/C05。

## 4. 问题出现后怎样简单修

| 现象 | 最小处理 |
|---|---|
| 新按钮颜色／高度又被旧规则改掉 | 找当前胜出的选择器，给已迁移 owner 排除；不再叠一条 important |
| className 赋值抹掉新配方 | 将样式助手移到原 className 赋值之后，不改渲染架构 |
| 专用卡片或图标套配方后变形 | 保留原控件外观，只复用局部颜色；这是允许的交付结果 |
| 模块测试复制临时源码后找不到新增样式依赖 | 仅补原脚本的样式助手、配方及 utils 的路径／复制适配，不建设另一套测试加载框架 |
| AI／Host／发音服务不可用 | 用现有依赖注入或固定响应驱动实际窗口的 UI 状态；注明模拟范围，不修后台、不要求真实外部请求 |
| 本项新增的点击／输入／焦点故障 | 恢复原节点和事件，保留样式改动；只回归该操作 |
| 修复开始扩大 | 保留难改的原实现，说明例外；按 AGENTS.md 已有修复循环规则处理，不启动新一串环境验收 |

## 5. 检查与收口口径

每项文件给出少量具体检查。实际窗口打开、一个代表动作、关闭与焦点，以及桌面／390px 的可用性足够；有断点修改才检查其两侧。主壳 dark 下窗口保持可读，既有 reader/workflow 主题不受影响。

优先复用既有模块测试和实际 DOM 窗口，AI、发音、候选数据使用本地假数据即可。本轮结论是 UI 重构通过，模拟生成或收录不证明真实业务持久化，也不因此另欠一次 Host 验收。接口、事务和服务流程不改时，不重跑 P1-C 已完成的合成数据旅程。

有代码变化时跑一次 build、该项受影响的既有检查和 `git diff --check`；没改相关模块则引用前项结果。普通入口可用时优先抽查；被旧环境问题挡住时使用实际模块的隔离窗口，保留失败事实，按预定 UI 范围审核。审核意见对应本项标准或本次引入的具体功能故障，不新增全域、跨机器、严格延迟或外部 API 验收。

每项末尾记录：实际修改、关键样式选择、检查结果及模拟范围、保留例外。现有文档足够，不需要登记平台或证据解析器。P2-03 达标即结束本轮 UI 重构，不自动再开一轮“全系统验收”。

环境遵循用户最新 [AGENTS.md](../../AGENTS.md)，不恢复已失效的 UI-Dev 启动约定。实际服务启动先读现有配置；浏览器使用独立上下文与合成内容，UI 检查不需要批量修改或清理已有用户记录。规划本身不启动服务、不操作数据。

## P2 执行与最终交接（2026-09-26）

本轮 UI 重构按约定范围完成：常用基础控件和目标窗口已有统一样式来源，专用阅读区域和稳定原生控件继续保留。

### 实际修改与配置决定

- P2-01 已在提交 `19122f0` 完成 AI 解释标注窗口接入：继续使用 `applyNativeControlStyles`／`applyNativeInputStyles`，`data-ui-owner="learning"`，浅色 `data-ui-theme`；保留历史记录和内嵌 SRS 专用区域。
- P2-02 的改动已在后续提交 `c9c18b1` 保存：`src/composables/vocabulary-preview-module.js`、`src/features/learning-ui/learning-ui.css`、`src/styles/workflow-ui.css`、`styles.css`、`scripts/vocabulary-preview-ui-check.cjs`。两个窗口共享原生控件配方和 learning 浅色变量；唯一 Tailwind 入口仅增加动态模块的精确 `@source`。
- P2-03 本轮没有再改产品源码；确认两个窗口已退出旧关闭／输入／普通按钮装饰规则，仍有消费者的容器布局、状态、候选行、朗读／移出控件和拖拽／缩放规则继续保留。视频浮层、Transcript／Chunk 正文、annotation bubble、CheckPage、PersonalizationShadowPage 及旧编辑器用途均未扩展施工。
- 文档改动为本文件；方案与交接的仓库外副本：`C:\Users\0\Documents\Read-Web-UI-P2-Backup-2026-09-26\`。没有创建提交。

### 执行自检与审核

- `npm run build`：PASS。
- `npm run verify:annotation-backfill-ai`：PASS。
- `npm run verify:vocabulary-preview-ui`：PASS。
- 隔离 Chromium／本地 Vite 窗口抽查（无 Host、假文章、假存储、假 AI 响应）：预习窗口桌面状态可打开，模型输入可编辑、API key 仍为 password，初始焦点和取消后的焦点返回正常；假 AI 主动作只调用一次并显示成功状态。主壳设为 dark 的 390×844 结算窗口仍是浅色；实测宽 376px、左右边界 7px／7px，四个 footer 操作均在窗口内，关闭后焦点返回入口。
- `git diff --check`：PASS（最终文档写入后执行）。
- 未验证真实 Gemini、Host、SRS 持久化、实际发音服务，以及结算候选行朗读／移出和拖拽／缩放操作；本轮不以模拟结果代表这些真实服务，也不扩展为 Host 或全系统验收。

### 下一项注意

P2 产品改动已提交；本次状态核对时，方案文档仍为未跟踪文件，不将其误记为已提交。P1-C 范围决策里记录的普通 UI-Dev `Command ID was reused` 仍按原决定保留；若正常使用再次触发，单独按入口故障处理，不把它重开为本轮 UI 收尾任务。没有自动接续的 UI 迁移项。

### 规划侧收尾确认

用户已确认 P2 全部完成。规划侧读取了现有交接并核对上述两个提交，更新了过时的“P2-02 未提交”状态；未重跑测试或浏览器操作。以上检查结果沿用执行交接，未验证项目仍保留原证据边界。本轮 UI 重构到此结束，后续按实际使用中出现的具体问题局部维护。
