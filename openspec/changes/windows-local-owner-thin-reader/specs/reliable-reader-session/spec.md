## MODIFIED Requirements

### Requirement: Reader Session 必须通过 prepare/commit 原子切换

系统 SHALL 通过 Windows `ReaderSessionOwner` 将 manifest、transcript、chunk、marks reference、`contentId`、session revision 和 media identity 作为小型候选 snapshot 校验。只有候选完整且 owner commit receipt 成功后，Host-managed repository 才能替换 canonical session；prepare、CAS、写入或 receipt 失败 MUST 保留旧 session 和旧值，不得暴露半新半旧状态。legacy `SeekPlayerDB/files` adapter 只可用于 inventory、一次性 import 或 rollback compatibility，并遵守现有 v1/files/id boundary。

#### Scenario: 新材料校验失败

- **WHEN** transcript、chunk、contentId、media identity 或 session revision 未通过校验
- **THEN** `ReaderSessionOwner` MUST 拒绝候选
- **THEN** 当前 session、transcript、chunk、marks reference 和旧值 MUST 保持不变

#### Scenario: 原子提交成功或结果未知

- **WHEN** 候选通过校验并取得 committed receipt
- **THEN** transcript、chunk、marks reference 和 media identity MUST 属于同一个 `contentId` 与 session revision
- **THEN** receipt 未确认、owner not-ready 或 revision conflict 时 browser MUST 保留旧 session，不得写 local fallback

### Requirement: 大媒体必须通过可 seek 的 URL/Range 流式播放

系统 SHALL 仅保存音频/视频的 media identity、size、content type、ETag/revision 和 authorized reference；大媒体 MUST NOT 作为完整 Blob/ArrayBuffer/bytes 下载、复制到 `SeekPlayerDB/files`、repository、JSON 或 migration buffer。Local App Host 的媒体响应 MUST 支持 HTTP `Range`、`206 Partial Content`、`Content-Range`、`Accept-Ranges` 和稳定 ETag/等价 revision。

#### Scenario: 打开或 seek 大媒体

- **WHEN** 用户打开本地媒体或 seek 到当前缓冲区之外
- **THEN** browser media element MUST 直接使用 Host 授权 URL 发起范围请求
- **THEN** Reader Session MUST 不等待整文件读取，也 MUST NOT 回退为 full-file download

#### Scenario: 媒体 identity 发生变化

- **WHEN** 后续 Range response 的 ETag、identity 或 media revision 与当前 session 不一致
- **THEN** 系统 MUST 停止继续使用不一致内容，并返回 rebind/not-found
- **THEN** 系统 MUST NOT 拼接不同 revision，也不得删除 Reader Session

### Requirement: 会话恢复必须验证引用并保留旧值

启动或显式 restore Reader Session 时，Windows owner SHALL 校验 envelope schema、session revision、`contentId`、media reference 和必需小型资源 checksum。恢复失败 MUST 保留最后一个可读 snapshot，并进入可操作的重新选择、rebind 或 recovery 状态；browser 不得直接 writer 接管。

#### Scenario: 当前快照损坏但上一快照有效

- **WHEN** 当前 session 校验失败且 previous snapshot 通过 schema/checksum 校验
- **THEN** 系统 MAY 在恢复状态下提供 previous snapshot
- **THEN** 损坏数据 MUST 保留用于诊断，不能被自动 normalize 覆盖

#### Scenario: 本地媒体不可达

- **WHEN** session 的 media reference 指向已移动、删除或 identity 不匹配的文件
- **THEN** 系统 MUST 保留 transcript、marks 和 session metadata
- **THEN** UI MUST 提供 rebind/重新选择操作，不得清空其他学习数据或写入 browser fallback
