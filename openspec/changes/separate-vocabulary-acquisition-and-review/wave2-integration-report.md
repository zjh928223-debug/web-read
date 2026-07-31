# Wave 2 integration report

日期：2026-07-29
Change：`separate-vocabulary-acquisition-and-review`
集成 worktree：`C:\Users\0\.codex\worktrees\41a3\read-web`
集成基线 HEAD：`c623bb335b9082e7ab24479569a4f2250d5789fe`
状态：P7、P8、P9、P10 已增量集成并完成组合验证；未提交、未推送、未迁入 canonical `E:\read-web`。

## 安全边界

- 起点包含 canonical P1–P6、Passage Preview/SRS UI 等用户未提交工作；集成过程未执行
  `reset`、`stash`、清理、整文件回退、提交或推送。
- 未访问真实用户数据。P7/P6 浏览器检查使用 disposable Chromium profile 和 synthetic
  rows；P8/P9 只使用仓库合成 fixture。
- 未改变 `SeekPlayerDB` version `1`、`files` object store 或 `id` keyPath，未删除记录。
- 未修改 reader runtime、session runtime、ECDICT 或用户的 Passage 1 预习业务实现。
- `npm ci --ignore-scripts --no-audit --no-fund` 只补齐 lockfile 已声明的本地依赖；
  安装前后 `package.json` 与 `package-lock.json` SHA-256 均保持不变。

## 精确来源与目标

所有目标均位于
`C:\Users\0\.codex\worktrees\41a3\read-web`；没有写入 `E:\read-web`。

### P7

来源：
`C:\Users\0\.codex\worktrees\805b\read-web`

读取并核对：
`openspec/changes/separate-vocabulary-acquisition-and-review/p7-implementation-report.md`

迁入：

- `src/services/vocabulary/srs-review-service-v2.js`
- `src/services/vocabulary/srs-review-session-ledger.js`
- `scripts/srs-review-service-v2-check.cjs`
- `scripts/srs-review-session-ledger-browser-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p7-implementation-report.md`

`tasks.md` 只合并 8.1–8.7。

### P8

来源：
`C:\Users\0\.codex\worktrees\1ddb\read-web`

读取并核对：
`openspec/changes/separate-vocabulary-acquisition-and-review/p8-implementation-report.md`

迁入：

- `src/services/vocabulary/exam-vocabulary-importer.js`
- `src/services/vocabulary/exam-vocabulary-context-matcher.js`
- `scripts/exam-vocabulary-import-closure-check.cjs`
- `scripts/fixtures/exam-vocabulary-import-v1.json`
- `scripts/fixtures/exam-vocabulary-import-v1.csv`
- `scripts/fixtures/exam-vocabulary-context-v1.json`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p8-implementation-report.md`

`tasks.md` 只合并 9.1–9.7。

### P9

来源：
`C:\Users\0\.codex\worktrees\83ee\read-web`

读取并核对：
`openspec/changes/separate-vocabulary-acquisition-and-review/p9-implementation-report.md`

迁入：

- `src/services/vocabulary/legacy-vocabulary-reassessment.js`
- `scripts/fixtures/legacy-vocabulary-reassessment-cases.json`
- `scripts/legacy-vocabulary-reassessment-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p9-implementation-report.md`

`tasks.md` 只合并 10.1–10.6。P9 保持 `dry_run: true`，feature flag 默认关闭；没有迁入或执行
真实迁移。

### P10

来源：
`C:\Users\0\.codex\worktrees\4bd4\read-web`

读取并核对：
`openspec/changes/separate-vocabulary-acquisition-and-review/p10-implementation-report.md`

迁入新增文件：

- `scripts/vocabulary-article-acquisition-check.cjs`
- `scripts/vocabulary-add-word-boundary-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p10-implementation-report.md`

对当前集成起点应用 P10 owned delta：

- `src/services/vocabulary/vocabulary-service.js`
- `src/services/vocabulary/srs-candidates.js`
- `src/services/vocabulary/article-srs-settlement.js`
- `scripts/annotation-backfill-ai-module-check.cjs`
- `scripts/vocabulary-preview-service-check.cjs`
- `scripts/vocabulary-srs-service-check.cjs`

`tasks.md` 只合并 11.1–11.6。

## 共享文件和冲突处理

### `src/services/vocabulary/index.js`

没有用 P10 文件整份覆盖目标。先在当前目标内容上增量加入 P10 已验收的 P1–P6 exports，再只导出
本次实际迁入并存在的模块：

- P7：`srs-review-session-ledger.js`、`srs-review-service-v2.js`
- P8：`exam-vocabulary-importer.js`、`exam-vocabulary-context-matcher.js`
- P9：`legacy-vocabulary-reassessment.js`

没有导出不存在的模块，也没有改变原有 export 顺序之外的业务入口。

### `package.json` / `package-lock.json`

`package.json` 只增量加入 P10 拥有的两条脚本：

```json
"verify:vocabulary-article-acquisition": "node scripts/vocabulary-article-acquisition-check.cjs",
"verify:vocabulary-add-word-boundary": "node scripts/vocabulary-add-word-boundary-check.cjs"
```

保留 `preview:build-package` 及目标中全部其他用户脚本。没有把 P10 的旧 `package.json` 整份覆盖
目标。`package-lock.json` 在集成和依赖安装前后均未改变；其当前 dirty 状态属于集成起点。

### Verification harness 组合 seam

组合验证首次运行现有 vocabulary SRS/SRS review 时发现：

1. `index.js` 已导出 P7–P9，但旧临时模块 harness 只 staging P1–P6；
2. P7 service 的 `../../features/srs-review/*` import 在 flat temp module 中解析到 worktree 上一级。

只对 verification harness 做增量修复：

- `scripts/vocabulary-srs-service-check.cjs`
- `scripts/vocabulary-preview-service-check.cjs`
- `scripts/annotation-backfill-ai-module-check.cjs`
- `scripts/srs-review-check.cjs`

修复只补齐实际导出模块与 P4 policy/planner 的 temp staging/import rewrite，不修改业务代码或 UI。
修复后四项 harness 全部通过。

### `tasks.md`

从 OpenSpec apply 起点 52/101 精确增加 26 项：

- 8.1–8.7
- 9.1–9.7
- 10.1–10.6
- 11.1–11.6

当前进度 78/101；12.1 及以后仍保持未完成，其他既有任务和文档内容保留。

## 来源身份和关键 SHA

### P7 SHA-256

| 文件 | SHA-256 |
|---|---|
| `src/services/vocabulary/srs-review-service-v2.js` | `0ef403c6eea36e3d7ca0782dbe9ea3270dc4341bb77dc767c5df887590b0e233` |
| `src/services/vocabulary/srs-review-session-ledger.js` | `1b6fccf7b6be8507a9231d81712e470b3c9da277357da9603628f280d7a21a1c` |
| `scripts/srs-review-service-v2-check.cjs` | `65aadef5cc8253b6312b3b46fcb447e730cf0c3f542c8523f0eda379f71f85b5` |
| `scripts/srs-review-session-ledger-browser-check.cjs` | `1cbb6745928d5dc67df6746fcd40032ddd9d603be34a0e54a75ce0d3bdcd58ef` |

### P8 SHA-256

| 文件 | SHA-256 |
|---|---|
| `src/services/vocabulary/exam-vocabulary-importer.js` | `4b519af604bec0c2b7f07872502b77e35eb287eea20039be93aba73a15c2afeb` |
| `src/services/vocabulary/exam-vocabulary-context-matcher.js` | `7fa12b134bd25cb243c158d76ee898b008480b48d524a595f1649c0db8dff0be` |
| `scripts/exam-vocabulary-import-closure-check.cjs` | `78e702105a3c8dc5c4c862e58701fdebc63064427df92d3127d4257ebdfa5f58` |
| `scripts/fixtures/exam-vocabulary-import-v1.json` | `ad6fed881019d16baf7235b2457d9ffffe29388124e70898496a0f25bb62e120` |
| `scripts/fixtures/exam-vocabulary-import-v1.csv` | `94e1d0a67c298fdd424b18b48a1e324cc544cfc3d4f8c4e15728426af9cff986` |
| `scripts/fixtures/exam-vocabulary-context-v1.json` | `db7f8893576f6b26d67b7b7e79e54dc8a9d4919c80f0407781b5e9be2fcb7572` |

### P9 source identity

P9 报告冻结的是 Git blob identity；集成后重新计算与报告一致，并另记 raw SHA-256：

| 文件 | Git blob | SHA-256 |
|---|---|---|
| `src/services/vocabulary/legacy-vocabulary-reassessment.js` | `bdd9675f76aeb28f6f6b9006fbfa55f7f27d479e` | `f2a12de0938cf6d4e519d0990ccc838b124c622f7b909988f6498f04f1b9e868` |
| `scripts/legacy-vocabulary-reassessment-check.cjs` | `8f0e6c865cee86f0a1063fdaae9922ddd41ecf8a` | `3eecf09d97718c89b6c6c444551a161b6649de4224bff154aebbbf2a374b23d0` |
| `scripts/fixtures/legacy-vocabulary-reassessment-cases.json` | `b22cd69ba2d7b98ff61bc2f30c6d8c94a9fe55b3` | `347dc1fc24895cc6861bf1e9cfcd765b60d3b886c1dac7dcffa1fa952e173cf5` |

### P10 and integrated shared files

| 文件 | SHA-256 |
|---|---|
| `scripts/vocabulary-add-word-boundary-check.cjs` | `2028de523d93b39fda81c7eef551d19b5d2d6312dd424f9790702c905e3e4f43` |
| `scripts/vocabulary-article-acquisition-check.cjs` | `268fb81f2f4acfa0ee89b3fb892d9beddf7b9eccda1db7ddf142dbeb58d3920c` |
| `src/services/vocabulary/index.js` | `1dc2fabb650ca8fce62615494e50af1536a43d21bcdb56fe05aa3f57af8f8386` |
| `src/services/vocabulary/vocabulary-service.js` | `7f18c6589f98fd11461c76a63f7218c320b5c0140b5f86e10b58fea4d2e867c9` |
| `src/services/vocabulary/srs-candidates.js` | `5d878bca29cd9e6aa81217b5d7474a232326ba956923d2f923d9a2d0e2025c4f` |
| `src/services/vocabulary/article-srs-settlement.js` | `e3b29fb172c3bb976f5400abba92398a5c2525027d581407807d5a22e7e253b9` |
| `package.json` | `3cb8918e53fe4a0eb54dca38bc18c8627261dc72927f18fb1c92723b80fbc9ad` |
| `package-lock.json`（未修改） | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` |
| `tasks.md` | `33b6f676bf6a13f939df76ced76b05fc36b12c1f5f739fbc7e040ec55e078479` |

P10 source shared文件使用 LF，而当前目标保留其既有 CRLF；除 `index.js` 继续加入 P7–P9 exports
以及上述 verification seam 外，P10 owned shared delta 的 normalized text 与已验收来源一致。
因此本表记录集成目标 raw SHA，不用源 worktree raw SHA 冒充集成结果。

## 验证结果

| 验证 | 结果 |
|---|---|
| `node scripts/srs-review-service-v2-check.cjs` | PASS |
| `node scripts/srs-review-session-ledger-browser-check.cjs` | PASS |
| `node scripts/exam-vocabulary-import-closure-check.cjs` | PASS |
| `node scripts/legacy-vocabulary-reassessment-check.cjs` | PASS |
| `npm run verify:vocabulary-article-acquisition` | PASS |
| `npm run verify:vocabulary-add-word-boundary` | PASS；16 个 bypass self-test、3 个 fallback polarity self-test、0 forbidden finding |
| `npm run verify:vocabulary-acquisition-service` | PASS |
| `npm run verify:vocabulary-learning-uow-browser` | PASS |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run verify:srs-review` | PASS |
| `npm run verify:vocabulary-preview` | PASS |
| `npm run verify:annotation-backfill-ai` | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS；Vite 8.0.14，179 modules transformed |
| `npm run verify:vite` | PASS；load、playback、interaction |

P8 focused 闭环确认：

- imported candidate：1
- graduation 前 review count：0
- 缺口具有三种 acquisition-only action：1
- graduation 后 review count：1
- fixture 不含用户数据或考试原文

P10 AST guard 最终 allowlist：

1. `vocabulary-service.js` 的 `addWordLegacy()` 定义；
2. `vocabulary-service.js` 的临时 `addWord()` compatibility 定义；
3. `srs-candidates.js` flag-off 分支中唯一 `addWordLegacy()` 调用。

## 冻结 P0 guards

按要求运行但没有刷新冻结资产。三项失败与 P6/P7/P8/P9/P10 报告记录的起点已知条件一致：

| Guard | 结果 |
|---|---|
| `p0-contract-check.cjs` | KNOWN FAIL：LF-only regex 不匹配当前 CRLF `p0-contracts.md` |
| `p0-architecture-guard.cjs` | KNOWN FAIL：`reader-runtime.js` actual `d1e00419c0fa7644c4861497e59b1a3bc93d8534bf886a5dbc6f7c146683735a`，frozen `bfd74109d8d93e20518f10d888dc114f0e76114820e7bc87fbdb57926ebf0a33` |
| `p0-snapshot-check.cjs` | KNOWN FAIL：fixture actual `864044fe1576e7603d708bb65fd80e855a35bdecbca5754cfddf1144cec471cc`，frozen `d66511eb2778552fe39088236d04b2fc3d5ad7abdad92965fbf44dd75367d932` |

这些 guard 和受保护资产均未修改。

## 明确未合入

- 四个来源 worktree 中携带的 P1–P6 起点副本、用户其他未提交工作和旧基线文件。
- 任一来源 worktree 的整份 `package.json`、`package-lock.json` 或整份 OpenSpec change 目录。
- P7/P8/P9 worktree 中不存在 ownership 的共享 index、service、article、SRS UI 或 runtime 改动。
- P10 worktree 中的 SRS UI、Passage Preview、reader/annotation 用户业务改动、logs、
  `.playwright-cli`、`.playwright-artifacts`、dist 或临时文件。
- 真实用户 IndexedDB 内容、真实考试原文、真实 reassessment batch。
- canonical `E:\read-web` 中的任何文件。

## Canonical 落地建议

1. 先在 canonical 记录当前 dirty status 和 `package.json`、`package-lock.json`、四个共享
   vocabulary 文件及 verification harness 的哈希；不要 reset/stash。
2. 以本集成 worktree 为已验证组合源，按本报告文件清单做逐文件/逐 hunk 三方审阅；不要再从
   P7–P10 四个来源 worktree 分别整树复制。
3. `index.js`、`package.json`、`tasks.md` 必须继续采用增量合并：
   - 保留 canonical 所有用户 exports/scripts/tasks；
   - 保留 `preview:build-package`；
   - 只加入本报告列出的实际模块、两条 P10 verify script 和 8.1–11.6 勾选。
4. 不复制本 worktree 的 `package-lock.json`，除非 canonical 独立证明 dependency graph
   需要变化；本轮业务集成不需要 lockfile 改动。
5. canonical 落地后重跑本报告完整 PASS 矩阵；冻结 P0 guard 仍只记录，不在 Wave 2
   landing 中刷新。
6. 继续保持 flags 的保守默认：acquisition 默认关闭，P9 real reassessment 禁止；
   Wave 3B/P11 SRS UI 接入与任何真实迁移须独立验收。
