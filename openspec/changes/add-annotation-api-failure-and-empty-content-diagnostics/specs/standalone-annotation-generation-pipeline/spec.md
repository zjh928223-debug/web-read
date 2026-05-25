## ADDED Requirements

### Requirement: Provider request diagnostics MUST classify failure types and timing

annotation generation pipeline MUST 为每次 provider request 记录请求开始时间、结束时间、耗时、是否真正发出 request、HTTP status、provider 错误码、错误消息与 error body 安全摘要。系统 MUST 将失败至少归类为网络错误、超时、abort、429、5xx、解析失败、normalize 后为空或未知失败。

#### Scenario: Failed provider request produces classified diagnostics
- **WHEN** 某个 generation block 的 provider request 失败或返回不可用结果
- **THEN** diagnostics MUST 记录该 request 的 `runId`、`blockId`、attempt、`targetCount`、起止时间与耗时
- **AND** diagnostics MUST 记录失败类型分类与最关键错误原因

### Requirement: Post-provider diagnostics MUST expose returned, normalized, merge, and save outcomes together

annotation generation pipeline MUST 在 provider request 完成后继续记录 `returnedCount`、`normalizedCount`、merge 前后 itemCount、save 是否成功、保存目标与 save 后 generated bundle itemCount，以支持区分“provider 少回”“normalize 过滤为空”“merge 没写入”“save 没落盘”。

#### Scenario: One block can be traced from response to save
- **WHEN** 一个 block 完成了一次 provider 调用并进入 normalize、merge、save
- **THEN** diagnostics MUST 记录该 block 的 `returnedCount` 和 `normalizedCount`
- **AND** diagnostics MUST 记录 merge 前后 itemCount 与 save 成功或失败结果
