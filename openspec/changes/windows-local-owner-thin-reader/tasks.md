## 1. 冻结 Windows 本机基线与安全范围

- [x] 1.1 在 `read-web-next-optimization` 隔离 worktree 记录当前 git SHA、`config/runtime.optimization.json`、frontend/backend `5184/8776`、隔离 data root、Node/Python/tool versions，并确认 `E:\read-web-next`、`E:\read-web` 与日常数据根未被读取写入。
- [x] 1.2 读取现有 `docs/persistence/application-backup.md`、`CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md` 和四个 modified capability spec，冻结六域当前 record/key/checksum inventory。
- [x] 1.3 生成六域 ownership matrix，逐项列出 canonical record、当前 owner、所有读写 caller、backup adapter、revision source、媒体引用和可回滚 target。
- [x] 1.4 生成 browser direct-writer consumer map，覆盖 `IndexedDB`、`localStorage`、raw JSON/SQLite bridge、`window.*`/DOM facade 与 workflow client；为每个 caller 标记迁移波次和归零 gate。
- [x] 1.5 建立 API-first baseline journeys：冷启、Reader Session、Vocabulary/SRS、Preview、Annotation、marks/activity、workflow、A/B/A、host restart 和大媒体 Range；保存 machine-readable 结果与 checksum。
- [x] 1.6 在 architecture guard 中固定本 change 的 non-goals：不开放 Mac/Tailscale/非-loopback transport、不改变 `SeekPlayerDB v1/files/id`、不修改或丢弃未提交 WhisperX/语言处理文件。

## 2. 建立唯一 owner、lease 与 typed API contract（必须串行）

- [x] 2.1 定义 versioned API envelope、domain/operation registry、requestId/correlationId、expectedRevision、idempotencyKey、commitStatus、receipt 和 typed error schema。
- [x] 2.2 实现六域 owner registry 与 Windows Host-managed repository contract，启动时拒绝缺失、重复、unknown schema、unclaimed row、无 backup/recovery adapter 或无 transaction/revision/recovery evidence 的 profile；browser bridge 不得作为最终 repository。
- [ ] 2.3 将现有 cross-process application-profile lease 接入 Local App Host lifetime、restore、migration cutover 和 owner read；证明同一 profile 不会出现两个 authoritative writer，并让 owner-mode checkpoint 成为唯一 authority switch。
- [ ] 2.4 建立 pending journal、per-domain prepare/commit evidence、baseline/staged recovery 和 recovery-before-ready 状态机；缺少 evidence 时返回 `manual-recovery`。
- [ ] 2.5 将 Host/Origin/loopback binding、instance token、profile capability、path root、revision/idempotency validation 收口到统一 middleware。
- [ ] 2.6 实现 owner commit receipt 查询和 `commit-unknown` 恢复；为 transaction abort、process death、timeout、duplicate retry 和 CAS conflict 建立可重复测试。
- [ ] 2.7 让 health/capability endpoint 区分 liveness、readiness、domain owner status、lease、pending recovery、schema compatibility、Range 和可选依赖，并脱敏 diagnostics。

## 3. 先接入薄 Reader API client 与媒体边界

- [ ] 3.1 增加 browser typed API client，只允许通过 owner query/command/receipt 访问六域 durable state，保留现有 `index.html` script order 和薄 runtime entry 约束。
- [ ] 3.2 将 browser durable status 映射为 `dirty/saving/saved/conflict/commit-unknown/not-ready`，禁止 request success 或本地 cache 直接产生 `saved`。
- [ ] 3.3 为 legacy `SeekPlayerDB/files`、localStorage 和 JSON source 建立只读 inventory/一次性 import/rollback-window compatibility bridge；bridge 不向 UI 暴露 raw store，不接受新 canonical write，不执行 Host repository commit，也不能作为最终 repository。
- [ ] 3.4 复用 `MediaResourceOwner` 与 Local App Host capability mapping，实现 URL/Range/ETag/identity 校验；禁止完整 Blob/ArrayBuffer 进入 API、backup 或 migration path。
- [ ] 3.5 增加 API contract、auth、commit receipt、no-copy、Range 206 和 path/capability boundary 的 Node/Python/browser focused checks。

## 4. 并行建立六域 read/query 与 adapter seam

- [ ] 4.1（可与 4.2–4.6 并行）为 `reader-session` 建立面向 Host-managed repository 的 owner query、prepare/commit/restore facade，输出 `contentId`、session revision、media identity 和可恢复 snapshot。
- [ ] 4.2（可与 4.1、4.3–4.6 并行）为 `vocabulary-srs` 接通写入 Host-managed repository 的 entry、acquisition、review、SRS、learning-event 和当前纳入范围的 personalization query/command seam，复用既有 UoW/CAS。
- [ ] 4.3（可与 4.1–4.6 并行）为 `passage-preview` 接通写入 Host-managed repository 的 durable envelope、continuation/rating/transition batch query/commit，并注册所有 legacy key schema。
- [ ] 4.4（可与 4.1–4.6 并行）为 `annotation` 接通写入 Host-managed repository 的 scoped generated/status/bundle、lightweight import/export 与 corrupt evidence query/commit，保持 ECDICT transient suggestion 非 durable。
- [ ] 4.5（可与 4.1–4.6 并行）为 `marks-activity` 接通写入 Host-managed repository 的 latest-wins ledger、activity idempotency、dirty/saved/error 和 reader reference revision receipt。
- [ ] 4.6（可与 4.1–4.5 并行）为 `workflow` 接通写入 Host-managed repository 的 job snapshot/event/history/reader-index/config query、authorized command、process identity 和 media reference seam；完整媒体仍不进入 backup。
- [ ] 4.7 汇总六个 adapter 的 capability/backup/recovery contract，并增加缺失 adapter、重复 owner、未声明 key 与 revision 不一致的 readiness gate。

## 5. 建立迁移、备份、恢复与故障注入设施

- [ ] 5.1 实现逐域 read-only inventory、migration plan、base revision、release identity、record/domain checksum 和 migration checkpoint。
- [ ] 5.2 让 full backup manifest 强制包含六域，即使某域为零记录；复算 record/domain/manifest/artifact checksum，排除 secret、temporary file 和完整媒体 bytes。
- [ ] 5.3 实现 restore/migration dry-run 的 schema、capacity、reference、contentId、newer revision、unknown/corrupt 和 per-record conflict report，确认 import target 是 Host-managed repository，并要求显式 `keep/restore/merge` 决策。
- [ ] 5.4 将 rollback backup、pending journal、per-domain CAS、quarantine 和 idempotent `restoreId` 接入 profile lease；恢复失败时保留原始值、原因、checksum 和 correlationId。
- [ ] 5.5 增加 `SeekPlayerDB` frozen-schema guard，证明 database `SeekPlayerDB`、version `1`、store `files`、key path `id` 不发生 upgrade/clear/rebuild；未来 schema change 以 blocked result 指向独立授权 change。
- [ ] 5.6 建立 fault matrix，覆盖 IndexedDB abort/quota、JSON truncate/fsync/replace failure、SQLite integrity failure、domain commit partial、process kill、page close、revision conflict、duplicate restore、unknown schema 和 rollback failure。
- [ ] 5.7 在临时隔离 profile 执行 restore/reopen rehearsal，验证六域 count/checksum、Reader/Vocabulary/SRS/Preview/Annotation/marks/workflow journeys、Range playback 和 zero network；source profile 必须保持只读。

## 6. 串行迁移 Reader Session 与 media owner

- [ ] 6.1 将 Reader Session loader 的 prepare/commit/restore 改为调用 Windows Host-managed repository owner API，保留 generation/AbortController/latest-wins 和旧 session on failure 语义。
- [ ] 6.2 让 transcript/chunk/session metadata 与 marks reference 使用统一 `contentId`/session revision receipt，禁止 browser 在未提交时更新 canonical state。
- [ ] 6.3 完成 host capability URL、Range/ETag、missing/rebind 和 `MediaResourceOwner` 生命周期迁移，验证 300–540MB fixture 不整文件下载或复制，且 media identity 仅进入 Host repository。
- [ ] 6.4 在 profile lease+journal 下冻结/阻断 Reader Session direct browser writer，将 compatibility path 先置为 read-only/import-evidence，确认无 in-flight mutation 后以单一 owner-mode checkpoint 切换 Host repository authority；切换前失败保持旧 owner或 not-ready，切换后继续保持 compatibility-read-only，运行 static consumer map 与 runtime writer-zero gate。
- [ ] 6.5 通过 Reader Session contract、A/B/A、快速取消、host restart、失效媒体、旧 session 保留和 production Range behavior gates；未通过时不得迁移下一域。

## 7. 逐域切换 authoritative writer（每项必须独立备份/门禁/回滚）

- [ ] 7.1 实现共享 owner-mode cutover coordinator：持有 profile lease+journal，冻结/阻断旧 writer，等待并验证 in-flight mutation 为零，在单一 checkpoint 中同时记录 `old-writer=blocked`、Host repository base/new revision 与 `host-api=authoritative`；checkpoint 前 Host API 不得提交 production canonical write，失败只能保持旧 owner或 not-ready/manual-recovery。
- [ ] 7.2 迁移 `marks-activity`：先完成 shadow/diff、isolated Host-repository canary、coalesced API receipt、重复 activity 防重和 rapid mark journey，再 freeze/block direct writer、将 compatibility path 置为 read-only、drain in-flight mutation，最后执行 single-checkpoint；checkpoint 后确认 read-only 与 direct writer zero，才能进入 rollback window。
- [ ] 7.3 迁移 `passage-preview`：先完成 legacy key inventory/import、Host-repository batch envelope canary、continuation/rating/translation transition journey、quota/corrupt recovery，再 freeze/block direct writer、置 compatibility path read-only、drain 后执行 single-checkpoint；切换前不得有 production 双写，切换后 direct localStorage writer 必须保持 blocked。
- [ ] 7.4 迁移 `annotation`：先完成 Host-repository generated/status/lightweight bundle canary、scope/contentId 校验、not-found/corrupt/permission diagnostics、导入导出回归，再 freeze/block direct writer、置 compatibility bridge read-only、drain 后执行 single-checkpoint；direct annotation writer 归零。
- [ ] 7.5 迁移 `vocabulary-srs`：先完成 Host-repository snapshot/UoW/CAS/receipt、acquisition/review/SRS/learning-event journeys、multi-tab conflict、未知 envelope 与 retry idempotency，再 freeze/block direct writer、置 compatibility path read-only、drain 后执行 single-checkpoint；ECDICT 保持只读 transient boundary。
- [ ] 7.6 迁移 `workflow`：先完成 Host-repository job snapshot/event/query、authorized start/cancel/retry、ProcessSupervisor identity、restart recovery、commit-unknown receipt，再 freeze/block direct writer、置 compatibility path read-only、drain 后执行 single-checkpoint；jobs/history/reader-index direct writer 必须保持 blocked，完整媒体仍不进入 backup。
- [ ] 7.7 每个 domain cutover 后运行 pre-cutover checksum、isolated Host-repository canary、owner-mode journal/receipt、post-cutover差分、writer-zero、rollback-window 和 isolated reopen；任何失败只阻断当前 Host writer并按 journal 选择旧 owner或 not-ready/manual-recovery，不进入下一项。

## 8. 完成跨域可见性、fail-closed 与回滚演练

- [ ] 8.1 六域均已通过各自 owner-mode checkpoint 且 Host repository authoritative 后，启用 material publish、full restore 和 migration cutover 的 profile journal，验证 owner reads 不会观察到 partial cross-domain revision。
- [ ] 8.2 对每个 domain commit boundary 执行 hard process exit、服务重启、page close、quota/disk-full、checksum/schema corruption 和 pending recovery，证明 host 在 recovery 前 not-ready。
- [ ] 8.3 执行 unauthorized Host/Origin/token、non-loopback bind、expired capability、path escape、missing owner、unknown schema、corrupt record 和 missing media 的 fail-closed journeys。
- [ ] 8.4 执行 multi-tab read/one-writer conflict、late response、double-click、offline/timeout、commit-unknown receipt 查询和不重复副作用验证。
- [ ] 8.5 验证完整媒体始终排除在 backup/restore/migration 之外，仅保留 identity/metadata/rebind evidence；Range playback 在恢复后仍可用。
- [ ] 8.6 运行 isolated real-profile backup/restore/reopen，核对六域 checksum/count、所有关键 journeys、zero network、source/daily profile hash 不变。

## 9. 行为、性能与 release gates

- [ ] 9.1 将 API owner contract、schema freeze、direct-writer consumer map、registry/readiness、Range/no-copy、lease/journal 和 typed error checks 纳入 architecture/fast gate。
- [ ] 9.2 将六域 browser journeys、production host startup、host restart/crash、A/B/A、multi-tab conflict、workflow cancel/retry 和 annotation/Preview/Vocabulary/SRS flows 纳入 full behavior gate。
- [ ] 9.3 运行三次冷启、30 分钟连续播放/seek、连续材料切换、listener/heap、Long Task、HTTP error 和大媒体首播预算，确保 API facade 不引入整文件复制或明显回归。
- [ ] 9.4 生成 release manifest、artifact checksums、current/previous owner contract compatibility 和可验证 health/rollback target；release readiness 失败时自动恢复 previous release，不改用户数据。
- [ ] 9.5 仅在所有 gates、isolated restore rehearsal 和 rollback rehearsal 通过后，准备用户 review；本 change 不执行日常 shortcut/production mutation，任何外部切换另需明确授权。

## 10. 兼容层收敛与完成定义

- [ ] 10.1 在 rollback window 结束后删除或隔离六域 direct browser writers，保留 read-only compatibility reader、migration journal、pre-cutover backup、previous release 和恢复说明。
- [ ] 10.2 更新 `CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md`、`docs/OPERATIONS.md`、backup/recovery docs、API contract 和 domain ownership matrix，记录实际 owner、revision、rollback 与 schema freeze 证据。
- [ ] 10.3 运行 architecture consumer map，证明每个六域 durable mutation 只有 Windows owner API 入口；没有 direct `IDBObjectStore`/`localStorage`/raw JSON write 的未登记 caller。
- [ ] 10.4 运行 strict validation、clean-room build/full verification 和最终 isolated recovery report，并保存 machine-readable artifacts、trace、截图、checksum 与故障结果。
- [ ] 10.5 完成定义：Windows loopback host 管理的 repository 是六域唯一 canonical owner；browser 只经正式 API 读写 durable state，bridge 只做 inventory/一次性 import/rollback-window compatibility read；每域均以 freeze/drain/no-in-flight/single owner-mode checkpoint 完成切换，无双 writer；Range/no-copy、CAS/receipt、backup/restore、fail-closed、compatibility rollback、行为门禁和恢复演练全部通过；`SeekPlayerDB v1/files/id` 未改变；Mac/Tailscale/非-loopback transport 未被实现或开放。
