# annotation-generation-chain-diagnostics Specification

## Purpose
TBD - created by archiving change add-annotation-generation-chain-diagnostics. Update Purpose after archive.
## Requirements
### Requirement: Annotation generation chain diagnostics emits traceable lifecycle events
系统 MUST 为 annotation 的 generate、merge、save、restore、render 全链路提供统一的诊断事件输出。每个诊断事件 MUST 至少携带当前 `audioKey`、`documentId` 与 `scopeKey`，以便把同一篇文章的一次完整链路串起来。

#### Scenario: One document run can be traced across layers
- **WHEN** 系统对同一篇文章执行初始生成、增量生成、刷新恢复或页面重新进入
- **THEN** diagnostics 输出 MUST 能用同一组 `audioKey`、`documentId`、`scopeKey` 追踪对应链路
- **AND** diagnostics 输出 MUST NOT 仅停留在零散的 UI 点击日志

### Requirement: Diagnostics distinguishes loss by layer instead of guessing
系统 MUST 为 generate、merge、save、restore、render 五层分别提供足够的计数与关键键值输出，使排查者能够区分“模型未返回”“merge 丢失”“保存未写入”“恢复未读回”“渲染未消费”。

#### Scenario: Investigation can separate generate from downstream loss
- **WHEN** 某篇文章最终出现 annotation 缺项
- **THEN** diagnostics 输出 MUST 至少提供 block target 数量、provider 返回数量、merge 前后 item 数量、save/load item 数量与最终 render/index 数量
- **AND** 这些输出 MUST 足以支持按层归因，而不是只能笼统怀疑模型

### Requirement: Diagnostics remains a lightweight developer-facing capability
系统 MUST 将 diagnostics 设计为开发排查能力，而不是新的常驻用户功能。diagnostics MUST 使用最小必要输出，不得引入新的复杂设置中心、远程 telemetry 系统或生产级观测平台。

#### Scenario: Diagnostics does not become a new product surface
- **WHEN** 开发者启用 annotation chain diagnostics 进行排查
- **THEN** 系统 MUST 以轻量日志、薄 helper 或等价最小机制提供输出
- **AND** 系统 MUST NOT 为普通用户新增复杂 diagnostics UI、远程上报或后端依赖

