## ADDED Requirements

### Requirement: Startup restore MUST keep transcript inputs available before annotation restore runs
annotation generation entry 所依赖的页面 restore 流程在正常启动时 MUST 保留 transcript、marks 与其它 reader 输入，直到 `restoreSession()` 完成读取。system MUST NOT 在默认 startup 路径里先清空这些输入，再进入 annotation restore。

#### Scenario: Refresh no longer falls back to empty reader state before restore

- **WHEN** 用户刷新页面或重新打开同一篇文章
- **THEN** 页面在 annotation restore 之前 MUST 仍然能够读取之前保存的 transcript 与 reader 输入
- **AND** 页面 MUST NOT 因启动时提前清空 reader 内容而退化成 `words = 0` 或直接回到空白 reader 状态

### Requirement: Restore diagnostics MUST show aligned scope for save and restore
entry UI 相关的 diagnostics 在本 change 修复后 MUST 继续暴露 save scope、restore scope 与 generated index refresh 的关键证据，便于验证同一篇文章在刷新前后的 scope 是否一致。

#### Scenario: Diagnostics confirm save scope equals restore scope

- **WHEN** 用户在当前会话里生成 annotation，随后刷新页面并触发 restore
- **THEN** diagnostics MUST 能显示保存 generated bundle 的 scope 与恢复 generated bundle 的 scope 一致
- **AND** diagnostics MUST 能显示 generated bundle 已按该 scope 被重新 load 与 index
