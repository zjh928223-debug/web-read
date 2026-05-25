## ADDED Requirements

### Requirement: Annotation API profiles MUST use explicit platform semantics
系统 MUST 以显式 `platform` 作为 Annotation API profile 的核心运行语义，而不是继续把用户主语义建立在 `provider` 术语上。平台 MUST 由用户显式选择，系统 MUST NOT 根据 `apiKey`、`model` 或 `baseUrl` 自动猜测平台。

#### Scenario: User explicitly selects a platform
- **WHEN** 用户在 Annotation API Settings 表单中编辑一个 profile
- **THEN** 系统 MUST 提供显式的平台选择字段
- **AND** 当前 profile 的运行语义 MUST 以该字段为准
- **AND** 系统 MUST NOT 根据 `apiKey`、`model` 或 `baseUrl` 文本自动反推平台

### Requirement: Platform defaults MUST define the default baseUrl
系统 MUST 维护集中式的平台默认 `baseUrl` 映射，并用该映射为 profile 提供默认 `baseUrl`。默认值映射 MUST NOT 散落在多个 UI 组件中重复维护。

#### Scenario: Default baseUrl follows selected platform
- **WHEN** 用户新建 profile 或将 profile 的平台切换为某个受支持平台
- **THEN** 系统 MUST 自动为该 profile 带出该平台的默认 `baseUrl`
- **AND** 如果用户尚未启用自定义 `baseUrl`
- **THEN** `baseUrl` MUST 跟随平台切换而更新

### Requirement: Custom baseUrl MUST remain opt-in and reversible
系统 MUST 区分“跟随平台默认 `baseUrl`”和“用户手动覆盖 `baseUrl`”两种状态。只有用户显式编辑 `baseUrl` 时，系统才可将其视为 custom；当用户将 `baseUrl` 恢复为当前平台默认值时，系统 MUST 允许重新回到非 custom 状态。

#### Scenario: User overrides baseUrl in advanced settings
- **WHEN** 用户打开高级设置并手动修改当前 profile 的 `baseUrl`
- **THEN** 系统 MUST 将该 profile 标记为 custom `baseUrl`
- **AND** 之后切换平台时 MUST NOT 静默覆盖用户自定义的 `baseUrl`

#### Scenario: User returns to platform default baseUrl
- **WHEN** 当前 profile 处于 custom `baseUrl` 状态
- **AND** 用户将 `baseUrl` 改回当前平台的默认值
- **THEN** 系统 MUST 允许该 profile 回到跟随默认值的状态

### Requirement: Platform support MUST be represented honestly
系统 MUST 仅把当前真实支持调用的平台视为可运行平台。平台语义的出现 MUST NOT 让用户误以为未接通的 API 平台已经可用。

#### Scenario: Unsupported platform is not treated as runnable
- **WHEN** 某个平台尚未被当前运行时 API client 真正支持
- **THEN** 系统 MUST NOT 将该平台视为 ready/configured 的可运行平台
- **AND** 系统 MUST NOT 让用户误以为选择该平台后可以直接完成真实 API 调用
