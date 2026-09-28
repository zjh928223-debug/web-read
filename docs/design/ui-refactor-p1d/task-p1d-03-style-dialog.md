# P1-D03：AI 样式弹窗容器整理

## 目标与时间

在 D02 结束后串行执行。按 [总方案](../ui-refactor-p1d-plan.md) 整理原生 AI 样式弹窗的容器装饰，内部控件沿用 P1-B 已迁移结果。施工 20–35 分钟、审核 10–15 分钟，合计 **30–50 分钟**。

主要修改：[styles.css](../../../styles.css)；按需给 [index.html](../../../index.html) 现有节点补 class。只读参考 [style-editor.js](../../../src/composables/style-editor.js) 和 workflow-ui.css 中 style-controls 配方。

## 顺序施工

1. **只认当前可达入口。** `btn-chunk-style` 打开 `#chunk-style-modal`，共享 `#modal-backdrop`，关闭按钮 ID 和已有 controller 保留。旧 `#style-editor-modal` 动态编辑器分支不恢复，也不本轮删除。
2. **记录当前几何。** 保留固定定位、居中 transform、340px 宽度上限、视口 max-height、滚动、z-index 2990/3000 和 JS 设置 display 的方式。内部 number/color/toggle 控件已迁移，本项不重新绑定。
3. **整理容器装饰。** 当前玻璃背景、边框和阴影在本容器切换为清晰的现有 reader 主题色：优先 `--card-bg`、`--text-main`、`--border-color`，轻量阴影即可；保留 18px 圆角和现有留白，不为几像素差异重排页面。仅作用于当前容器，不重定义全局 glass token 或全部 `.modal-*`。
4. **收拢到一处。** 将本容器的背景／边框／阴影放在一处明确规则，退出该处不再需要的 blur 和叠层装饰。与旧编辑器共用的选择器可拆为公共几何和本容器装饰，旧分支保留自己的外观；不要在文件末尾不断追加覆盖。
5. **按原路径操作一次。** 打开，改一个字号和一个颜色，确认实时效果及重开后的值，关闭；恢复本次样例设置即可，不写真实使用配置。

## 遇到问题时的最小修法

| 问题 | 简单处理 |
|---|---|
| 弹窗打不开或关不掉 | 移除本项抢占 display/hidden 的样式，保留原 JS 显隐 |
| 不居中或超出屏幕 | 恢复原 position/transform/max-height，只保留新装饰 |
| 背景对比度差 | 修容器自身颜色映射，不改全局主题或玻璃变量 |
| 数量／颜色修改失效 | 恢复原 input 节点和 ID；本项只改容器，不重写 style-editor |
| 静态断言绑定旧的合并选择器 | 将断言改为检查仍成立的隐藏／定位和 ID 契约，不要求保留旧选择器排版 |

## 执行后审核

- [ ] 原按钮打开、关闭按钮／背景／Escape 关闭及焦点返回保持，Tab 操作正常。
- [ ] 一次数值／颜色修改仍实时生效，重开设置值不被重置。
- [ ] reader light、dark 和一个既有 custom 主题颜色可读；桌面／390px 下可滚动且关闭按钮可见。
- [ ] 没有改正文 DOM、实时样式计算、原生颜色控件和已迁移按钮配方。

必要命令：`npm run build`、`npm run verify:style-editor-module`、`git diff --check`；只有修改 index.html 时补 `npm run verify:script-order`。没有 Host 保存需求，不把后台可用性放进本项审核。

交接记录容器颜色来源、保留几何、删掉的装饰和浏览器结果；符合上述标准即 D03 PASS。
