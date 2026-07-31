# Wave 1 canonical 集成报告

日期：2026-07-28
canonical：`E:\read-web`
审核来源：`C:\Users\0\.codex\worktrees\f250\read-web`
范围：P1–P5、Wave 1 组合验证及 command receipt/fingerprint 冻结向量。未实施 P6/P7，未提交、合并、stash、清理或推送。

## 来源/目标 SHA-256

以下 19 个文件均在迁入前确认来源存在、canonical 目标不存在；迁入后及全部验证后两次复核，来源与 canonical 目标逐字节一致。

| Phase | 文件 | canonical SHA-256 |
|---|---|---|
| P1 | `src/services/vocabulary/vocabulary-learning-models.js` | `4a476b29917b426d44979c73fbc6a923c37658f9b1ae547f5c8e949652c7eaab` |
| P1 | `src/services/vocabulary/vocabulary-acquisition-repository.js` | `355759656f3a4826032752550463e10566ec69049a0989361d3fc26367f083f7` |
| P1 | `scripts/vocabulary-acquisition-repository-check.cjs` | `952820f635b7ffe43ec496c1f1599ea5154d7376e52321e0672803b1c1ca58b2` |
| P2 | `src/services/vocabulary/vocabulary-context-evidence.js` | `29f0d1cce5707e7d14acb4d5d4e9f2bae1f4dce963e2c1dee389f6e0f51d11ea` |
| P2 | `scripts/vocabulary-context-evidence-check.cjs` | `d324d5fd3470a24e88ec08df21c471c3bf111216b1585e484a92e7b6824e759f` |
| P2 | `scripts/fixtures/vocabulary-context-evidence.v1.json` | `6d0ed9356abadebe183fa193f4f730cbb254e5cffe8941641cc6313af6ab09df` |
| P3 | `src/services/vocabulary/vocabulary-learning-events.js` | `6eebf3017b1df9ee59ba8de706b8e17078eceba34a0432a8c691032f5b045086` |
| P3 | `scripts/vocabulary-learning-events-check.cjs` | `5a809a395d0684a6c849ef99fffbf226d021a663d9d03cd1d62b5a7702e0ab50` |
| P3 | `scripts/fixtures/vocabulary-learning-events.fixture.json` | `29f7fa6354f8492b4939f9a8227ca5358a413b31ee453001c3116bba71643f3b` |
| P4 | `src/features/srs-review/srs-review-policy.js` | `af70589d5dc57399dcb3be3926a434ae4333ed7a4abe41a8b582b67552bba5b1` |
| P4 | `src/features/srs-review/srs-session-planner.js` | `e0af7b012efa9405baa6096f63fb386ae791e7b985e9f77599687684c538fde0` |
| P4 | `scripts/srs-review-policy-planner-check.cjs` | `8ceb8b87fa3ff46fcc90433f512fed15bb26c7c3f5e9226b8ed39efcc5eac5ff` |
| P4 | `scripts/fixtures/srs-review-policy-planner-fixtures.json` | `96a4d51f5fe6db27c53e8c5a6520f0ea4ac7f84f247289e97206f3490c55c1f1` |
| P5 | `src/services/vocabulary/legacy-vocabulary-audit.js` | `3ba08324483dd21bebd14fd3fbf461dd19b5ea25a0dce9c2e3253b52266c75f9` |
| P5 | `scripts/legacy-vocabulary-audit-check.cjs` | `12e1257cbf5561c5750ecd3cabf61e97e9f80ecb11f4ecadd4c61dd11270141f` |
| P5 | `scripts/fixtures/legacy-vocabulary-audit-cases.json` | `717ec97168deec15964da80d804ee09c2952e0a479f4a0370a786117ea58fced` |
| Wave 1 | `scripts/vocabulary-wave1-integration-check.cjs` | `aa458117388adeb1361596722c01d490e1f36803837d132b3d58543250a2d0a6` |
| Receipt | `scripts/vocabulary-command-receipt-fingerprint-check.cjs` | `512fe69296cf3eaeaaf6786786b3d9b5ae2595b22158bc4c07b3ad46a67f9e94` |
| Receipt | `scripts/fixtures/vocabulary-command-receipt-fingerprint-vectors.v1.json` | `de4a85a5e4ab8bcf69fbea3e4f2fbfaf54fcbf50527c854f4ceda1efb0adf88a` |

## canonical 验证矩阵

| 顺序 | 命令/检查 | 结果 |
|---:|---|---|
| 1 | `node scripts/vocabulary-command-receipt-fingerprint-check.cjs` | PASS |
| 2 | `node scripts/vocabulary-acquisition-repository-check.cjs` | PASS |
| 3 | `node scripts/vocabulary-context-evidence-check.cjs` | PASS |
| 4 | `node scripts/vocabulary-learning-events-check.cjs` | PASS |
| 5 | `node scripts/srs-review-policy-planner-check.cjs` | PASS |
| 6 | `node scripts/legacy-vocabulary-audit-check.cjs` | PASS |
| 7 | `node scripts/vocabulary-wave1-integration-check.cjs` | PASS |
| 8 | `node openspec/changes/separate-vocabulary-acquisition-and-review/verification/p0-snapshot-check.cjs` | PASS；`input_mutated: false`、`indexeddb_accessed: false` |
| 9 | `node openspec/changes/separate-vocabulary-acquisition-and-review/verification/p0-architecture-guard.cjs` | PASS |
| 10 | `node openspec/changes/separate-vocabulary-acquisition-and-review/verification/p0-contract-check.cjs` | PASS |
| 11 | `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| 12 | `npm run build` | PASS |
| 13 | `npm run verify:vite` | PASS；load、playback、interaction 三项通过 |
| 14 | `npm run verify:vocab-matching` | PASS |
| 15 | `npm run verify:vocabulary-srs` | PASS |
| 16 | `npm run verify:vocabulary-preview` | PASS |
| 17 | `npm run verify:srs-review` | PASS |

canonical 没有重现来源报告中的 P0 architecture CRLF 失败；本次以 canonical 实跑 PASS 为准，没有临时转换换行或放宽断言。

## 数据与文件边界

- 未提升或修改 `SeekPlayerDB` version 1；未新增 object store；仍为 `files` / keyPath `id`。
- 未访问或改写真实 IndexedDB。P0 snapshot 只读合成 fixture，Wave 1 integration 使用内存 row port。
- 未修改共享 vocabulary index/service、Vue 集成、`reader-runtime.js` 或 `session-init.js`。
- 未迁入来源 worktree 的 annotation/SRS UI dirty 文件、`tmp`、`dist`、日志或 Playwright artifacts。
- `npm run build` 与 `npm run verify:vite` 产生的忽略型 `dist` / `.playwright-artifacts` 仅为验证产物，不属于交付。

## Tasks 与并发冲突

本次仅将 2.1–6.5 同步为完成，7.x 及以后保持未勾选。原始委派预期为 34/90；但 canonical 在读取基线后被另一并发工作新增 `1A.1`–`1A.5`，其中 `1A.1` 已完成。为保护用户并发改动，本次未删除或改写该组任务，因此 OpenSpec 当前真实进度是 **35/95**，不能伪报 34/90。

## P6 gate 与残余风险

- P1/P2/P3 DTO、稳定错误、transaction row-port binders、P3 分片事件、receipt/canonical fingerprint fixtures 已在 canonical 完成组合验证。
- Wave 1 canonical 迁移完整，关键验证全部通过；因此 **P6 的 Wave 1 技术依赖 gate 已开启**，但本次没有启动 P6/P7。
- canonical 在执行期间存在其他并发编辑：新增 Passage Preview/发音服务及其 OpenSpec `1A` 范围，并继续修改 annotation/SRS UI 文件。它们不属于本次 landing，未被覆盖；开始 P6 前应由上游 owner 协调该并发范围及 tasks 总数。
- 现有日志、`.playwright-cli/`、`SRS_REVIEW_PERSONAL_MVP_IMPLEMENTATION.md` 和其他用户 dirty 文件均保留，未清理。
