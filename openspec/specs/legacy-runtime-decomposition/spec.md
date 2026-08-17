# legacy-runtime-decomposition Specification

## Purpose
Defines the stage-gated cleanup constraints for removing the former root `app.js` runtime shell and keeping remaining reader runtime assembly behind focused module owners.
## Requirements
### Requirement: Decomposition must be stage-gated
系统 SHALL 按阶段迁移 `app.js` 职责，并且每个阶段 MUST 有明确迁移范围、禁止事项、验证命令和继续条件。

#### Scenario: Stage completes before next stage starts
- **WHEN** 一个阶段的迁移工作完成
- **THEN** 该阶段定义的验证命令 MUST 通过
- **THEN** 下一个阶段 MUST NOT 开始，直到当前阶段的验证结果已记录

#### Scenario: Mixed high-risk changes are blocked
- **WHEN** 一个变更同时触及 playback highlight、AI chunk rendering、chunk note interaction、session restore 或 annotation glue 中两个以上高风险区域
- **THEN** 该变更 MUST 被拆成更小的阶段或任务

### Requirement: New feature logic must not enter app.js during cleanup
系统 SHALL 在 `app.js` 清空期间冻结新增用户功能入口。任何新业务逻辑 MUST 放入 `src/utils/`、`src/services/`、`src/composables/`、`src/pinia-stores/` 或 Vue components 中，除非只是为了兼容 legacy caller 的薄 facade。

#### Scenario: Adding a required compatibility wrapper
- **WHEN** 迁移期间必须保留 legacy `window.*` caller
- **THEN** `app.js` MAY 保留或新增薄 wrapper
- **THEN** wrapper MUST delegate 到外部 module
- **THEN** wrapper MUST NOT 持有新的业务规则

#### Scenario: Attempting to add feature behavior to app.js
- **WHEN** 清理期间需要实现新的 reader 行为
- **THEN** 实现 MUST NOT 直接加入 `app.js`
- **THEN** 该行为 MUST 先定义外部 owner module 或 Pinia/Vue owner

### Requirement: Runtime map must be maintained before extraction
系统 SHALL 在迁移前维护当前 runtime map，覆盖 `app.js` exports、`window.__state` properties、`window.__bridge` fields、`index.html` inline handlers、root regular scripts 和验证覆盖范围。

#### Scenario: Starting a migration stage
- **WHEN** 一个新的迁移阶段开始
- **THEN** 该阶段 MUST 引用当前 runtime map 中相关 exports、state fields、DOM handlers 或 scripts
- **THEN** 该阶段 MUST 说明迁移完成后哪些入口保留、降级或删除

#### Scenario: Removing a compatibility entry
- **WHEN** 一个 `window.*` export、`window.__state` property 或 inline handler 准备删除
- **THEN** runtime map MUST 显示没有剩余消费者
- **THEN** 删除提交 MUST 包含对应验证结果

### Requirement: Extracted logic must preserve behavior until intentional removal
系统 SHALL 在迁出 helper、subsystem 或 facade 时保持现有用户可见行为不变，除非该阶段明确标记为 intentional removal。

#### Scenario: Pure helper extraction
- **WHEN** 纯 helper 从 `app.js` 迁出
- **THEN** 新 helper MUST 通过显式参数接收依赖
- **THEN** 新 helper MUST NOT 直接依赖 DOM、`audioPlayer.currentTime`、`window.__state` 或 import-time side effects
- **THEN** 原调用方 MUST 保持等价返回值和错误行为

#### Scenario: Subsystem extraction
- **WHEN** chunk note、sentence note、annotation lightweight glue 或 keyboard/event boundary 被迁出
- **THEN** 新 module MUST 暴露明确 public API
- **THEN** `app.js` facade MUST 只负责 legacy delegation
- **THEN** facade MUST 有删除条件

### Requirement: State ownership must move away from app.js before state facades are removed
系统 SHALL 先迁移真实 state source，再删除 `window.__state` 或 `window.__bridge` 兼容层。`window.__state` 和 `window.__bridge` MUST 从真实状态中心降级为 compatibility facade。

#### Scenario: Migrating a state domain
- **WHEN** transcript、chunk、cloze、playback、chunk note 或 sentence note state 从 `app.js` 迁出
- **THEN** 迁移任务 MUST 指定新的 state owner
- **THEN** `app.js` local variable MUST NOT 继续作为该 state domain 的真实来源
- **THEN** legacy callers 需要时 MUST 通过 facade 读写新的 state owner

#### Scenario: Removing bridge state
- **WHEN** 一个 `window.__bridge` field 准备删除
- **THEN** Vue/Pinia startup flow MUST 已经不依赖该 field
- **THEN** 删除后 `npm test` MUST 通过

### Requirement: DOM and event ownership must move after state ownership is stable
系统 SHALL 在相关 state owner 明确后迁移 DOM/event ownership。inline handlers、legacy DOM bindings 和 legacy render paths MUST 逐步迁移到 Vue components 或集中 DOM bindings module。

#### Scenario: Removing an inline handler
- **WHEN** `index.html` 中的 inline `onclick` 或 `oninput` 准备删除
- **THEN** 替代事件绑定 MUST 已存在于 Vue component 或明确 module 中
- **THEN** 原交互路径 MUST 被现有或新增验证覆盖

#### Scenario: Changing script order
- **WHEN** `index.html` script order 准备调整
- **THEN** 该调整 MUST 作为单独验证点处理
- **THEN** `npm test` 和 `npm run build` MUST 通过

### Requirement: Root regular scripts must be migrated through Vite module ownership
系统 SHALL 将可迁移的 root regular scripts 迁入 Vite module graph，并在不再需要 production copy 后删除 build copy logic。

#### Scenario: Migrating a root regular script
- **WHEN** `chunk-note-layout-helpers.js`、`chunk-note-layout-core.js`、`annotation-bubble.js` 或 `annotation-api-settings-ui.js` 准备迁移
- **THEN** 迁移任务 MUST 识别所有 runtime consumers
- **THEN** 新 module MUST 在 Vite dev 和 production build 中加载
- **THEN** `npm run build` MUST 通过

#### Scenario: Removing legacy copy logic
- **WHEN** `vite.config.js` 中的 root script copy logic 准备删除
- **THEN** 所有被复制脚本 MUST 已经不再由 `index.html` 作为 root regular script 加载
- **THEN** production build output MUST 仍能通过 load verification

### Requirement: app.js may be deleted only after all compatibility dependencies are gone
系统 SHALL 只在所有 legacy compatibility dependencies 已迁移或删除后删除 `app.js`。

#### Scenario: Final deletion readiness
- **WHEN** 准备删除 `app.js`
- **THEN** `index.html` MUST 不再加载 `app.js`
- **THEN** 没有 inline handler MUST 调用 `app.js` exports
- **THEN** 没有 runtime module MUST 依赖 `window.__state` 作为真实 state source
- **THEN** `window.__bridge` MUST 不再承担 startup sync

#### Scenario: Final verification
- **WHEN** `app.js` 删除提交完成
- **THEN** `npm test` MUST 通过
- **THEN** `npm run verify:playback` MUST 通过
- **THEN** `npm run verify:interactions` MUST 通过
- **THEN** `npm run build` MUST 通过

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
