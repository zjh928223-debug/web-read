# P2-01：AI 解释标注窗口与原生控件样式接入

## 目标、范围与时间

按 [P2 总方案](../ui-refactor-p2-plan.md) 执行。本项先完成一个真实动态窗口，并提供 P2-02 可直接复用的最小样式衔接。施工 40–60 分钟、审核 15–20 分钟，合计 **55–80 分钟**。

主要文件：

- [annotation-backfill-ai-module.js](../../../src/composables/annotation-backfill-ai-module.js)：只改实际节点创建和样式应用。
- [learning-ui.css](../../../src/features/learning-ui/learning-ui.css)、[workflow-ui.css](../../../src/styles/workflow-ui.css)、[styles.css](../../../styles.css)。
- [现有模块检查](../../../scripts/annotation-backfill-ai-module-check.cjs)：必要的依赖加载／断言适配。
- 复用 [按钮助手](../../../src/lib/native-control-styles.js)、[输入助手](../../../src/lib/native-input-styles.js)，不另造封装。

## 1. 先确认这次需要动的节点

通过 `#btn-annotation-backfill-ai` 打开“AI解释标注”，对应 createAnnotationBackfillDialog。以当前页面或隔离真实模块查看一次默认状态，记录按钮高度、字段宽度与关闭位置即可。

| 控件 | 目标 | 原样保留 |
|---|---|---|
| 关闭 | ghost / icon-sm | 原生按钮、aria-label、close handler |
| 模型输入 | input default / text | text、autocomplete=off、spellcheck=false、原 value/事件 |
| API key 输入 | input default / text | password、autocomplete、留空语义；测试填虚构值 |
| 取消 | outline / sm | 关闭行为和 busy 处理 |
| 开始解释 | default / sm | 原 click/form 路径，只装饰，不重复绑定提交 |
| 当前文章解释记录卡 | 保留专用整行卡片 | model、数量、时间、data-current、disabled、记录切换 |
| 内嵌 SRS 操作区 | 由当前启用状态决定 | 先看 inlineSrsEnabled；未启用则保留，不为 UI 施工开启它 |

若内嵌 SRS 操作实际启用，已有“加入单词和短语”等普通动作可使用相同按钮助手；只改样式和原 disabled 呈现，不做实际词库写入验收。

## 2. 按顺序施工

1. 给 dialog 根加固定浅色标识，沿用学习域语义变量。在 learning-ui.css 的变量作用域及控件基础规则中增加本窗口根；保留现有 SRS／预习设置作用域。根本身不加控件 owner。
2. 在原节点创建、className/type/属性设置完成后应用已有助手，owner 为 learning。输入显式 interaction=text。保留原 DOM 引用与监听，不更换表单结构，不抽离整个控制器。
3. workflow-ui.css 增加本模块精确扫描路径。让 styles.css 中相关通用 button、hover/focus、glass/伪元素规则对 learning owner 退出；glass-effects 已支持此 owner，优先保持原实现。
4. 本窗口局部关闭／普通按钮／输入规则退出已迁移控件的装饰；保留 field、header/footer 布局、progress/status 语义和记录卡规则。输入保持全宽，footer 按原密度排列，长文案允许局部换行。
5. 把本窗口容器前景、背景和边框映射到已有浅色变量；主要处理固定浅底却继承主壳深色文字的冲突。保持 440px 宽度上限、定位、z-index、hidden 与控制器。仅当实际内容在小屏被裁切时补局部 max-height/滚动，不建立通用弹窗组件。
6. 调整现有测试的最小加载适配。该脚本会复制模块到临时目录，新引入的样式助手及纯 JS 配方依赖也需按既有方式可解析；不把所有 Node 检查迁到新框架。旧视觉断言对应新目标更新，保留生成次数和状态断言。

## 3. 最少审核步骤

- [ ] 打开后模型输入获得原初始焦点；Tab 可用，关闭／Escape 按原 busy 条件工作，关闭后焦点返回入口。
- [ ] 修改模型和虚构密码，触发一次模拟生成，传入值正确且只调用一次；busy、成功和失败提示可见，完成后控件恢复。
- [ ] 有两条解释历史记录时，选择状态、文字和原切换行为可用；重复渲染后样式不消失。无记录空态同样可读。
- [ ] 主壳 light/dark 下窗口均为浅色；桌面和 390px 下输入、长状态消息及 footer 可用。检查另一个未迁移词汇窗口没有因通用规则调整丢样式。

命令：`npm run build`、`npm run verify:annotation-backfill-ai`、`git diff --check`。只修改样式助手调用和 CSS 时不要求真实 Gemini、Host 或 SRS 保存。模块检查不能证明 DOM 焦点，以上交互用实际模块创建的窗口核对，外部依赖可固定返回。

## 4. 遇到问题怎样小修

| 问题 | 最小修法 |
|---|---|
| 输入变成居中／不可选文本 | 补 interaction=text，保留原 input |
| 字段或按钮仍被旧样式压住 | 修命中的局部选择器 owner 排除，不改共享组件默认值 |
| 记录卡被压成一行固定高度 | 撤销对记录卡的通用按钮配方，保留专用布局 |
| 隐藏窗口仍显示 | 恢复 `[hidden] { display:none }` 和原显隐属性，不用工具类接管打开状态 |
| 测试报新增 import 路径错误 | 只补既有临时源码加载所需依赖；不修改生成服务来配合测试 |
| AI 请求不可用 | 依赖注入一个成功／失败返回检查 UI，不排查凭据或后台 |

完成后追加简短交接：本次控件清单、变量及 owner 处理、检查结果、模拟范围、保留记录卡／SRS 区说明。按本项 UI 范围 PASS 后进入 P2-02。
