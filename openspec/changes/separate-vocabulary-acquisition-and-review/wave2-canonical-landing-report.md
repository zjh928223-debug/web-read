# Wave 2 canonical landing report

日期：2026-07-29
Change：`separate-vocabulary-acquisition-and-review`
Canonical：`E:\read-web`
统一集成来源：`C:\Users\0\.codex\worktrees\41a3\read-web`
共同 HEAD：`c623bb335b9082e7ab24479569a4f2250d5789fe`

## 结论

P7–P10 已从统一集成 worktree 增量落地到 canonical。OpenSpec 进度由
52/101 更新为 78/101，仅勾选 8.1–11.6 共 26 项；12.1 及以后仍未开始。
本次未提交、未推送，也未启动 Wave 3B/tasks 12.x。

## Canonical 起点与用户改动保护

落地前 canonical 已是 dirty worktree。已记录并保护的既有修改包括：

- `package-lock.json`、`package.json`
- `scripts/annotation-bubble-resolver-check.cjs`
- `scripts/srs-review-check.cjs`
- `src/App.vue`
- `src/composables/annotation-bubble-resolver.js`
- `src/features/srs-review/SrsReviewPage.vue`
- `src/features/srs-review/srs-review.css`
- `src/services/annotation/click-resolver.js`
- `styles.css`
- `vite.config.js`
- Passage Preview、SRS policy/planner、pronunciation、Wave 1/P6 文件、日志和
  Playwright 产物等既有 untracked 内容

未执行 reset、stash、clean、整树复制、整文件回退、提交或推送。

## 迁入文件

### P7

- `src/services/vocabulary/srs-review-service-v2.js`
- `src/services/vocabulary/srs-review-session-ledger.js`
- `scripts/srs-review-service-v2-check.cjs`
- `scripts/srs-review-session-ledger-browser-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p7-implementation-report.md`

### P8

- `src/services/vocabulary/exam-vocabulary-importer.js`
- `src/services/vocabulary/exam-vocabulary-context-matcher.js`
- `scripts/exam-vocabulary-import-closure-check.cjs`
- `scripts/fixtures/exam-vocabulary-import-v1.json`
- `scripts/fixtures/exam-vocabulary-import-v1.csv`
- `scripts/fixtures/exam-vocabulary-context-v1.json`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p8-implementation-report.md`

### P9

- `src/services/vocabulary/legacy-vocabulary-reassessment.js`
- `scripts/fixtures/legacy-vocabulary-reassessment-cases.json`
- `scripts/legacy-vocabulary-reassessment-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p9-implementation-report.md`

P9 保持 `dry_run: true`，feature flag 默认关闭；未执行真实 reassessment。

### P10

- `scripts/vocabulary-article-acquisition-check.cjs`
- `scripts/vocabulary-add-word-boundary-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p10-implementation-report.md`

同时保留并落地统一组合报告：

- `openspec/changes/separate-vocabulary-acquisition-and-review/wave2-integration-report.md`

## 共享文件增量处理

- `src/services/vocabulary/index.js`：保留 canonical 原 exports，追加已实际存在的
  P1–P9 模块 exports；没有导出不存在的模块。
- `package.json`：只补
  `verify:vocabulary-article-acquisition` 和
  `verify:vocabulary-add-word-boundary`；保留
  `preview:build-package`、Passage Preview、P6 和所有其他用户脚本。
- `package-lock.json`：未修改；落地前后 SHA-256 均为
  `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079`。
- `tasks.md`：只将 8.1–11.6 的 26 个 checkbox 改为完成；12.x 以后保持未完成。
- `vocabulary-service.js`、`srs-candidates.js`、
  `article-srs-settlement.js`：canonical 相对共同 HEAD 无后续用户 hunk，因此应用
  统一集成源的 P10 scoped delta；acquisition 仍默认关闭。
- `annotation-backfill-ai-module-check.cjs`、
  `vocabulary-preview-service-check.cjs`、
  `vocabulary-srs-service-check.cjs`：只应用组合 harness staging/import seam。
- `srs-review-check.cjs`：保留 canonical 后续 SRS UI 断言，只增加 P4 policy/planner
  与 P7 service 的临时模块 staging/import rewrite。

所有落地范围文件与统一集成源的 normalized text 复核一致；保留了 canonical 的
CRLF，不以 LF raw hash 覆盖本地换行基线。

## 关键 SHA-256（canonical raw bytes）

| 文件 | 落地前 | 落地后 |
|---|---|---|
| `package.json` | `85253a60cc2845fab29656f9a8a2292f06c7464e69c892b43db67a6948704baf` | `5e9591c43c3228ecc5644c2f48dcf7afd61b6bc037801457a89b275aeb822c28` |
| `package-lock.json` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` |
| `src/services/vocabulary/index.js` | `fa72073cefb92287ba4e04ff56a2d2ee487114f5d87322eebb8ec19840d2dfab` | `21318702b4aef10da91edb86c75d24bd1e6aff1a4cedb5cd480b66b7f915e005` |
| `src/services/vocabulary/vocabulary-service.js` | `722971632b43acafe088a858be3b27c59d88ef313413816d143bad6873347203` | `4d819c9f7b5ff052ea8a03d05474d2f1818f11b8b296463b381b242663b4b4f8` |
| `src/services/vocabulary/srs-candidates.js` | `d17b9bd2abf5d1adcd974c1b970d724dc950c8aecc3a74d4b5bb3e43f0baa0b0` | `b5d40dac4238ef9505360907dc77ba193bbbaa6498ddc7d4a82e0eaa6300b079` |
| `src/services/vocabulary/article-srs-settlement.js` | `ae104be68714f3550dbf03e5c3a3d08f9ac30df29842ee9485aaebab167a8235` | `3645af7ddd3ae3a1031f72d166f1c0d504ba7a1ad32735cce1740bfb728901d7` |
| `scripts/annotation-backfill-ai-module-check.cjs` | `eba160083ab10d62f79475e30b67ed83a388f807048dfe4ef7bad2e04f6a7608` | `dc5944314859dc40ea5d8e36453f90e19d34f370b801be79bc8d44cbe72c5f1e` |
| `scripts/vocabulary-preview-service-check.cjs` | `e6f8223c384188d2ee8d6cf1a3c978daa91ad1f75de8ecc2fce57f2d2ccd12b3` | `c47b4293d311451eea34e5e3a28808af8c2b78044de9d6118b02f9abe99416b5` |
| `scripts/vocabulary-srs-service-check.cjs` | `353f923dfc8bef1c933f4a80a20d8498df6f180ecf7b4b49e2706c45ae031ce2` | `5aa75d544b26967f15156e75242aee31d66d887a34f2f1baa98b2a96eed0cbc9` |
| `scripts/srs-review-check.cjs` | `861af020b262040139cc3de4fb1befcb3715065bedc7952aee908aafbaad7587` | `3d2311f4caceea51578c5dd2e2537ff83356585b7790554dba43f27215364842` |
| `tasks.md` | `9b73a1bfce136cf7a4ec7d4aa6e649db478a456bdb0f1544e537d579eaff94a9` | `ff921188abf9f02e34973e4fa856fb516383b85ea24ef36e68f16b709b590b57` |

## 验证结果

| 验证 | 结果 |
|---|---|
| `node scripts/srs-review-service-v2-check.cjs` | PASS |
| `node scripts/srs-review-session-ledger-browser-check.cjs` | PASS |
| `node scripts/exam-vocabulary-import-closure-check.cjs` | PASS |
| `node scripts/legacy-vocabulary-reassessment-check.cjs` | PASS |
| `npm run verify:vocabulary-article-acquisition` | PASS |
| `npm run verify:vocabulary-add-word-boundary` | PASS；2 个兼容定义、1 个允许的 flag-off legacy 调用、0 forbidden finding |
| `npm run verify:vocabulary-acquisition-service` | PASS |
| `npm run verify:vocabulary-learning-uow-browser` | PASS |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run verify:srs-review` | PASS |
| `npm run verify:vocabulary-preview` | PASS |
| `npm run verify:annotation-backfill-ai` | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS；Vite 8.0.14，179 modules transformed |
| `npm run verify:vite` | PASS；load、playback、interaction |

浏览器检查使用 disposable profile 和 synthetic rows；未访问真实用户 IndexedDB。

### Frozen P0 guards

- `p0-contract-check.cjs`：PASS。
- `p0-snapshot-check.cjs`：PASS；`indexeddb_accessed: false`，
  `input_mutated: false`。
- `p0-architecture-guard.cjs`：KNOWN/FROZEN HASH FAIL。它仍要求
  `vocabulary-service.js` 的落地前哈希
  `722971632b43acafe088a858be3b27c59d88ef313413816d143bad6873347203`，
  本轮按 11.2 落地后的实际哈希为
  `4d819c9f7b5ff052ea8a03d05474d2f1818f11b8b296463b381b242663b4b4f8`。
  未刷新或修改 frozen guard/asset。

## 未触碰内容

- 未修改 `SeekPlayerDB` version 1、`files` object store 或 keyPath `id`。
- 未访问、迁移或删除真实用户 IndexedDB 记录。
- 未修改 SRS UI、Passage Preview、reader/session runtime、ECDICT 或其他用户功能。
- 未覆盖 canonical 的用户 exports、scripts、任务文本或 SRS UI verification 断言。
- 未执行真实 reassessment；P9 保持 `dry_run: true` 且默认关闭。
- 未开启 acquisition 默认写入路径。
- 未开始 Wave 3B/tasks 12.x。
- 未提交、未推送。
