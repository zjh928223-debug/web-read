## Why

当前“模型观察”只能围绕 V2 复习会话生成实验性队列对照，无法覆盖用户实际使用的 legacy 复习，也没有形成可执行的学习诊断与针对性加强闭环。继续将它作为正式产品入口会增加理解成本和后台工作，却不能提供稳定的学习价值，因此应先从正式产品中软剥离。

## What Changes

- 从正式 reader 与 review 界面移除“模型观察”入口。
- 正式运行时不再创建或调度 personalization shadow runner，也不再因为新建 V2 复习会话自动生成 shadow 报告。
- 生产构建不再输出 `personalization-shadow.html`，但保留 shadow 算法、报告 repository、独立页面源码和 focused verification，供后续实验与重构使用。
- 保留现有 LearningEvent 记录链路、已有 shadow 报告和 IndexedDB 数据；本变更不删除或迁移用户数据。
- 提供显式的实验验证入口，使 shadow 模块仍可在测试或未来独立实验环境中运行，而不成为正式产品依赖。

## Capabilities

### New Capabilities

- `personalization-shadow-product-boundary`: 定义正式产品不得暴露或自动运行实验性 personalization shadow，同时保留学习事件与可独立验证的实验代码边界。

### Modified Capabilities

无。

## Impact

- 影响 `src/App.vue`、`src/features/srs-review/SrsReviewPage.vue`、`src/features/srs-review/srs-review-ui-service.js`、`vite.config.js` 及相关 focused verification。
- `src/services/vocabulary/personalization/`、`src/features/personalization-shadow/` 与 `src/personalization-shadow-main.js` 保留，但不再进入正式 reader/review 运行路径或生产多页面构建。
- 不改变正式 SRS 排程、LearningEvent 持久化、IndexedDB version 1、`files` object store 或已有用户数据。
