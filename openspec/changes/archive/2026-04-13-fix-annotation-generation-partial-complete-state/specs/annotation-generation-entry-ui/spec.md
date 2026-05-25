## ADDED Requirements

### Requirement: Entry UI MUST not present incomplete generation as complete

page-level annotation generation entry MUST 忠实反映 controller 返回的 target completeness 语义。若 controller 判定本次运行后仍有 missing targets，entry UI MUST NOT 继续显示 `complete` 或等价完成语义。

#### Scenario: Entry shows non-complete state when targets remain missing

- **WHEN** controller 返回的 result 表示本次运行后仍存在 missing targets
- **THEN** entry UI MUST 使用对应的非完成状态与消息
- **AND** entry UI MUST NOT 将其显示成“已完成全文生成”

### Requirement: Entry result messaging MUST distinguish true completion from still-missing outcomes

entry UI 的 result message MUST 区分“全部 target 已生成完成”与“本次运行没有报错但仍有 target 未补齐”这两种不同结果。

#### Scenario: Result message stays honest after partial provider output

- **WHEN** provider request 成功返回，但最终 generated bundle 仍未覆盖所有 requested targets
- **THEN** entry UI MUST 显示仍需继续补生成的语义
- **AND** entry UI MUST NOT 复用真正 `complete` 的文案
