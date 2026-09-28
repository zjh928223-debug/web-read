# P1-D04：工作流面板与质量报告容器整理

## 目标与时间

D03 结束后执行，避免同时编辑 styles.css。按 [总方案](../ui-refactor-p1d-plan.md) 整理工作流主面板和质量报告的容器装饰来源；按钮与表单沿用 P1-A，不重做业务流程。施工 25–40 分钟、审核 10–20 分钟，合计 **35–60 分钟**。

主要修改：[styles.css](../../../styles.css)。只读核对 [YouTubeWorkflowPanel.vue](../../../src/components/YouTubeWorkflowPanel.vue)、workflow-ui.css 和 dialog-controller.js；仅确有模板样式钩子需要时才改组件。

## 顺序施工

1. **限定两处根。** 主面板 `.youtube-workflow-panel` 与 Teleport 质量报告 `.youtube-quality-backdrop .youtube-quality-card`；素材通知、列表行、进度条、下载服务不在本项。设置页在主面板内，不另造一个设置 Dialog。
2. **找到最终生效规则。** styles.css 有多段同名容器规则，按实际计算样式核对背景、边框、阴影、圆角、留白。只合并这两处容器的重复装饰；基础布局、760px 响应式和其他消费者所需规则保留。
3. **接回已有语义来源。** 主面板和质量报告沿用 `.youtube-workflow` 的 `--pru-shell-surface/text/border`，减少同一容器的 glass／局部混色覆盖；需要阴影可保留一个已有值。两处分别保持现有 22px／18px 圆角和内容密度，不为了统一成同一尺寸大改布局。
4. **保留布局和层级。** 主面板仍为右侧宽面板，保留 clamp 宽度与窄屏全屏；质量报告仍为上层卡片，2400/2600 层级与 Teleport 归属不变。容器不要加 `data-ui-owner="workflow"` 触发按钮/input reset，也不套通用 Dialog 的宽度、portal 或焦点管理。
5. **保留控制器。** panelDialogController、qualityDialogController、setBusy、真实关闭按钮查询和 pending 关闭条件沿用。用既有固定任务／质量报告响应验证窗口，不需要真实下载、转写、凭据或外部模型请求。

## 遇到问题时的最小修法

| 问题 | 简单处理 |
|---|---|
| 面板突然变窄、内容不滚动 | 恢复原 width/grid/overflow，仅整理装饰 |
| 质量报告在父面板下面或主题不对 | 恢复原 Teleport 根、层级和 `.youtube-workflow` 主题作用域 |
| Escape 同时关闭父子窗口 | 撤掉本项新增控制器／监听，沿用现有 topmost 处理 |
| 老的玻璃样式断言失败 | 修改确实对应本项装饰目标的断言；保留层级、pending 和焦点行为断言 |
| 无任务数据打不开质量报告 | 复用既有浏览器检查的固定报告返回，只验证实际组件窗口，不启动下载／转写修复链 |

## 执行后审核

- [ ] 主面板各页签仍可使用，桌面与390px 下关闭、内容滚动和主操作可达。
- [ ] 打开质量报告后焦点在报告内，Escape 只关闭上层并返回父面板；再关闭父面板返回其触发入口。
- [ ] 用一次固定 pending 状态确认既有关闭限制没有因样式改动失效，恢复后可关闭；不测试真实后台长任务。
- [ ] light/dark 及一个既有 custom 下两处容器可读；D03 样式弹窗未受共享 CSS 影响。

必要命令：`npm run build`、`npm run verify:youtube-workflow-panel`、`git diff --check`。浏览器检查优先复用 `verify:youtube-workflow-panel-behavior` 的固定 API 数据；整条脚本若被无关环境前置挡住，只做上述窗口操作并记录，结果限定为 UI 范围，不要求修复全脚本。

符合范围即 D04 PASS。若检查后目标容器已满足目标且没有安全可删的重复声明，可记录“已满足，无代码修改”，不为任务存在而强行重构。
