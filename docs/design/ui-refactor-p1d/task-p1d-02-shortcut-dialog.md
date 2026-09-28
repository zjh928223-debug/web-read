# P1-D02：快捷键弹窗控件与焦点衔接

## 目标与时间

承接 [D01](./task-p1d-01-preview-settings.md) 的学习弹窗样式，按 [总方案](../ui-refactor-p1d-plan.md) 迁移快捷键窗口内部按钮。施工 30–50 分钟、审核 15–20 分钟，合计 **45–70 分钟**。

主要文件：[PassagePreviewPage.vue](../../../src/features/passage-preview/PassagePreviewPage.vue)、[passage-preview.css](../../../src/features/passage-preview/passage-preview.css)，必要时调整 learning-ui.css。现有 controller 和 shortcut 模块作为行为依据。

## 顺序施工

1. **列出实际控件。** 关闭、中文快捷键录制、各行动录制、恢复默认、完成；中文“按住／持续”切换单独保留原生节点。不再迁移已经完成的页面 footer。
2. **替换普通按钮。** 关闭 ghost/icon-sm，录键 ghost/sm，恢复默认 outline/sm，完成 default/sm，添加 learning owner。原 click、ARIA、editing 状态和 kbd/small 子节点保留。录键内容较高时用局部 `height:auto`／最小高度容纳，不改全局 Button。
3. **只适配一个初始焦点。** 原 `shortcutDialogInitialFocus` 原生 ref 若变成组件引用，在关闭 Button 上加一个明确 data 标记，由 `shortcutDialogRoot` 在现有 nextTick 后查询真实 button，传给原 controller。照现有质量报告的 DOM 查询方式即可；不依赖 Vue 组件实例能直接 focus。若适配没有收益，关闭按钮也可保留原生并复用 buttonVariants，记录为合理例外。
4. **保持录键与切换处理。** 中文模式原生 switch 保留 role、aria-checked、两个 span 和 handler，用现有学习语义色整理局部规则；不必换 shadcn Switch。录制时 Escape 取消本次录制，非录制时 Escape 关闭；沿用 window/document 现有处理顺序，不添加第二套监听。
5. **清理按钮冲突。** 对已迁移录键/关闭/footer 排除旧 button 装饰，保留 kbd 布局和 is-editing 的必要视觉提示。共享 `.passage-preview-shortcut-row` 还有 CheckPage 消费，不能连同布局删除。对 D01 数量设置做一次打开查看即可。

## 遇到问题时的最小修法

| 问题 | 简单处理 |
|---|---|
| 打开后没有初始焦点 | 修根内真实 button 查询；仍复杂就保留原生关闭按钮并复用样式 |
| 录键两行文案挤压或被裁切 | 调该录键按钮的局部高度／gap，不改所有 Button |
| 一次 Escape 既取消又关闭 | 检查本项新增监听或传播变化，恢复原 window 捕获处理；不改公共 controller 协议 |
| 切换中文模式触发两次 | 恢复原生 switch 的单个 click 绑定，不加组件状态同步层 |
| 页面因旧 Host 问题打不开 | 隔离挂载实际 PassagePreviewPage，用最少只读样例内容打开快捷键窗口；验证 UI 和本地快捷键保存，不修业务数据链 |

## 执行后审核

- [ ] 打开后焦点位于实际关闭按钮；非录制时 Tab／Shift+Tab 能循环，Escape 关闭并返回触发按钮。
- [ ] 修改一个快捷键、尝试一个冲突键、Escape 取消录制、恢复默认，提示与原状态一致；重开后已保存快捷键仍在。使用独立浏览器存储。
- [ ] 中文按住／持续切换、松开和失焦行为保持；录键时不触发后方播放或页面导航。
- [ ] 桌面和 390px 下内容可滚动，录键文字、完成按钮可见；数量设置和 CheckPage 共享布局未受损。

必要命令：`npm run build`、`npm run verify:passage-preview:unit`、`npm run verify:passage-preview-shortcuts`、`git diff --check`。`passage-preview-check.cjs` 当前断言原生 `<button ref="shortcutDialogInitialFocus"`，若采用 DOM 查询应更新为新明确契约并检查实际焦点，不保留失效旧标签断言。未改 controller 源码时不需要另开 controller 验收任务。

交接记录初始焦点采用的简单方案、原生 switch 例外、快捷键操作与实际证据。符合范围即 D02 PASS，不附加评分／Host 动态矩阵。
