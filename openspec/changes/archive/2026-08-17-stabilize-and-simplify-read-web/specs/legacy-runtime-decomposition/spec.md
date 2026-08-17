## ADDED Requirements

### Requirement: 每个运行时领域必须有唯一状态 owner
系统 SHALL 为 playback、transcript、chunk、marks、activity 和 Reader Session 指定唯一 state owner；legacy `window.*`、DOM attribute 和 compatibility store MUST 只做代理，不能并行持有真实状态。

#### Scenario: 迁移 playback 状态
- **WHEN** playback owner 已接管 active index、time 和 playing state
- **THEN** 同一帧 MUST NOT 同时由 legacy module 与 Vue/Pinia 独立写入等价状态
- **THEN** compatibility facade MUST 只委托给新 owner

### Requirement: 初始化模块必须拥有可验证的生命周期
reader/session assembly SHALL 收集每个 runtime module 返回的 disposer，并在重建或卸载时逆序执行；新增 listener、timer、rAF、observer 或 Object URL 的 Module MUST 提供释放路径。

#### Scenario: 重复初始化 reader runtime
- **WHEN** 测试连续初始化、dispose 再初始化 reader runtime
- **THEN** listener、timer、observer 和 rAF 数量 MUST NOT 随次数增长
- **THEN** 交互 MUST 只执行一次

### Requirement: 退役 compatibility 必须按消费者为零删除
系统 SHALL 删除 disabled notes no-op chain、已无加载者的 root artifacts 和无消费者的 `window.*` surface；不得为已移除功能继续组装假的 Interface。

#### Scenario: 删除 notes compatibility
- **WHEN** 静态 consumer map、runtime call counter 和关键 journey 均证明 notes API 无调用者
- **THEN** notes runtime、session wrapper、deps 和 facade MUST 在同一边界变更中删除
- **THEN** 仍有真实副作用的 `applyCurrentAudioMeta` MUST 迁入明确 owner

### Requirement: 巨型依赖参数袋必须按行为域深化
reader/session 顶层 assembly SHALL 只负责初始化顺序和生命周期，不得继续传递等价于实现细节的超宽 global/DOM 参数袋。

#### Scenario: 收窄 reader feature assembly
- **WHEN** import、controls、interaction、keyboard 或 app runtime 被迁移
- **THEN** 每个领域 MUST 通过小 Interface 获取其 owner 和行为
- **THEN** 顶层 MUST NOT 重新创建近似相同的 50+ 字段映射

### Requirement: Compatibility 删除必须通过行为门禁
系统 SHALL 在删除每个 facade 或调整 script order 前执行对应行为 journey、production build 和 startup error checks；source text assertion 不能作为唯一证据。

#### Scenario: 删除 window facade
- **WHEN** 一个 `window.*` facade 准备移除
- **THEN** consumer map MUST 为零
- **THEN** 相关 browser behavior journey 与 production startup MUST 通过
