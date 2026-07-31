# Wave 3B canonical landing report

日期：2026-07-30
Change：`separate-vocabulary-acquisition-and-review`
范围：tasks 12.1–12.6
源 worktree：`C:\Users\0\.codex\worktrees\984d\read-web`
canonical：`E:\read-web`
canonical HEAD：`c623bb335b9082e7ab24479569a4f2250d5789fe`
branch：`codex/youtube-material-workflow`

## 结论

Wave 3B 已从最终复审通过的源 worktree 增量落地到 canonical。真实入口现在通过单一
source selector 在 V2 与 legacy 之间选择一个数据源：flag off、V2 无卡或只读探测失败时
回退 legacy；V2 有可用卡时只使用 V2。队列不合并，评分不双写。

OpenSpec 当前为 **84/101**。本轮只勾选 12.1–12.6；13.x、14.x、15.x 保持全部未勾选。
没有提交、推送、reset、stash、clean、整树复制或整文件回退。

## Canonical 落地前 dirty status

以下状态在任何 landing 编辑前记录。它包含用户未提交的 SRS UI、Passage Preview、发音、
Wave 1/2、文章结算和其他工作，本轮没有清理或回退这些内容。

```text
 M package-lock.json
 M package.json
 M scripts/annotation-backfill-ai-module-check.cjs
 M scripts/annotation-bubble-resolver-check.cjs
 M scripts/srs-review-check.cjs
 M scripts/vocabulary-preview-service-check.cjs
 M scripts/vocabulary-srs-service-check.cjs
 M src/App.vue
 M src/composables/annotation-bubble-resolver.js
 M src/features/srs-review/SrsReviewPage.vue
 M src/features/srs-review/srs-review.css
 M src/services/annotation/click-resolver.js
 M src/services/vocabulary/article-srs-settlement.js
 M src/services/vocabulary/index.js
 M src/services/vocabulary/srs-candidates.js
 M src/services/vocabulary/vocabulary-service.js
 M styles.css
 M vite.config.js
?? .codex-vite-5521.err.log
?? .codex-vite-5521.log
?? .codex-vite-5521.out.log
?? .playwright-cli/
?? SRS_REVIEW_PERSONAL_MVP_IMPLEMENTATION.md
?? openspec/changes/separate-vocabulary-acquisition-and-review/
?? scripts/aria-edge-tts-live-check.cjs
?? scripts/build-passage-preview-package.cjs
?? scripts/exam-vocabulary-import-closure-check.cjs
?? scripts/fixtures/
?? scripts/legacy-vocabulary-audit-check.cjs
?? scripts/legacy-vocabulary-reassessment-check.cjs
?? scripts/passage-preview-browser-check.cjs
?? scripts/passage-preview-check.cjs
?? scripts/passage-preview-verify.cjs
?? scripts/srs-review-policy-planner-check.cjs
?? scripts/srs-review-service-v2-check.cjs
?? scripts/srs-review-session-ledger-browser-check.cjs
?? scripts/vocabulary-acquisition-repository-check.cjs
?? scripts/vocabulary-acquisition-service-check.cjs
?? scripts/vocabulary-add-word-boundary-check.cjs
?? scripts/vocabulary-article-acquisition-check.cjs
?? scripts/vocabulary-command-receipt-fingerprint-check.cjs
?? scripts/vocabulary-context-evidence-check.cjs
?? scripts/vocabulary-learning-events-check.cjs
?? scripts/vocabulary-learning-uow-browser-check.cjs
?? scripts/vocabulary-wave1-integration-check.cjs
?? src/features/passage-preview/
?? src/features/srs-review/srs-review-policy.js
?? src/features/srs-review/srs-session-planner.js
?? src/services/pronunciation/
?? src/services/vocabulary/exam-vocabulary-context-matcher.js
?? src/services/vocabulary/exam-vocabulary-importer.js
?? src/services/vocabulary/legacy-vocabulary-audit.js
?? src/services/vocabulary/legacy-vocabulary-reassessment.js
?? src/services/vocabulary/srs-review-service-v2.js
?? src/services/vocabulary/srs-review-session-ledger.js
?? src/services/vocabulary/vocabulary-acquisition-repository.js
?? src/services/vocabulary/vocabulary-acquisition-service.js
?? src/services/vocabulary/vocabulary-context-evidence.js
?? src/services/vocabulary/vocabulary-learning-events.js
?? src/services/vocabulary/vocabulary-learning-models.js
?? src/services/vocabulary/vocabulary-learning-uow.js
```

## 迁入文件与共享 hunk 处理

新增并保持源内容：

- `src/features/srs-review/srs-review-ui-service.js`
- `src/features/srs-review/srs-review-source-selector.js`
- `src/features/srs-review/srs-review-prompt.js`
- `scripts/srs-review-ui-v2-check.cjs`
- `wave3b-implementation-report.md`

逐 hunk 增量合并：

- `src/App.vue`：只接入 V2 UI adapter 与单一 source selector，保留 Passage Preview 和发音入口。
- `src/features/srs-review/useSrsReview.js`：增加 V2/legacy 单源加载、ledger 恢复、四级评分、
  prompt/cue、预算/backlog/revisit 和 V2 删除禁用边界。
- `src/features/srs-review/SrsReviewPage.vue`：增加 session 元数据、按实际显示逐级揭示语境、
  V2 管理动作禁用说明和评分 eligibility；保留既有音频、键盘、揭示和自动前进结构。
- `src/features/srs-review/srs-review-flow.js`：只在状态变化前冻结
  `answerRevealedBeforeRating` 并传给提交层。
- `src/features/srs-review/srs-review.css`：只增加上述 Wave 3B UI 的 scoped 样式。
- `scripts/srs-review-check.cjs`：只补新 prompt/selector 模块的 verification staging。
- `package.json`：只补缺失的
  `"verify:srs-review-ui-v2": "node scripts/srs-review-ui-v2-check.cjs"`；没有覆盖其他 scripts。
- `tasks.md`：只把 12.1–12.6 从 `[ ]` 改为 `[x]`。

`package-lock.json` 未编辑；落地前后 SHA-256 均为
`b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079`。

## Canonical owner SHA-256

| 文件 | 落地前 | 落地后 |
|---|---|---|
| `src/App.vue` | `0d7c041649fb2e5fc3828f940e84b5a8a56f1a94f0cc5739eba5391a8c614c77` | `8716ed647fc89bb4edcd94c6bf38619a798b40a1083bc7ad9cd63a77cf30fd10` |
| `src/features/srs-review/useSrsReview.js` | `38ac1d3175957bb43afc9fca7bc66623b4dbdb47fc7bfe25f4baa4d1b52aa90b` | `5394a591c1608ac1662062bb50170a64fbb7d6b97dabcb636385bcc5c3426d64` |
| `src/features/srs-review/SrsReviewPage.vue` | `113c9dca267162f9cb5e03dfbf90b1ec9abe18d7a18cc47ebb9c2332551e46c8` | `4bfe934e7080087f37a92859a0ec491cdcfedbfbc9bb6f131d7156a776bd7c29` |
| `src/features/srs-review/srs-review-flow.js` | `0a794ed124463d8f5c15a892782c8232d6ce845fb7997ebc3f4d5fc219a71226` | `c2acb18bf62c6ba108ab935dc984a6f819557a690de75db8401ea5946bca0d20` |
| `src/features/srs-review/srs-review.css` | `69dd2d282b645aefd94bf42d1b74961833146a38bd0e69d0dd7396aaa6ff868e` | `4456292df4e9f2768a8f86fb8c3d0a767b5384c173cac5974e2b7da29b2dad6a` |
| `src/features/srs-review/srs-review-ui-service.js` | 不存在 | `a5b59af11bbea3ac07dcd7f829eed4581da34f33373a431a643a7ad7c292a530` |
| `src/features/srs-review/srs-review-source-selector.js` | 不存在 | `043845512ea5066258f5aa40402918ae029ed762da0cc7efdb259b6f2f28edae` |
| `src/features/srs-review/srs-review-prompt.js` | 不存在 | `3d5e5a7bcbc201ddf064e8c7fa0dae533f65a0c17776efc54a411bf058a4e0c2` |
| `scripts/srs-review-ui-v2-check.cjs` | 不存在 | `dd7aea7862dbf03321aa34178bdfdc810319a32ebae2c1ddf0410be36f9cb890` |
| `scripts/srs-review-check.cjs` | `3d2311f4caceea51578c5dd2e2537ff83356585b7790554dba43f27215364842` | `d94362f967a72f02b21de58692c1da7ed87e3b39235b1e9200a0b4b40ca4fd48` |
| `package.json` | `5e9591c43c3228ecc5644c2f48dcf7afd61b6bc037801457a89b275aeb822c28` | `3274745832eb73acec61f4b5235be4e0bfc311bda2983e57e65c621e966a40e8` |
| `package-lock.json` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` |
| `tasks.md` | `ff921188abf9f02e34973e4fa856fb516383b85ea24ef36e68f16b709b590b57` | `a5387c2712f6c8b16a3bebc7265de3f217659e76f555b7a35c3650b718ff39fb` |
| `wave3b-implementation-report.md` | 不存在 | `6b6c1a57f7197e78c7270e3fcb9108b25d14b39c959ddbbe8ac5b5f3e352b89a` |

共享文件经 Git 的工作树换行规则归一化后与最终源 worktree 内容一致；canonical 保留自己的
现有换行形式，因此其 raw-byte SHA 可与源报告中的 raw-byte SHA 不同。

## 最终返修语义审计

1. `App.vue` 只向页面传入 `createSrsReviewSourceSelector()` 的结果。selector 在一次 `load()`
   开始时只选择一个 service，不合并队列；V2 只调用 `recordReviewAttempt()`，legacy 只调用
   `reviewWord()`。
2. legacy 的“移除误收录”继续调用 `deleteWord()`。V2 不暴露或调用 legacy delete；按钮可见但
   禁用，并说明为避免孤立学习状态而暂不支持安全移除。
3. `word_only` 初始 cue 为 `none`，目标句、周边语境、原文音频均隐藏；主动显示目标句、
   周边语境或翻译后，提交的 cue metadata 与评分瞬间实际可见内容一致。
4. `hasReviewCards()` 只调用 `sessionLedgerRepository.getBySessionId()`、
   `acquisitionRepository.loadSnapshot()` 和
   `reviewStateRepository.getByLearningUnitId()`。它不调用
   `resumeReviewSession()`、`startReviewSession()`、`completeReviewSession()`、repository
   `put()`、UoW 或 attempt command。focused verification 断言探测前后 ledger snapshot
   字节等价、ledger write 为 0、V2 command 为 0，并断言探测失败及 legacy fallback 后
   V2 ledger 不变。

## 验证结果

| 验证 | 结果 |
|---|---|
| `npm run verify:srs-review-ui-v2` | PASS |
| `npm run verify:srs-review` | PASS |
| `node scripts/srs-review-service-v2-check.cjs` | PASS |
| `node scripts/srs-review-session-ledger-browser-check.cjs` | PASS；disposable synthetic IndexedDB rows |
| `npm run verify:vocabulary-srs` | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS；Vite 8.0.14，182 modules transformed |
| `npm run verify:vite` | PASS；load、playback、interaction |
| `git diff --check` | PASS |

验证只使用合成数据、临时目录和 disposable browser profile；没有读取、修改或删除真实用户
IndexedDB 数据。

## Frozen P0 architecture 记录

按要求只记录，不刷新或修改 guard/asset，也没有为本轮运行该旧 hash guard：

- `p0-architecture-guard.cjs` 仍冻结要求
  `src/services/vocabulary/vocabulary-service.js` SHA-256
  `722971632b43acafe088a858be3b27c59d88ef313413816d143bad6873347203`。
- canonical 当前该文件 SHA-256 仍为 Wave 2 已记录的
  `4d819c9f7b5ff052ea8a03d05474d2f1818f11b8b296463b381b242663b4b4f8`。
- 本轮没有修改 `vocabulary-service.js`，也没有刷新 frozen expected hash。

## 未触碰内容

- 未改变 `SeekPlayerDB` version 1、`files` object store 或 key path `id`。
- 未访问、迁移、覆盖或删除真实用户数据。
- 未修改 Passage Preview、reader/session runtime、ECDICT、文章结算、考试词导入、P9
  reassessment 或参数训练。
- 未修改 `package-lock.json`，未覆盖 canonical 的其他 package scripts。
- 未开始 13.x–15.x。
- 未提交、未推送。
