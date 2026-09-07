## MODIFIED Requirements

### Requirement: Reader Session 必须通过 prepare/commit 原子切换
系统 SHALL 将 manifest、transcript、chunk、media identity 与其他小型会话数据作为同一次 `ReaderSessionLoad` 的候选快照并行 prepare；只有全部必需数据通过 `contentId`、revision 与结构校验后，系统才能 commit 并切换当前 Reader Session。本地兼容模式 MAY 继续使用单个 `SeekPlayerDB/files` readwrite transaction；remote mode MUST 通过 Windows Reader Session owner command 与 receipt 完成 canonical commit。canonical marks MUST 由 `marks-activity` 独立提交，Reader Session commit MUST NOT覆盖 marks。任何 prepare 或 commit 失败 MUST 保留原会话及其播放位置，不得暴露半新半旧状态。

#### Scenario: 新材料中的 transcript 无效
- **WHEN** 新材料的 media 与 manifest 可用但 transcript 未通过结构或 `contentId` 校验
- **THEN** 系统 MUST拒绝候选 Reader Session
- **THEN** 当前材料、transcript、chunk、marks 与播放位置 MUST保持不变
- **THEN** 候选数据 MUST NOT部分写入本地或 Windows canonical storage

#### Scenario: remote mode 原子提交成功
- **WHEN** 候选会话的所有必需小型资源均已校验且 Windows owner 返回 committed receipt
- **THEN** UI MUST只观察到一次从旧 session revision 到新 session revision 的切换
- **THEN** transcript、chunk 与 media identity MUST属于同一个 `contentId` 和 session revision
- **THEN** marks MUST通过 `marks-activity` revision 独立解析

#### Scenario: remote mode commit 结果未知
- **WHEN** transport 中断导致 Reader Session command 返回或推断为 `commit-unknown`
- **THEN** 客户端 MUST使用原 idempotency identity 查询 receipt 或 authoritative revision
- **THEN** 客户端 MUST NOT回退到 IndexedDB canonical write
