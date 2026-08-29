## 已完成历史（不在本轮返工）

- [x] H1（原 1.1–1.6）冻结 optimization workspace 基线、六域 ownership/inventory、browser direct-writer map、核心 baseline journeys 和 Windows-only/Schema-freeze non-goals。
- [x] H2（原 2.1–2.7）建立 owner registry、Host-managed repository contract、profile lease、typed API envelope、receipt、readiness/auth 和 fail-closed 基础。
- [x] H3（原 3.1–3.5）建立 browser typed client/status、legacy read-only bridge、MediaResourceOwner capability/no-copy seam，以及 Node/Python/browser focused checks。
- [x] H4（原 4.1）建立 `ReaderSessionOwner` 的 query、prepare/commit/restore、可恢复 snapshot、CAS/receipt、atomic write 和直接行为测试；保持生产 `/api/app/owner` pre-cutover/not-ready。

## A. 完成剩余五域最小 Host repository seam

- [x] A 为 `vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity`、`workflow` 各提供必要的 canonical record、query、command、revision/CAS 和 receipt seam，并在隔离 profile 中验证正常读写、相同 key 重试、明显 revision conflict、坏输入拒绝和旧值保留；复用现有 registry、auth、repository 和 receipt，不接入 browser UI writer，完整媒体/token/任意路径/纯 UI 状态不进入 durable record。

## B. 最小备份、恢复与一次性迁移

- [x] B 为六域按 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed` 实现一次性迁移、restore dry-run/execute 和每域 rollback target；freeze 前可做预备 backup/dry-run，但用于切换的最终 backup/checksum 与唯一正式 copy/import 必须在 freeze 后取得/执行。目标固定为 Host-managed repository，未知/损坏/冲突或写入失败保留旧值并阻止受影响域继续写入，完整媒体只保留 identity/reference metadata，`SeekPlayerDB v1/files/id` 不变。已完成为隔离、pre-cutover seam；实际 production writer switch 留给 C2。

## C. 先 Reader Session，再逐域切换 writer

- [x] C1 将 Reader Session loader 与 media 使用接到已完成 owner seam，验证正常启动、材料切换、播放/seek、失效媒体 rebind、Host restart/reopen 和旧 session 保留；继续保持薄入口、script order 和 no-copy。
- [ ] C2 按 `Reader Session → marks-activity → passage-preview → annotation → vocabulary-srs → workflow` 逐域执行 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed`；freeze 前只允许只读 inventory、预备 backup 或 dry-run，正式切换用的 final backup/checksum 和唯一正式 copy/import 必须在 freeze 后取得/执行；切换后 compatibility path 只读，不保留长期双写。

## D. 核心验证、旧 writer 收敛与文档

- [ ] D 运行正常 build/启动、核心 Reader/workflow journey、单用户 retry/CAS、backup/restore/reopen、Range/no-copy 和直接失败保留旧值检查；通过后删除或隔离已切换 domain 的 direct browser writer，更新 `CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md`、owner/API contract、backup/recovery 说明和本 change 实际状态；不执行外部 production shortcut。

## 明确移出未来范围（不是已完成任务）

以下内容不再作为本 change 的待办：穷举 fault matrix 和多阶段 pending evidence 组合；multi-tab、多 writer、高并发、late response、offline、双击全矩阵；六域 global transaction、material publish 和复杂 cutover coordinator；shadow/diff/canary/drain/no-in-flight 多层流程；30 分钟 soak、三次冷启、heap/Long Task/完整性能预算；release manifest、previous-release 自动恢复、clean-room/trace/screenshot/machine-readable 证据归档和正式 release review。已有基础设施可以继续被上述最小任务复用，但不再扩展这些能力。
