## Context

personalization shadow 目前同时出现在正式 reader 导航、V2 review service 默认依赖和 Vite 多页面生产构建中。它虽然保持只读，但正式运行时会创建 report repository 与 shadow runner，并可在新建 V2 session 后异步生成报告；与此同时，实际用户主要走 legacy review，页面无法提供可信诊断或练习闭环。

现有 shadow 算法、report repository、独立页面和 focused verification 仍有实验价值，LearningEvent 也是 acquisition/review 架构的长期数据基础。因此本变更需要切断产品依赖，而不是删除实验代码或用户数据。

## Goals / Non-Goals

**Goals:**

- 正式 reader/review 不再展示 personalization shadow 入口。
- 默认 `createSrsReviewUiService()` 不创建 shadow runner，不触发后台报告生成。
- 正式 production build 不输出 `personalization-shadow.html`。
- shadow 源码、纯服务测试、独立 dev 页面和已有持久化数据继续保留。
- LearningEvent 的写入和 V2 review 行为保持不变。

**Non-Goals:**

- 不删除 `src/services/vocabulary/personalization/` 或现有报告。
- 不实现新的“学习诊断”或针对性加强功能。
- 不修改 IndexedDB schema、LearningEvent schema 或 SRS 排程策略。
- 不归档或重写现有 personalization 研究结论。

## Decisions

### 1. 采用软剥离而非删除模块

移除正式入口与默认运行依赖，但保留 `personalization-shadow.html`、`src/personalization-shadow-main.js`、feature/service 源码和 focused verification。开发者仍可在 Vite dev server 中显式打开独立页面或直接运行测试。

替代方案是彻底删除模块；该方案会丢失已验证的 estimator/planner 边界，并使未来学习诊断重建成本上升，因此不采用。

### 2. `createSrsReviewUiService()` 仅接受显式注入的 runner

删除 UI service 内默认创建 report repository 与 shadow service 的逻辑。只有测试或未来实验调用方显式传入 `personalizationShadowRunner` 时，V2 service 才具备运行 shadow 的能力。正式 `App.vue` 不传 runner，也不读取 shadow settings。

这样既切断生产后台工作，又保留 service 层已有的可选注入缝隙和 shadow failure isolation 测试。

### 3. 从 Vite production inputs 移除独立页面

`vite.config.js` 的正式输入只保留 reader 与 standalone SRS review。源 `personalization-shadow.html` 不删除，因此 dev server 的显式实验入口仍然可用，但 `npm run build` 不再生成对应产物。

### 4. 保留事件与报告数据

本变更不清理 settings、reports 或 LearningEvent rows。旧报告即使暂时没有正式 UI，也保持可恢复；未来实验页面重新启用时仍可读取。正式 review 继续记录 LearningEvent，因为该链路独立于 shadow report 生成。

## Risks / Trade-offs

- [直接访问旧 production URL 将返回不存在] → 正式导航先移除，dev 源页面保留；未来重新上线时再恢复 production input。
- [保留实验源码仍有维护成本] → focused verification 继续覆盖纯模块与显式实验入口，避免代码悄然腐化。
- [已有用户不知道功能为何消失] → 当前入口没有稳定价值且没有用户数据删除；未来以“学习诊断”而不是 Shadow 名义重新提供。
- [误删默认 runner 可能影响 V2 review] → 保留显式 runner 注入测试，并验证无 runner 时 session、attempt 与 LearningEvent 行为不变。

## Migration Plan

1. 先加入 boundary verification，证明正式 App、UI service 和 production inputs 不再引用 shadow。
2. 移除 App 入口、settings 依赖和 UI service 默认 runner construction。
3. 从 production inputs 与 clean-room artifact 清单移除 shadow page。
4. 运行 personalization focused checks、SRS V2 checks、Vite/browser verification 和 production build。

回滚只需恢复正式入口、default runner construction 与 Vite input；已有 settings、reports 和 events 均未删除，无需数据恢复。

## Open Questions

无。未来“学习诊断”应作为独立变更重新定义数据资格、能力 taxonomy 和针对性加强闭环。
