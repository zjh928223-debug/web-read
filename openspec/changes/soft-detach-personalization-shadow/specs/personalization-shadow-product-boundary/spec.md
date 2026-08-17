## ADDED Requirements

### Requirement: 正式产品不得暴露实验性 Shadow 入口
正式 reader、review 页面和 production build MUST 不提供 personalization shadow 的用户入口或独立生产页面。

#### Scenario: 用户打开正式 reader
- **WHEN** 用户通过正式 reader 使用阅读、预习或复习功能
- **THEN** 页面不显示“模型观察”或指向 `personalization-shadow.html` 的入口

#### Scenario: 构建正式生产产物
- **WHEN** 执行 `npm run build`
- **THEN** production inputs 与 `dist` 不包含 `personalization-shadow.html`

### Requirement: 正式复习不得默认运行 Shadow
默认创建的 review UI service MUST 不创建 personalization shadow runner、report repository 或后台 shadow report 任务。

#### Scenario: 正式 App 创建 V2 review service
- **WHEN** `App.vue` 使用默认依赖创建 `createSrsReviewUiService()`
- **THEN** 新建或恢复 V2 session 不会调度 personalization shadow report
- **AND** 正式 review 的 session、attempt、scheduler 与 LearningEvent 行为保持不变

#### Scenario: 实验调用方显式注入 runner
- **WHEN** 测试或实验调用方显式提供 `personalizationShadowRunner` 和 enabled policy
- **THEN** V2 review service 仍可执行隔离的 shadow 任务
- **AND** shadow 失败不得影响正式 ledger 或 attempt persistence

### Requirement: Shadow 实验资产与学习数据必须保留
系统 MUST 保留 personalization shadow 源码、focused verification、显式 dev 实验入口、已有 reports 和 LearningEvent 数据，不得因软剥离执行清理或 IndexedDB migration。

#### Scenario: 开发者验证 Shadow 模块
- **WHEN** 开发者运行 personalization shadow focused verification 或在 dev server 显式打开源实验页面
- **THEN** estimator、planner、report repository 与只读页面仍可独立运行

#### Scenario: 用户已有 Shadow 报告和学习事件
- **WHEN** 软剥离版本首次运行
- **THEN** 系统不删除或改写已有 shadow settings、reports 或 LearningEvent rows
- **AND** IndexedDB 继续使用 version 1、`files` object store 与 `id` key path
