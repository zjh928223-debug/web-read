## ADDED Requirements

### Requirement: Restore diagnostics records which generated data was read back
页面初始化与 annotation restore 流程 MUST 在 diagnostics 中记录其实际读取了哪些 generated/status 存储 key，以及读取后内存中的 generated item 数量和当前 scope。

#### Scenario: Refresh restore reveals generated readback
- **WHEN** 用户刷新页面、重新打开文章，或 reader 初始化时执行 annotation restore
- **THEN** diagnostics 输出 MUST 记录本次 restore 读取的 generated key 和 status key
- **AND** diagnostics 输出 MUST 记录读取后的 generated item 数量
- **AND** diagnostics 输出 MUST 记录恢复时使用的 `audioKey`、`documentId` 与 `scopeKey`

### Requirement: Entry and render diagnostics reveal scope mismatches and final visible counts
entry/status refresh、generated index refresh 与最终页面消费 MUST 在 diagnostics 中暴露 scope 一致性与最终可消费 annotation 数量，以支持判断数据是“没读回来”还是“读回来了但没显示出来”。

#### Scenario: Generated index refresh exposes current scope and item count
- **WHEN** 页面执行 generated annotation index refresh
- **THEN** diagnostics 输出 MUST 记录当前 refresh 使用的 `scopeKey`
- **AND** diagnostics 输出 MUST 记录 indexed generated item 数量
- **AND** diagnostics 输出 MUST 能看出 refresh 结果是否因 scope stale 被丢弃

#### Scenario: Final page consumption exposes render-side availability
- **WHEN** 页面最终进入可交互状态，或用户点击需要消费 generated annotation 的词项
- **THEN** diagnostics 输出 MUST 记录当前页面可消费的 generated annotation 数量或等价计数
- **AND** diagnostics 输出 MUST 能辅助判断 render/click 层是否因为 scope 或索引状态而未显示已有数据
