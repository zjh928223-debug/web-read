# Wave 3B SRS UI implementation report

## 2026-07-30 定向返修（当前状态）

本节记录快速复审后的最终状态；如与下方 2026-07-29 首轮记录冲突，以本节为准。返修仍只属于
tasks 12.1–12.6，唯一 SRS UI owner 不变。13.x、14.x、15.x 均未启动；没有提交、推送或迁入
canonical `E:\read-web`。

### 旧卡兼容与单一写入路径

真实 `App.vue` 入口现在组合 `createSrsReviewUiService()`、现有 legacy
`createVocabularyService()` 和新的 `createSrsReviewSourceSelector()`：

```text
打开复习页
  -> VITE_SRS_REVIEW_V2_ENABLED 为 false/off/0/legacy：只选 legacy
  -> 否则只读探测 V2
       -> 有未完成 V2 ledger card 或已毕业且到期的 V2 ReviewState：只选 V2
       -> V2 无卡：只选 legacy
       -> V2 探测失败：安全回退 legacy
```

flag 未设置时默认开启上述 hybrid 选择。选择发生在每次页面 `load()` 开头，本次加载随后只绑定一个
service，不合并 V2 与 legacy queue。V2 卡只通过 `recordReviewAttempt()` 写入 V2
ReviewState/event/session ledger；legacy 卡只通过 `reviewWord()` 写入旧调度状态。同一卡不会同时进入
两条提交路径，也没有双写。P9 继续 dry-run/default-off，未迁移的
`vocabulary.srs.store.v1` due card 因此仍可复习。

V2 UI adapter 的 `hasReviewCards()` 是严格只读探测：它直接调用
`sessionLedgerRepository.getBySessionId()`，只检查 ledger 的 status、entries、
`completed_item_ids` 与持久化 attempt results；不调用
`resumeReviewSession()`、`startReviewSession()`、`completeReviewSession()`、repository `put()` 或
任何 UoW。没有可用 active ledger 时，才只读扫描 graduated LearningUnit 与到期 ReviewState。
因此跨日/过期 ledger 在来源选择阶段保持字节不变；只有最终选中 V2 并正式进入会话后，才允许
正式 resume 流程 reconcile 或更新状态。

最后一处定点返修只修改 `srs-review-ui-service.js`、`srs-review-ui-v2-check.cjs` 和本报告；
旧卡 fallback、管理动作、prompt/cue、UI/CSS、tasks 与其他模块均未修改。

### “移除误收录”管理动作

- legacy fallback 继续显示并调用原 `deleteWord()`，保持个人工具原有删除体验。
- V2 没有安全 archive command，因此按钮保持可见但禁用，并明确说明“为避免孤立学习状态，暂不支持
  安全移除”。没有把 legacy 删除套到 V2 LearningUnit/ReviewState，也没有把该动作变成第五种
  rating。

### prompt/cue 真实性

- `word_only` 初始只显示单词；原句、周边语境和原文音频初始不可见。
- 用户可依次主动“显示目标句”“显示周边语境”，页面实际渲染随 cue 变化：
  `none -> target_sentence -> surrounding_context`。
- 主动显示答案后，提交记录 `cue_level=translation`；未显示答案时按评分瞬间真实可见的语境记录。
- `original_context` / `transfer_context` 初始只显示目标句。adapter 用
  `validated_anchor_id` 区分原始 anchor 与 transfer evidence；请求 transfer 但没有 transfer evidence
  时安全降级为 `original_context`，避免记录与展示不一致。
- 所有提示动作都只改变 cue，不触发 rating；rating 仍仅来自“忘记、困难、一般、容易”四档。

### 本轮精确变更

新增：

- `src/features/srs-review/srs-review-source-selector.js`
- `src/features/srs-review/srs-review-prompt.js`

增量修改：

- `src/App.vue`
- `src/features/srs-review/srs-review-ui-service.js`
- `src/features/srs-review/useSrsReview.js`
- `src/features/srs-review/SrsReviewPage.vue`
- `src/features/srs-review/srs-review.css`
- `scripts/srs-review-ui-v2-check.cjs`
- `scripts/srs-review-check.cjs`（只补新模块的 verification staging）
- 本报告

`tasks.md` 没有新增勾选，仍只勾选 12.1–12.6。`package.json`、`package-lock.json` 本轮未改；
lockfile SHA-256 仍与 Wave 3B 起点一致。

### 定向 verification

| 验证 | 结果 |
|---|---|
| `npm run verify:srs-review-ui-v2` | PASS；真实 selector/composable、legacy-only App 路径、V2 独占提交、flag-off、probe-error fallback、legacy 删除、Vue SSR prompt 渲染、cue flow；另断言探测前后 ledger snapshot 字节等价、ledger put/V2 command 均为 0、最终回退 legacy 后 V2 ledger 不变 |
| `npm run verify:srs-review` | PASS |
| `node scripts/srs-review-service-v2-check.cjs` | PASS |
| `node scripts/srs-review-session-ledger-browser-check.cjs` | PASS；disposable synthetic IndexedDB rows |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run build` | PASS；Vite 8.0.14，182 modules transformed |
| `npm run verify:vite` | PASS；load、playback、interaction |
| `git diff --check` | PASS；只有既有 LF/CRLF 提示 |

focused verification 使用合成数据与临时目录；没有读取或修改真实用户 IndexedDB。
最后一处定点返修只复跑用户指定的 `verify:srs-review-ui-v2`、`verify:srs-review`、`build` 与
`git diff --check`；表中其余结果属于紧邻的上一轮定向验收，没有在本次重复执行。

### 返修后关键 SHA-256

| 文件 | SHA-256 |
|---|---|
| `package.json` | `8c08192265470016d24f46f7aa4012ae23748edd89767b6b8beec01a526b9e4e` |
| `package-lock.json` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` |
| `src/App.vue` | `af6b07276dfe0102e89b34fd7263c23b89dd955a506111f73efec4c7a3a2d335` |
| `src/features/srs-review/useSrsReview.js` | `b919cf6a17f042d7445cdb713209fa44c89e497750c3eb53a879c47d35bbb489` |
| `src/features/srs-review/SrsReviewPage.vue` | `7cc3e09a678e0b16c30534d56e369482cac86a84e820a969f5f7a7a54ecd0e41` |
| `src/features/srs-review/srs-review.css` | `40fd4596ce1cff9a96313eb96f188844fb4b46945f0c733ce62fa7886aea47be` |
| `src/features/srs-review/srs-review-ui-service.js` | `a5b59af11bbea3ac07dcd7f829eed4581da34f33373a431a643a7ad7c292a530` |
| `src/features/srs-review/srs-review-source-selector.js` | `043845512ea5066258f5aa40402918ae029ed762da0cc7efdb259b6f2f28edae` |
| `src/features/srs-review/srs-review-prompt.js` | `3d5e5a7bcbc201ddf064e8c7fa0dae533f65a0c17776efc54a411bf058a4e0c2` |
| `scripts/srs-review-ui-v2-check.cjs` | `dd7aea7862dbf03321aa34178bdfdc810319a32ebae2c1ddf0410be36f9cb890` |
| `scripts/srs-review-check.cjs` | `85a42d3716908d9318a47d48f774938716027d20cda618970c16db178e75d5f6` |
| `tasks.md` | `e0f4f70d6c5fc493405462285bc4239adc18e652b775d46e209d0af014645956` |

Base HEAD 仍为 `c623bb335b9082e7ab24479569a4f2250d5789fe`。未改 IndexedDB schema，
未触碰 Passage Preview、reader/session runtime、ECDICT、文章结算、考试词导入、P9 策略或参数训练；
未 reset、stash、clean、删除记录、提交或推送。

日期：2026-07-29
Change：`separate-vocabulary-acquisition-and-review`
范围：tasks 12.1–12.6
唯一 SRS UI owner：本 Wave 3B 执行对话
Worktree：`C:\Users\0\.codex\worktrees\984d\read-web`
Base HEAD：`c623bb335b9082e7ab24479569a4f2250d5789fe`

## 结论

现有 `SrsReviewPage.vue`、`useSrsReview.js`、CSS、音频、快捷键、答题揭示、自动前进和
历史回顾结构已保留，并以窄 UI adapter 接入已落地的
`createSrsReviewServiceV2()`、`vocabulary.review.store.v2` 与持久化 session ledger。
UI 没有新增或复制 `ReviewState` 写入逻辑；评分提交只调用 P7
`recordReviewAttempt()`，继续由 P6 `ReviewTransactionRepository` / UoW 完成原子写入。

本轮只勾选 12.1–12.6。13.x 个人数据报告、14.x 参数优化和 15.x 收尾任务均未启动。
未提交、未推送、未迁入 canonical `E:\read-web`。

## 变更文件

新增：

- `src/features/srs-review/srs-review-ui-service.js`
- `scripts/srs-review-ui-v2-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/wave3b-implementation-report.md`

增量修改：

- `src/features/srs-review/useSrsReview.js`
- `src/features/srs-review/SrsReviewPage.vue`
- `src/features/srs-review/srs-review-flow.js`
- `src/features/srs-review/srs-review.css`
- `src/App.vue`
- `package.json`
- `openspec/changes/separate-vocabulary-acquisition-and-review/tasks.md`（仅 12.1–12.6）

`SrsReviewPage.vue`、`srs-review.css`、`App.vue`、`package.json` 在本轮开始前已有用户未提交
改动；本轮只追加 scoped hunks，没有整文件回退或覆盖。`package-lock.json` 未由依赖安装
改变，安装前后 SHA-256 均为
`b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079`。

## 接入路径

```text
App.vue
  -> createSrsReviewUiService({ managementService: vocabularyService })
  -> createSrsReviewServiceV2()
       -> P7 session ledger repository
       -> P6 ReviewState v2 reader / ReviewTransactionRepository / UoW
       -> P3 append-only learning events
  -> useSrsReview()
       -> resumeReviewSession() / startReviewSession()
       -> getReviewCards(ledger)
       -> recordReviewAttempt()
  -> SrsReviewPage.vue
```

`srs-review-ui-service.js` 只负责读模型组合：按 ledger 的
`learning_unit_id` 读取 graduated LearningUnit、ReviewState v2、目标义项、ContextEvidence
和兼容词条展示字段。它不直接写 review row。旧 vocabulary service 只作为通用释义缓存等
现有展示能力的窄依赖；应用的 due queue 与 rating 提交不再调用旧
`getDueWords()` / `reviewWord()`。

`useSrsReview()` 保留旧 service 形状的兼容分支，供现有独立本地 sample 与既有 focused
verification 渐进迁移；`App.vue` 的真实入口明确传入 V2 UI adapter。Review Service V2 没有
数据时返回 empty；数据库或加载错误进入现有 error/retry 状态，不会让页面抛出到根组件。

## UI 与 attempt 行为

- 评分按钮只有“忘记、困难、一般、容易”，分别映射
  `again/hard/good/easy`；没有第五种 rating。“移除误收录”在 V2 adapter 中不作为 rating，
  且因本轮没有安全的 V2 archive 命令而不暴露为可用写操作。
- 页面在原有单页中显示固化 mode、60 分钟预算、预计剩余时间、backlog 数量/额外时间、
  当前答题条件和同日 revisit 原因。
- attempt 独立传入 `rating`、`prompt_mode`、`cue_level` 与
  `answer_revealed_before_rating`。支持 `word_only`、`original_context`、
  `transfer_context`；cue 按 `none`、目标句、周边语境或已揭示翻译记录。
- 显示句子、周边语境或翻译只改变 cue metadata，不自动改写 rating。真正 rating 仍来自用户
  四档选择并单独交给 scheduler。
- `Again` 动作导致的自动揭示不被误记为“评分前已揭示”；flow 在改变页面状态前冻结该字段。
- 每个 ledger item 在首次提交时生成稳定 attempt draft；失败后同 rating 重试复用相同
  attempt id 与 fingerprint 输入。页面 pending guard、已提交 ledger-item guard 和 P7 持久化
  幂等三层共同防止快速连点重复调度。
- V2 恢复使用固定本地日 session id 与持久化 cursor；刷新后先
  `resumeReviewSession()`，并从 ledger 的 completed items / attempt results 恢复位置与四档计数。
- 同日 revisit 使用独立 ledger item identity，不会被旧的 `word_id` 去重误杀；未到
  `planned_due_at` 时页面显示等待信息并禁用 rating。

## Focused verification

新增 `npm run verify:srs-review-ui-v2`，使用真实 Vue composable、现有 review flow、P4 policy
和 planner，配合只在临时目录存在的合成 ledger/card 数据，覆盖：

- 四个中文动作与 `again/hard/good/easy` 的唯一映射，页面不存在“掌握”第五评分；
- 同一 attempt 快速双触发只调用一次 V2 提交；
- 刷新恢复 ledger cursor、当前 card 和已提交 rating 计数；
- `once_daily`、`balanced`、`intensive` 三种固化 mode 到达 UI；
- `word_only`、`original_context`、`transfer_context` 与对应 cue metadata；
- 60 分钟、36 秒/attempt 计划 100 项，额外 1 项进入 backlog；
- mature `review` 卡答 `again` 产生一次 balanced revisit；
- mature `review` 卡答 `good` 返回 `BALANCED_MATURE_CORRECT`，当日不重复。

验证全部只使用合成数据；未读取真实用户 IndexedDB。

## 验证结果

| 验证 | 结果 |
|---|---|
| `npm run verify:srs-review-ui-v2` | PASS |
| `node scripts/srs-review-service-v2-check.cjs` | PASS |
| `node scripts/srs-review-session-ledger-browser-check.cjs` | PASS；disposable profile / synthetic rows |
| `npm run verify:srs-review` | PASS |
| `npm run verify:vocabulary-srs` | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS；Vite 8.0.14，180 modules transformed |
| `npm run verify:vite` | PASS；load、playback、interaction |
| `git diff --check` | PASS |

冻结的 P0 architecture guard 仍钉住 Wave 3A 落地前
`vocabulary-service.js` hash；该 known/frozen hash 问题沿用
`wave2-canonical-landing-report.md` 记录。本轮没有刷新 guard 或资产。

## 关键 SHA-256

| 文件 | SHA-256 |
|---|---|
| `package.json` | `8c08192265470016d24f46f7aa4012ae23748edd89767b6b8beec01a526b9e4e` |
| `package-lock.json` | `b030a742aa76605e35e6faee9edde3d128cf676e41b7b5c4f5d973fc617d9079` |
| `src/App.vue` | `5862a51a384501dde20aad01012e49c9e50860742b312196fc7a41cda48dba58` |
| `src/features/srs-review/useSrsReview.js` | `a9019771fe223ea1cbfda42628a73f9608dce5198a6c2f1bba6d19557c7bad1b` |
| `src/features/srs-review/SrsReviewPage.vue` | `942dc492d0515ae6c1f7dbb488d7a3bf7d2a566784ad04180b1e881259f9597a` |
| `src/features/srs-review/srs-review-flow.js` | `ea404b4037338a0d94e8f6e0ca9b0ac4a9b55f9fd72d7cd840a589f5f805a333` |
| `src/features/srs-review/srs-review.css` | `8a131f692e9836600e9883e62e23476fe590eb194621e60b9222907509cf663c` |
| `src/features/srs-review/srs-review-ui-service.js` | `c14fc0feac956c8fc37b8006149257d69c7673c5da1a67e326c387b0580ffbe1` |
| `scripts/srs-review-ui-v2-check.cjs` | `e6eb052e17dc64305fa88f94b129acaad08db105239b7fecf45ae9799fd6678c` |
| `tasks.md` | `e0f4f70d6c5fc493405462285bc4239adc18e652b775d46e209d0af014645956` |

报告自身不记录 hash，避免自引用。

## 未触碰内容

- 未修改 `SeekPlayerDB` version 1、`files` object store 或 keyPath `id`。
- 未创建第二套 ReviewState repository、row 或调度提交路径。
- 未访问、迁移、覆盖或删除真实用户数据。
- 未修改 Passage Preview、reader/session runtime、ECDICT、文章结算、考试词导入或 P9
  reassessment 行为。
- P9 仍为 dry-run/default off；acquisition 默认策略未改变。
- 未实现 13.x 个人报告、14.x 参数优化或 15.x 清理。
- 未 reset、stash、clean、整树/整文件回退、提交、推送或写入 `E:\read-web`。

## Canonical 增量落地建议

1. 从当前 canonical dirty 状态重新记录 owner 文件 hash；不要整树复制。
2. 新增复制 `srs-review-ui-service.js`、`srs-review-ui-v2-check.cjs` 和本报告。
3. `useSrsReview.js` 与 `srs-review-flow.js` 可按本 worktree scoped delta 应用。
4. 对已有用户改动的 `SrsReviewPage.vue`、`srs-review.css`、`App.vue`、`package.json`
   只应用本轮新增 hunks；不要整文件覆盖。
5. `tasks.md` 只应用 12.1–12.6 六个 checkbox；13.x 以后保持未勾选。
6. 落地后复跑本报告验证矩阵，并确认 `package-lock.json` 仍为上述 SHA-256。
