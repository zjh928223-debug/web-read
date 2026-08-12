## ADDED Requirements

### Requirement: Reader Session 必须通过 prepare/commit 原子切换
系统 SHALL 将 manifest、transcript、chunk、marks 与其他小型会话数据作为同一次 `ReaderSessionLoad` 的候选快照并行 prepare；只有全部必需数据通过 `contentId`、revision 与结构校验后，系统才能在单个 `SeekPlayerDB/files` readwrite transaction 中 commit 并切换当前 Reader Session。任何 prepare 或 commit 失败 MUST 保留原会话及其播放位置，不得暴露半新半旧状态。

#### Scenario: 新材料中的 transcript 无效
- **WHEN** 新材料的 media 与 manifest 可用但 transcript 未通过结构或 `contentId` 校验
- **THEN** 系统 MUST 拒绝候选 Reader Session
- **THEN** 当前材料、transcript、chunk、marks 与播放位置 MUST 保持不变
- **THEN** 候选数据 MUST NOT 部分写入共享 `files` store

#### Scenario: 原子提交成功
- **WHEN** 候选会话的所有必需小型资源均已校验且 IndexedDB transaction 完成
- **THEN** UI MUST 只观察到一次从旧 session revision 到新 session revision 的切换
- **THEN** transcript、chunk、marks 与 media identity MUST 属于同一个 `contentId` 和 session revision

### Requirement: 会话加载必须可取消且 latest-wins
每次 `ReaderSessionLoad` SHALL 持有唯一 generation id 与 `AbortController`；开始新加载时 MUST 取消旧 generation，且所有异步响应、解析结果和 transaction commit 前 MUST 验证 generation 仍为当前值。用户取消加载 MUST 终止可终止的网络、解析和持久化工作，并不得污染 Material Workflow job status。

#### Scenario: 用户快速连续选择两个材料
- **WHEN** 第一项材料仍在加载且用户选择第二项材料
- **THEN** 第一项加载 MUST 被取消或标记为 stale
- **THEN** 第一项迟到的响应 MUST NOT 更新 UI、播放资源、IndexedDB 或 workflow job
- **THEN** 只有第二项材料可以成为当前 Reader Session

#### Scenario: 用户主动取消当前加载
- **WHEN** 用户在 prepare 阶段执行取消
- **THEN** 系统 MUST 中止该 generation 的未完成请求与解析
- **THEN** 系统 MUST 恢复可交互状态并继续保留原 Reader Session

### Requirement: 大媒体必须通过可 seek 的 URL/Range 流式播放
系统 SHALL 仅为音频和视频保存经过校验的 URL、file handle 或 media identity；大媒体文件 MUST NOT 作为完整 Blob 下载、复制到 `SeekPlayerDB/files`，或在打开 Reader Session 前整文件读入内存。Local App Host 提供的媒体响应 MUST 支持 HTTP Range、`206 Partial Content`、稳定 `Content-Length` 与用于内容变更检测的 ETag 或等价 revision。

#### Scenario: 打开 300MB 以上本地视频
- **WHEN** 用户打开一个 300MB 以上且同时承担音视频来源的材料
- **THEN** 浏览器 MUST 通过 URL/Range 请求开始播放
- **THEN** IndexedDB MUST NOT 新增该媒体的完整 Blob 副本
- **THEN** Reader Session 可用状态 MUST NOT 等待整文件读取完成

#### Scenario: 用户拖动到尚未缓冲的位置
- **WHEN** 用户 seek 到当前缓冲区之外的时间点
- **THEN** media element MUST 能以 Range 请求目标字节区间
- **THEN** 系统 MUST NOT 回退为整文件下载后再 seek

#### Scenario: 媒体文件在两次请求之间发生变化
- **WHEN** 后续 Range 请求的 ETag 或 media revision 与当前 session identity 不一致
- **THEN** 系统 MUST 停止继续拼接不一致内容
- **THEN** UI MUST 要求用户重新绑定或重新打开该材料，而不是静默播放混合版本

### Requirement: 媒体资源必须有唯一生命周期 owner
`MediaResourceOwner` SHALL 是当前 media URL、Object URL、media element 绑定与释放行为的唯一 owner。替换或 dispose 媒体时 MUST 按 pause、清除 `src`、调用 `load()`、revoke Object URL 的顺序清理，并 MUST 保证同一资源只释放一次。

#### Scenario: 连续切换多个本地材料
- **WHEN** 测试连续切换材料并在每次切换后 dispose 旧资源
- **THEN** 旧 media element MUST 不再持有旧 URL
- **THEN** 已创建 Object URL 的数量减去已 revoke 数量 MUST 保持有界
- **THEN** listener、media request 与解码资源 MUST NOT 随切换次数线性增长

#### Scenario: dispose 被重复调用
- **WHEN** unload、路由切换与新 session 提交同时触发同一 owner 的 dispose
- **THEN** dispose MUST 幂等完成
- **THEN** 当前新 session 的媒体资源 MUST NOT 被旧 disposer 释放

### Requirement: Playback 必须只有一个可观测状态 owner
系统 SHALL 由单一 playback controller/store 管理 currentTime、duration、playing、seeking、active sentence 与 active word/chunk index。media events SHALL 是时间状态的权威输入；Vue、Pinia、legacy facade 与直接 DOM 更新 MUST NOT 并行写入等价 playback 状态。

#### Scenario: 播放时间推进并跨越单词边界
- **WHEN** media element 发出时间更新并使 active word 从 A 变为 B
- **THEN** playback owner MUST 只提交一次 active index 变化
- **THEN** 渲染层 MUST 只移除 A 并添加 B 的 active 状态，或只更新包含 B 的虚拟窗口
- **THEN** legacy facade MUST 只读取或委托给 playback owner

#### Scenario: seek 与自动时间更新竞争
- **WHEN** 用户 seek 的同时收到旧位置的延迟 time event
- **THEN** generation 或 seek revision guard MUST 拒绝旧事件
- **THEN** UI、Pinia 与 media element MUST 收敛到同一目标时间

### Requirement: 小型会话资源必须并行获取并可渐进呈现状态
互不依赖的 manifest、transcript、chunk、marks 与 session metadata SHALL 并行获取；系统 MUST 为 loading、ready、canceled、conflict 和 failed 提供明确状态，并 MUST 防止同一 material/session key 的重复 in-flight load。

#### Scenario: 打开已有完整产物的材料
- **WHEN** manifest 指向相互独立的 transcript、chunk 与 marks 资源
- **THEN** 请求 MUST 并行发起而不是逐个串行等待
- **THEN** 同一 material/session key 的重复点击 MUST 复用当前 promise 或被禁止重复提交

#### Scenario: 可选 chunk 不存在
- **WHEN** 必需的 media 与 transcript 有效但可选 chunk 返回 not-found
- **THEN** 系统 MUST 按已定义的降级策略提交普通 transcript session
- **THEN** UI MUST 明确显示 chunk 不可用且允许稍后重试

### Requirement: 会话恢复必须验证引用而不是盲目重放
启动恢复 Reader Session 时，系统 SHALL 校验 envelope schema、session revision、`contentId`、媒体引用可达性和必需小型资源完整性。恢复失败 MUST 隔离失效候选并进入可操作的重新选择流程，不得清空其他学习数据或覆盖最后一个可恢复快照。

#### Scenario: 上次使用的本地媒体已被移动
- **WHEN** 启动时持久化 session 指向不可达的本地媒体路径
- **THEN** 系统 MUST 保留 transcript、marks 与 session metadata 的原值
- **THEN** UI MUST 提供重新绑定媒体或选择其他材料的操作
- **THEN** 系统 MUST NOT 调用全库清空作为恢复手段

#### Scenario: 当前快照损坏但上一快照有效
- **WHEN** 当前 session envelope 校验失败且存在通过 checksum 与 schema 校验的上一快照
- **THEN** 系统 MUST 可在用户可见的恢复状态下加载上一快照
- **THEN** 损坏快照 MUST 保留用于诊断而不能被自动 normalize 后覆盖
