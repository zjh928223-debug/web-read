## MODIFIED Requirements

### Requirement: Reader Session 必须通过 prepare/commit 原子切换
系统 SHALL 通过 Windows `ReaderSessionOwner` 将 manifest、transcript、chunk、marks 引用与其他小型会话数据作为同一次 `ReaderSessionLoad` 的候选快照并行 prepare；只有全部必需数据通过 `contentId`、revision 与结构校验后，owner 才能将 canonical session commit 到 Windows Host-managed repository，并向 browser 返回新的 authoritative session revision。任何 prepare 或 commit 失败 MUST 保留原会话及其播放位置，不得暴露半新半旧状态。若使用 legacy `SeekPlayerDB/files` adapter，该 adapter 只能用于 inventory、一次性 import 或 rollback-window compatibility read，且仍 MUST 遵守现有 v1/files/id transaction boundary。

#### Scenario: 新材料中的 transcript 无效
- **WHEN** 新材料的 media 与 manifest 可用但 transcript 未通过结构或 `contentId` 校验
- **THEN** `ReaderSessionOwner` MUST 拒绝候选 Reader Session
- **THEN** 当前材料、transcript、chunk、marks 与播放位置 MUST 保持不变
- **THEN** 候选数据 MUST NOT 部分写入 Host-managed repository 或共享 `files` store

#### Scenario: 原子提交成功
- **WHEN** 候选会话的所有必需小型资源均已校验且 owner transaction/profile commit 完成
- **THEN** UI MUST 只观察到一次从旧 session revision 到新 session revision 的切换
- **THEN** transcript、chunk、marks 与 media identity MUST 属于同一个 `contentId` 和 session revision

#### Scenario: browser 收到 session commit receipt
- **WHEN** owner 返回已提交 revision 和 session receipt
- **THEN** browser MUST 只缓存该 authoritative revision 的候选资源并切换 Reader Session
- **THEN** receipt 未确认、owner not-ready 或 revision conflict 时 browser MUST 保留旧 session 且 MUST NOT 直接写本地 fallback 或让 bridge 执行 commit

### Requirement: 大媒体必须通过可 seek 的 URL/Range 流式播放
系统 SHALL 仅为音频和视频保存经过 owner 校验的 URL、file handle 或 media identity；大媒体文件 MUST NOT 作为完整 Blob 下载、复制到 `SeekPlayerDB/files`，或在打开 Reader Session 前整文件读入内存。Local App Host 提供的媒体响应 MUST 支持 HTTP Range、`206 Partial Content`、稳定 `Content-Length` 与用于内容变更检测的 ETag 或等价 revision；API backup/migration MUST 只保存 identity metadata。

#### Scenario: 打开 300MB 以上本地视频
- **WHEN** 用户打开一个 300MB 以上且同时承担音视频来源的材料
- **THEN** 浏览器 MUST 通过 host 授权 URL/Range 请求开始播放
- **THEN** IndexedDB、owner repository 和 backup artifact MUST NOT 新增该媒体的完整 Blob 副本
- **THEN** Reader Session 可用状态 MUST NOT 等待整文件读取完成

#### Scenario: 用户拖动到尚未缓冲的位置
- **WHEN** 用户 seek 到当前缓冲区之外的时间点
- **THEN** media element MUST 能以 Range 请求目标字节区间
- **THEN** 系统 MUST NOT 回退为整文件下载后再 seek

#### Scenario: 媒体文件在两次请求之间发生变化
- **WHEN** 后续 Range 请求的 ETag 或 media revision 与当前 session identity 不一致
- **THEN** 系统 MUST 停止继续拼接不一致内容
- **THEN** UI MUST 要求用户重新绑定或重新打开该材料，而不是静默播放混合版本

### Requirement: 会话恢复必须验证引用而不是盲目重放
启动恢复 Reader Session 时，Windows owner SHALL 校验 envelope schema、session revision、`contentId`、媒体引用可达性和必需小型资源完整性。恢复失败 MUST 隔离失效候选并进入可操作的重新选择或 rebind 流程，不得清空其他学习数据、覆盖最后一个可恢复快照或让 browser 直接 writer 接管。

#### Scenario: 上次使用的本地媒体已被移动
- **WHEN** 启动时 owner 持久化 session 指向不可达的本地媒体路径
- **THEN** 系统 MUST 保留 transcript、marks 与 session metadata 的原值
- **THEN** UI MUST 提供重新绑定媒体或选择其他材料的操作
- **THEN** 系统 MUST NOT 调用全库清空或 browser fallback write 作为恢复手段

#### Scenario: 当前快照损坏但上一快照有效
- **WHEN** 当前 session envelope 校验失败且存在通过 checksum 与 schema 校验的上一快照
- **THEN** 系统 MUST 可在用户可见的恢复状态下加载上一快照
- **THEN** 损坏快照 MUST 保留用于诊断而不能被自动 normalize 后覆盖

#### Scenario: owner recovery 尚未完成
- **WHEN** host 启动发现 Reader Session pending journal、未知 schema 或缺少 committed revision evidence
- **THEN** host MUST 保持 not-ready，browser MUST 保留当前 ephemeral 状态或显示 recovery-required
- **THEN** browser MUST NOT 从本地 durable copy 猜测并恢复一个新的 authoritative session
