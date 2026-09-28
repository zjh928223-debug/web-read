# P2-02：文章预习与生词整理窗口

## 目标、依赖与时间

依赖 [P2-01](./task-p2-01-annotation-dialog.md) 的样式衔接，遵循 [总方案](../ui-refactor-p2-plan.md)。施工 45–65 分钟、审核 15–25 分钟，合计 **60–90 分钟**。

本项处理 vocabulary-preview-module.js 中的“当前文章预习”和“整理本篇生词”两个窗口，不处理 P1-C 的 PassagePreviewPage。普通按钮与字段共享配方；候选行、发音、移出和缩放保持专用实现。

主要文件：[vocabulary-preview-module.js](../../../src/composables/vocabulary-preview-module.js)、[styles.css](../../../styles.css)、[learning-ui.css](../../../src/features/learning-ui/learning-ui.css)、[workflow-ui.css](../../../src/styles/workflow-ui.css)；相关检查为 [vocabulary-preview-ui-check.cjs](../../../scripts/vocabulary-preview-ui-check.cjs)。

## 1. 两个窗口的控件分配

| 窗口／控件 | 本次处理 |
|---|---|
| 当前文章预习：关闭、取消、生成 AI 解释 | 原生按钮接 ghost/icon-sm、outline/sm、default/sm；事件不变 |
| 当前文章预习：模型、API key | 原生输入接 input default、interaction=text；保留类型、值与密码语义 |
| 文章结算：关闭、AI 精简释义、本篇不加入、只加入单词、加入单词和短语 | 接已有按钮配方，保留原动作、禁用与 pending 文案；主动作 default，次动作 outline |
| 候选行的展开释义、朗读、移出／放回、重新学习 | 保留原结构、专用尺寸和事件；必要时只用局部语义颜色改善可读性 |
| 标题栏拖拽、右下缩放把手 | 完全沿用既有几何与 pointer 处理 |

## 2. 按顺序施工

1. 分别从 `btn-preview-vocabulary` 和 `btn-settle-article-vocabulary` 核对入口与现有创建函数。用一份合成文章及少量固定候选即可，避免真实扫描整个用户词库。
2. 两个 dialog 根都标记固定浅色，在 P2-01 已使用的 learning-ui.css 映射中增加 `.vocabulary-preview-dialog`。现有主壳已加载该样式，隔离窗口也加载同一入口，不能只因夹具缺 CSS 而另造一套样式。
3. 原生普通按钮／字段在 className 设置完成后调用既有助手，owner=learning；workflow-ui.css 补本模块精确 @source。复用 P2-01 的通用 owner 排除，不重复添加。
4. 优先迁移预习窗口的表单与 footer，再处理结算 footer。保留原 input.value、form/事件处理、controller 的初始焦点和 busy；不新增 click+submit 双路径，不修改候选扫描、AI 调用或 SRS 入库流程。
5. 局部旧关闭／普通按钮／输入装饰只对已迁移节点退出。保留 grid、form/list 的 min-height/overflow 和结算变体布局。普通窗口的 520px 宽度、720px/视口高度上限及结算拖拽写入的 inline 尺寸不被工具类覆盖。
6. 结算长操作文字使用局部自动高度／换行及 footer 排列解决；不减少文案、不把主动作缩成难点击小图标。completed/disabled 与处理中状态仍要明显，不依赖色差很小的 opacity。
7. 保留候选行点击展开时的 `closest('button')` 排除、actions 的 stopPropagation、data-removed/data-playing、释义 hidden、resize pointer 处理。不要把整个行或 role=button 的释义区域套为普通 Button。
8. 最后统一局部背景／文字／边框到既有浅色变量，仅整理相关颜色；不改变拖拽、缩放、audio 状态、ECDICT 临时建议与候选数据。

## 3. 最少审核步骤

- [ ] 文章预习可打开、输入、模拟生成一次、展示结果及关闭；一次失败提示清楚，busy 后恢复。密码仍为 password。
- [ ] 结算展示少量“单词／短语”样例：展开释义、移出再放回、朗读按钮均保持原 UI 行为，点击操作按钮不会误触行展开。朗读服务可用固定替身。
- [ ] 选择“只加入单词”或“加入单词和短语”的原参数仍正确，一次点击只调用一次；busy／完成禁用及模拟失败恢复保持。使用注入服务确认回调，不以此声称真实 SRS 写入通过。
- [ ] 用固定报告检查 AI 精简的长状态文案；中断／错误后原按钮可恢复；不向真实外部模型发请求。
- [ ] 结算拖动／缩放各一次，关闭与焦点返回正常；桌面和390px下标题、滚动列表及 footer 可达。主壳深色下窗口仍浅色可读，P2-01 窗口未受影响。

命令：`npm run build`、`npm run verify:vocabulary-preview-ui`、`git diff --check`。该 UI 脚本包含重复点击、释义及失效精简恢复等既有用例，优先复用；`READ_WEB_URL` 可指向已经启动的当前开发预览，先看现有脚本启动方式，不沿用失效的旧端口。若整条脚本被无关环境问题挡住，记录其失败并直接验证上述实际模块窗口，不展开环境修复；自己的必要 UI 行为未验证则如实未完成。

脚本当前有 disabled 背景固定为 `#e2e8f0` 的视觉断言：若改用语义变量，更新为新的明确 disabled 样式及实际可辨识结果，同时保留按钮真实 disabled 和重复操作断言。

## 4. 遇到问题怎样小修

| 问题 | 最小修法 |
|---|---|
| 长按钮挤到窗口外 | 仅调 footer 换行／按钮局部 height，保留现有宽度与业务文案 |
| 点击朗读／叉号展开了释义 | 恢复原 button 节点和事件冒泡处理，不重构整行 |
| 应用配方后不久又消失 | 检查后续 className 赋值，只调整应用时机；专用图标保持原样即可 |
| 拖拽／缩放位置跳动 | 撤掉本项干扰 position/transform/inline geometry 的样式，不改坐标算法 |
| 预习正常但结算变形 | 恢复 `--settlement` 专用布局，只共享控件装饰 |
| AI／词库服务或历史数据报错 | 改用少量固定候选与回调检查 UI，记录模拟范围；不修改协议或清理数据 |

交接写明两个窗口的普通控件、保留的专用控件、实际检查和模拟范围，以及 P2-03 可清理的退出规则。该 UI 范围完成即 PASS，不追加真实入库、跨机器或全域验收。
