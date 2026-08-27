## ADDED Requirements

### Requirement: Migration 必须通过已注册 adapter 覆盖六个 domain
Windows backup、import 和 owner migration SHALL 使用为 `reader-session`、`vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity` 和 `workflow` 注册的 adapter。Manifest MUST 记录 format/schema compatibility、release identity、per-domain/per-record counts/checksums、revision、reference 和 media identity metadata。缺失、重复或未认领的 record MUST 阻止 export/import，不能静默丢弃。

#### Scenario: 创建 cutover 前 backup
- **WHEN** 某个 domain 即将从 browser direct writer 转移到 API-authoritative mode
- **THEN** system MUST 完成 read-only inventory，生成 per-domain checksum，并在启用新 writer 前保存与 migration 关联的 rollback backup
- **THEN** backup MUST 包含全部六个 domain entry，即使某个 domain 为零记录，并 MUST 排除 secret、temporary file 和完整 media bytes

#### Scenario: Adapter 无法分类 legacy record
- **WHEN** dry-run inventory 发现 unknown key、future envelope、corrupt payload 或 unclaimed record
- **THEN** migration MUST 返回带 source key/domain/checksum evidence 的 typed blocked result
- **THEN** canonical writer cutover 或 destructive cleanup MAY NOT 开始

### Requirement: Browser durable writer 退役必须有 checkpoint 且可逆
每个 domain migration SHALL 遵循明确的状态机：`inventory → backup/checksum → dry-run/shadow → isolated-host-repository-canary → acquire-profile-lease+journal → freeze/block-old-writer → compatibility-read-only (no commit) → drain-and-verify-no-in-flight → single-atomic-owner-mode-checkpoint → post-cutover-verification/rollback-window → retire`。Isolated canary MUST NOT 写入 production canonical state。在 single checkpoint 之前，Host API MUST NOT 接受 production canonical commit；freeze step MUST 阻断旧 writer，并将 compatibility path 置于 read-only/import-evidence mode；checkpoint MUST 在同一 profile lease/journal transition 中原子记录 `old-writer=blocked`、`compatibility=read-only`、`inFlight=0`、Host-managed repository base/new revision 和 `host-api=authoritative`。checkpoint 之后旧 writer MUST 保持 blocked，且只有 Host-managed repository API MAY commit。Migration MUST 在每个 checkpoint 保存 domain、base revision、release identity、checksum 和 writer mode，且 MUST NOT 启用两个 authoritative writer。

#### Scenario: Domain 进入 API-authoritative mode
- **WHEN** pre-cutover backup、contract gate、shadow comparison 和 isolated Host-repository canary 通过，profile lease/journal 已持有，旧 writer 已 blocked，compatibility path 为 read-only，且 in-flight mutation count 为零
- **THEN** 一个 owner-mode checkpoint MUST 原子记录旧 writer blocked 和 Windows Host-managed repository API authoritative
- **THEN** compatibility path 在 checkpoint 前 MUST 已是 read-only/import-only，checkpoint 后 MUST 继续保持该状态；所有新的 durable write MUST 从 Host-managed repository 获得 receipt

#### Scenario: Owner-mode checkpoint 之前 freeze 或 drain 失败
- **WHEN** 旧 writer 无法被阻断、compatibility path 无法变为 read-only、in-flight mutation 无法得到已知结果，或 single owner-mode checkpoint 无法 commit
- **THEN** Host API MUST NOT 接受 production canonical write
- **THEN** migration MUST 在 journal 证明 freeze 尚未生效时保持 old owner authoritative，或在旧 writer blocked 时保持 not-ready/manual-recovery；MUST NOT 打开 dual-writer window

#### Scenario: Partial cutover 后 migration 停止
- **WHEN** page、host 或 process 在 owner-mode checkpoint 之后、post-cutover verification 完成之前终止
- **THEN** 下一次 startup MUST 从 verified checkpoint 继续，或进入 not-ready/manual-recovery；在 rollback 或完成决定写入 journal 前，旧 writer MUST 保持 blocked
- **THEN** rollback MUST 先阻断新的 Host commit，使用 expected-revision evidence 和关联 rollback backup，且在 Host writer blocked、无 in-flight mutation 之前 MUST NOT 重新启用旧 writer
- **THEN** legacy source MUST 保留到 rollback window 和 post-cutover verification 完成

### Requirement: API-authoritative record 必须位于 Windows Host-managed repository
每个 API-authoritative domain 的最终 canonical durable record MUST 存放在由 Windows Local App Host 管理 lifecycle、lock、transaction、revision、backup 和 recovery 的 repository 中。Repository MAY 由 FastAPI host 或 host-managed Node sidecar 实现，但 browser `IndexedDB`/`localStorage` bridge MUST NOT 成为最终 repository、commit executor 或 canonical writer。Bridge MAY 只提供 read-only inventory、一次性 import input 或 rollback-window compatibility read。

#### Scenario: Host repository 已准备好 owner-mode checkpoint
- **WHEN** Host-managed repository 已 import/validate domain snapshot，暴露 transaction/revision evidence，且 owner-mode checkpoint 成功
- **THEN** 后续所有 API-authoritative write MUST commit 到该 Host-managed repository
- **THEN** browser bridge MUST NOT 接收 canonical commit command，也 MUST NOT 确认 durable success

#### Scenario: 只有 browser persistence bridge 可用
- **WHEN** Host-managed repository 缺失、not-ready 或无法暴露 commit/recovery evidence
- **THEN** domain MUST 按 migration journal 保持 old-owner 或 not-ready/manual-recovery
- **THEN** system MUST NOT 声明 API authority、使用 bridge 作为 final repository，或打开 browser fallback writer

### Requirement: Restore 必须先 dry-run，在可见 profile boundary 原子执行并 fail closed
Restore SHALL 在任何 write 之前校验 artifact checksum、schema support、capacity、reference、per-domain revision 和 conflict。Restore MUST 创建 isolated target、migration-before rollback backup、durable journal 和 corrupt quarantine，并 MUST 只暴露完整的 prior profile 或完整的 restored staged profile。没有明确 resolution 的 unknown/corrupt/conflicting record MUST 阻止 restore。

#### Scenario: Restore artifact 包含较新的 target revision
- **WHEN** dry-run 发现 target record 比 artifact 更新，或 contentId 不兼容
- **THEN** report MUST 标明 domain/record，并提供明确的 `keep`、`restore` 或 `merge` decision
- **THEN** restore MUST NOT 静默覆盖较新的 target，也 MUST NOT 声明成功

#### Scenario: Restore 在应用 domain 期间中断
- **WHEN** process 在一个或多个 domain adapter 已 commit 后终止
- **THEN** startup recovery MUST 使用 journal commit evidence 和 CAS 恢复完整 baseline 或完整 staged revision
- **THEN** 在 recovery result、checksum 和 quarantine evidence 验证完成前，owner read 和 host readiness MUST 保持 blocked

### Requirement: 当前 IndexedDB schema 在迁移期间必须保持 frozen
Migration MUST 继续打开 `SeekPlayerDB` version `1`、object store `files` 和 key path `id`，并 MUST NOT 创建、删除、重命名或重建该 store。Legacy browser record MAY 通过受控 adapter export 或 import，但 schema upgrade、destructive cleanup 或 physical replacement 必须是另一个明确授权的 migration change。

#### Scenario: API-first cutover 针对现有 profile 执行
- **WHEN** migration 读取包含 `SeekPlayerDB/files` 的当前 browser profile
- **THEN** migration MUST 在创建 read-only inventory 或 controlled import snapshot 时保留 database/version/store/keyPath 和 unknown key
- **THEN** schema mismatch MUST 阻止 operation，不能触发 `onupgradeneeded` 或 reset

#### Scenario: 未来工作需要 schema change
- **WHEN** implementation 判断 owner migration 必须改变 database schema 才能继续
- **THEN** 当前 migration MUST 停止，并报告需要独立授权的 schema change
- **THEN** 任何 schema change MAY NOT 隐藏在 domain cutover 或 rollback step 中

### Requirement: Recovery rehearsal 必须证明 failure 后的数据和行为
在 domain 或 release 声明完成前，isolated rehearsal MUST 覆盖 per-domain checksum/count recovery、commit boundary 的 process/page termination、transaction abort/quota/disk-full、unknown/corrupt input、revision conflict、repeated restore、host restart、invalid authorization 和 unavailable media identity。Rehearsal MUST 使用隔离的 Windows path，并 MUST 阻止非预期 network access。

#### Scenario: 隔离 real-profile restore/reopen
- **WHEN** 将六域 profile 的 read-only snapshot restore 到临时 isolated target
- **THEN** 重新打开 target MUST 复现每个 domain 的 record/checksum，并通过 Reader、Vocabulary/SRS、Preview、Annotation、marks/activity 和 workflow journey
- **THEN** source profile、daily port/data root 和完整 media bytes MUST 保持不变，或按声明的 media-reference policy 排除

#### Scenario: Fault injection 导致 recovery evidence 未解决
- **WHEN** fault 导致 commit evidence 或 rollback verification 无法建立
- **THEN** host MUST 返回 `manual-recovery`/not-ready，并保留 journal、backup 和 quarantine evidence
- **THEN** verification MUST 失败，不能把 operation 当作 empty、successful 或静默 recovered profile
