# P1-D01：预习数量设置与独立弹窗主题

## 目标与时间

依照 [P1-D 总方案](../ui-refactor-p1d-plan.md)，先完成一个小弹窗。预计施工 30–50 分钟、审核 15–20 分钟，合计 **45–70 分钟**。依赖现有 C04/C05 结果，不依赖 Host 历史验收。

目标是让“预习设置”使用已有 Button 和输入配方，并在 Teleport 到 body 后仍有正确浅色主题。保留原加载、保存、关闭逻辑和数值范围。

主要文件：

- [PassagePreviewSettingsDialog.vue](../../../src/features/passage-preview/PassagePreviewSettingsDialog.vue)
- [learning-ui.css](../../../src/features/learning-ui/learning-ui.css)、[passage-preview.css](../../../src/features/passage-preview/passage-preview.css)
- 参考 [Input 配方](../../../src/components/ui/input/input-styles.js)；App.vue 只需查看挂载关系。

## 顺序施工

1. **确认三个按钮和一个字段。** 关闭、取消、保存；原生 number 字段有 `.number`、min/max、step=1、loading/saving 禁用和 Enter 保存。记录这些就是行为基线，不另做全页审计。
2. **补独立弹窗主题。** 在该 dialog 根标记 `data-ui-theme="light"`，让 learning-ui.css 的已有颜色变量映射同时覆盖这个明确的根；不要复制整份 token，也不要添加 `.srs-review-page` 来借用整页布局。控件 reset 只作用于叶节点的 `data-ui-owner="learning"`。已有 dark variant 会排除固定浅色域，无须修改全局主题机制。
3. **迁移按钮。** 关闭用 Button ghost/icon-sm，取消用 outline/sm，保存用 default/sm；保留真实 button、type、aria-label、原 handler 和 disabled。宽度由 footer 局部排版决定，不把学习页 44px 大动作配方套到设置按钮。
4. **保留原生数量输入。** 直接绑定现有 `inputVariants({ size: 'sm' })` 的类，保留 `.number`、输入类型、范围及 Enter。保留约 82px 字段宽度和居中，在局部规则处理 `w-full` 冲突；不为本项增加 Input.vue 的 number 适配，也不引入表单库。
5. **同步退出旧装饰。** 当前 `.passage-preview-shortcut-dialog` 的 header/footer/input 样式也被快捷键窗口使用，只让本次带 learning owner 的按钮／字段退出其装饰和 hover/focus；未迁移窗口继续保留。容器维持 480px 上限及现有窄屏布局，把重复颜色引用到现有局部变量即可。
6. **核对原交互。** 原组件未接入 createDialogController，本项保持该事实；验证关闭按钮、取消和背景点击。保持 saving 时 close 不执行、失败 notice 不丢、成功按原顺序发 saved/close；不为统一样式额外加入一套焦点控制。

## 遇到问题时的最小修法

| 问题 | 本项直接采取的简单处理 |
|---|---|
| body 下的按钮透明、变暗或文字不清 | 修该 dialog 的语义变量覆盖，保留全局 dark variant |
| 数字输入、空值或 Enter 行为改变 | 恢复原生 input 和原绑定，仅保留共享样式类 |
| 新按钮仍是旧圆角／旧 hover | 给对应旧选择器补 owner 排除，不整段删除共享规则 |
| 保存过程中出现本次新增的重复调用 | 先移除新增事件绑定；确需防重时只在本地 save 入口复用 saving/loading 判断 |
| Host 读取失败导致拿不到设置 | 在隔离实际组件中用固定读／写返回验证数值、事件和错误提示；记录为 UI 验证，不修 Host |

## 执行后审核

- [ ] body 挂载时浅色按钮和数量字段可读；主壳浅／深主题各看一次，其他页面主题不变。
- [ ] 一个合法整数正常传入保存函数；一个越界或小数被原规则拒绝；清空输入不被误当作成功保存。
- [ ] 点击保存／Enter、saving 时的关闭行为、一次模拟保存失败提示与原流程一致；模拟返回的结果明确标注。
- [ ] 桌面与 390px 下标题、字段、关闭和保存可见；快捷键弹窗的旧按钮仍有样式。

必要命令：`npm run build`、`npm run verify:passage-preview:unit`、`npm run verify:passage-preview:learning-plan`、`git diff --check`。过时视觉断言仅按本项目标调整。无需运行旧预习聚合浏览器脚本或重建数据。

交接写实际修改、UI 检查结果及模拟边界、保留的原生 number、D02 需要复用的主题与旧选择器排除。符合上述范围即 D01 PASS，不附加真实 Host 持久化验收。
