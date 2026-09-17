# P1-05：清理退出规则并完成最终审核

## 目标、输入与用时

- 依赖：[P1-04](./task-p1-04-fields.md)，Button、Input、Textarea 已按本轮范围迁移。
- 目标：移除确实无消费者的旧工作流规则，验证新组件可用、未迁移区域没有退化。
- 预计执行／整理 20–35 分钟，最终审核 10–15 分钟，合计 **30–50 分钟**；不含新增回归修复或环境故障。
- 可修改：styles.css 中本轮退出的规则、过渡排除条件、对应旧视觉断言；发现绑定／控件问题则回到对应任务做最小修复。

在 `E:\read-web-next-optimization` 本地串行推进，保留用户已有修改，遵循 [AGENTS.md](../../../AGENTS.md)。使用 [UI-Dev 环境](../../../UI-DEVELOPMENT.md) 的 5195 / 5194 / 8786 与测试数据，不发布到 stable。一次简短审核即可，不增加全盘安全检查、审批、权限系统或证据验证器。

## 步骤 1：核对实际迁移范围

1. 汇总 P1-C1 接入、P1-C2 按钮、P1-C3 输入的提交／差异和测试结果。
2. 列出仍保留原生旧样式的工作流控件例外及理由；本轮计划范围内尚未迁移的控件应注明未完成，不能把它悄悄当成后续项目。
3. 对每条拟删规则确认当前真实消费者，不使用 P0 的旧行号或审计里的历史数量作为删除依据。

## 步骤 2：删除不再使用的旧工作流装饰

1. 删除已无消费者的工作流按钮／输入普通态、变体、状态、伪元素及有关 important；保留仍有效的布局、媒体规则和变量消费者。
2. 选择器列表含 reader controls、素材通知或其他分支时逐分支确认；有未迁移消费者的部分继续保留。
3. 基础通用按钮／glass-button 的所有者排除仍保护其他页面共存时继续保留，不为“删光过渡代码”重新让它们命中新控件。
4. 旧变量没有完全失去消费者时不删，不改学习主题、主工具栏或动态弹窗来方便清理。
5. 本轮只清理由组件迁移实际产生的退出项，不把剩余所有重复面板／卡片规则再清理一遍。

## 步骤 3：确认主题、样式与构建

1. light→dark→custom→light，硬刷新后主题恢复正常；仍由 theme.js 管理，没有新持久化键或第二主题状态。
2. 三个实际工作流根中的新控件都有前景／背景和焦点变量，素材通知不依赖主面板祖先。
3. 编译结果使用已定 `rw` 前缀，没有全局 Preflight／body／通配符装饰重置；静态扫描包含真实使用的全部组件配方。
4. 新组件配方、class 合并与实际 Computed 一致，无靠全局 important 压过旧 CSS 的补丁。
5. 原 Vite 服务插件、UI 代理／端口和多页面构建入口保留；只做构建和现有检查，不为验证启动正式版本。

## 步骤 4：最小关联功能检查

| 范围 | 本轮最终检查 |
|---|---|
| 工作流按钮 | 普通／primary／destructive／ghost／导航选中；hover、active、focus、disabled/pending |
| 表单 | 普通设置输入、password、多行 paste、trim、blur、Ctrl+Enter、submit；事件没有双触发 |
| 弹窗 | 主面板及质量报告 Tab/Shift+Tab、Escape、pending、初始焦点与关闭恢复；仅现有控制器工作 |
| Teleport | 素材入口计数／信号、质量报告首按钮和关闭、素材通知操作与关闭 |
| 响应式 | 760/761 导航、640/641 动作与输入布局；新尺寸不遮挡或溢出 |
| 主阅读器 | 工具栏、文件导入入口、动态样式按钮未被新工具类／reset 改变 |
| 学习页 | P0 文字变量与评分语义色保持；独立设置、SRS 普通／禁用／焦点抽查 |
| 阅读与浮层 | 播放、句子跳转、普通／AI chunk 切换、中文隐藏占位；注释／视频浮层按钮和几何无新变化 |

已由前项在相同最终代码上验证且后续改动不影响的范围可引用结果。疑点才复测，不把所有页面再跑一遍完整旅程。真实写入只用 UI-Dev；用夹具或强制状态时说明方式，不声称验证了未发生的后台操作。

## 步骤 5：运行与维护必要检查

- `npm run build`、`npm run verify:vite`、`npm run verify:youtube-workflow-panel`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:script-order`、`git diff --check`。
- 浏览器命令复用已启动的 5195，当前进程 READ_WEB_URL 指向它，verify:vite 另设 READ_WEB_PORT=5195；结束后恢复。服务中断时先恢复 UI 开发入口，避免脚本改用默认 Vite。
- 旧的胶囊、12px 素材打开圆角、固定玻璃阴影等视觉断言应已在迁移时同步调整；此处只补遗漏。保持原业务／交互断言，不为过关放宽关键行为。
- 如果本轮确实触及依赖或源码／脚本登记，执行项目已有相应检查；不新增一套框架，不每阶段重复全量 npm test。没有运行的检查如实说明。

## 执行后的最终审核

1. **范围：** 三种基础控件按计划迁移，原生 CSS 仍服务未迁移区域；没有顺带重做 Dialog、Tabs、数据服务或全站尺寸。
2. **样式：** 查看一个普通按钮、一个危险按钮、一个输入框的胜出来源；新配方生效，旧 CSS 不再覆盖。
3. **交互：** 复查一个 submit、一次多行粘贴、质量报告焦点恢复和 pending；其他项复用执行结果。
4. **关联影响：** 抽看 SRS／预习与主阅读器，确认 Tailwind 基础样式和工具类未造成回归。
5. 给简短“完成”或具体未完成项。发现新增回归只修其归属步骤；遵循项目现有复核规则，不添加新的审批循环。

## 最终交付与下一阶段

建议清理提交：`refactor(ui): retire migrated workflow control styles`（P1-C4）；没有额外源码清理时只交付结果，不造空提交。

最终消息包含：提交、已迁移控件、局部主题／前缀配置、旧样式删除范围、必要截图／测试、剩余例外。无需再写多份报告。回退按 P1-C4→C3→C2→C1 的依赖顺序处理所需范围，保留无关用户改动。

本轮完成后再规划主工具栏与动态样式工具、SRS／预习共享组件、弹窗行为迁移；这里不自动开始它们或发布到 stable。

## P1-05 实际执行记录（2026-09-16）

### 实际修改和关键配置决定

- 清理 `styles.css` 中已迁移工作流叶节点的旧装饰链：普通／主要／危险按钮、导航／筛选按钮、原生 input／select／textarea、旧 `small-btn` 尺寸、伪元素、`ui-glass-dynamic`、disabled important、质量提交覆盖，以及 `--youtube-capsule-*` 胶囊变量和对应玻璃规则。
- 从全局按钮／`glass-button`／dark 兼容白名单中移除 `.youtube-workflow` 这一已完成迁移的叶节点分支；保留面板、行、布局、媒体查询、质量报告和三根主题变量。读者控件仍保留旧兼容分支，`VideoPlayerFloat` 使用的未迁移 `.youtube-workflow-icon-btn` 规则也保留。
- 更新 `scripts/youtube-workflow-panel-v3-check.cjs`：断言迁移后的工作流旧叶规则和胶囊变量已退出，同时断言读者／视频未迁移兼容规则仍在。
- 未改动 Vite／Tailwind／shadcn 配置：继续使用 Tailwind v4 + `@tailwindcss/vite`、shadcn `new-york`／`neutral`／CSS variables、`rw:` 前缀、局部 `workflow-ui.css`、显式 `@source`，不启用全局 Preflight；未改 `theme.js`、IndexedDB schema、端口或数据根。

### 审核结果

- UI-Dev `5195`／测试数据实测：工作流库视图有 32 个 `data-ui-owner="workflow"` 按钮、0 个未归属按钮；设置视图的 owner Input 与组件样式生效，未发现工作流 raw input／textarea／select。
- 手工确认 light → dark → custom → light、custom 硬刷新恢复，主题仍由既有 `theme.js` 和 `theme`／`data-theme-mode` 管理；工作流按钮没有旧玻璃伪元素或 hover 位移，截图为 `output/playwright/ui-p1-05-final-library.png`。
- 通过：`npm run build`、`npm run verify:youtube-workflow-panel`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:script-order`、`git diff --check`。行为检查覆盖工作流按钮状态、表单 trim／paste／submit、质量报告焦点／Teleport、通知和 760／640 响应式边界。
- 首次 `npm run verify:vite` 在 `READ_WEB_PORT=5195` 下暴露 playback 超时，且未进入 interactions；后续补充记录已完成定位与修复，见下方“补充修复与验收闭环”。

### 下一项需要注意的问题

- P1-05 的清理实现与整体回归已闭环；后续若再次出现播放门禁失败，先区分会话恢复竞态、验收夹具和业务播放逻辑，不要直接归因到工作流 CSS 清理。
- 后续 UI 顺序仍是主工具栏／动态样式工具、SRS／预习共享控件，再进入 Dialog 行为迁移。`App.vue`／`index.html` 的旧 `small-btn`、主阅读器控件、`VideoPlayerFloat` 原生视频按钮等未迁移消费者继续保留旧样式边界。

## P1-05 补充修复与验收闭环（2026-09-17）

### 实际修改和关键配置决定

- 修复 `scripts/read-web-playback-check.cjs` 的播放夹具：等待 `AnnotationDiagnostics` 报告会话恢复完成／拒绝后再注入测试音频，若已恢复 AI chunk 模式则先退出；这样不会让旧会话在测试中途重新加载音频或把 transcript 视图留在隐藏状态。
- 将播放高亮断言从固定的 `#word-1.word-highlight` 改为当前 `activeWordIdx` 对应节点必须带 `.word-highlight`，并同步更新报告条件；不放宽播放业务逻辑，只修正验收对推进中播放位置的错误假设。
- 父提交 `HEAD^` 已在临时归档目录、同一 Host 与 5195 端口做对照：旧断言没有复现超时；当前提交的失败由固定词索引与会话恢复竞态共同暴露。临时归档未进入工作区，stable 未触碰。
- 未修改 Tailwind、shadcn、主题、端口、业务 CSS 清理范围、IndexedDB schema 或业务播放逻辑。

### 审核结果

- `npm run verify:vite`（`READ_WEB_PORT=5195`、`READ_WEB_URL=http://127.0.0.1:5195/`）全绿：load、playback、interactions 均通过。
- playback 独立连续复跑 5 轮全部通过；最终报告同时确认句／词高亮模式、前后跳句、AI chunk 切换与点击状态。
- 通过：`npm run build`、`npm run verify:youtube-workflow-panel`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:script-order`、`git diff --check`。
- 最终状态：**清理实现完成；整体回归已闭环。**

### 下一项需要注意的问题

- 下一项按既定顺序进入主工具栏／动态样式工具、SRS／预习共享控件，再评估 Dialog 行为迁移；继续保留 `VideoPlayerFloat` 原生视频按钮和主阅读器旧兼容规则。
- playback 验收依赖会话恢复终态；若后续调整 session startup 或 owner 恢复协议，应优先保留该等待与夹具隔离，否则容易重新出现 `play()` 被新加载请求中断。
