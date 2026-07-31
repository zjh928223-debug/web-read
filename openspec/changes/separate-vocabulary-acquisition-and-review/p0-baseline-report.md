# P0 契约与基线报告

日期：2026-07-27
状态：P0 已完成；P1–P5 gate 开启
范围：仅 P0，没有实现业务模块

## 快照安全方法

`verification/p0-snapshot-check.cjs` 只读取显式离线 JSON，不打开浏览器、repository 或 IndexedDB，也不写文件。公开 test-only key 仅在默认 fixture 的原始 bytes 与固定 SHA-256 完全相同时启用；只要默认路径内容发生一个 byte 的变化，脚本就在 HMAC 前拒绝。个人快照必须由用户先明确授权导出到其他路径，并设置至少 32 bytes 的秘密：

```powershell
$env:P0_SNAPSHOT_HMAC_KEY = '<用户保管的随机秘密>'
node openspec/changes/separate-vocabulary-acquisition-and-review/verification/p0-snapshot-check.cjs '<offline-row.json>'
```

脚本使用 HMAC-SHA-256 伪名化文本和 ID；不输出 key。ReviewState/before/after 仅输出白名单，未知字段只报告字段路径。未知 `state` 先映射为 `null`，随后以 `UNKNOWN_REVIEW_STATE` 拒绝生成报告，绝不伪造成 `new`。脚本比较读前后 bytes、size、mtime，并报告是否访问 IndexedDB。

用户于 2026-07-27 明确授权后，已从实际页面 `http://127.0.0.1:4173/` 只读取得真实迁移前快照。读取使用 `SeekPlayerDB` version 1、唯一 object store `files`、`keyPath: 'id'` 和 `readonly` transaction；原始 JSON 仅短暂保存到仓库外临时目录，checker 只读取该离线文件。

真实快照结果：

- row：`vocabulary.srs.store.v1`，`schemaVersion: 1`
- 计数：845 words、918 contexts、845 review states、514 review logs
- source HMAC-SHA-256：`a9fa82d38de05cab8e6a24ae62d4398d0af2f175cffb07b7de9b862e19c5377c`
- sanitized SHA-256：`b83d45647ef1a93866ff4e6c011bc75747015111b07c95575063b8dd0736ab3e`
- 脱敏产物：`verification/p0-real-snapshot-sanitized.json`
- HMAC secret 由 Node `crypto.randomBytes(48)` 在进程内生成，未输出、未写盘、未提交。
- checker 报告 `input_mutated: false`；执行前后再次通过 `readonly` transaction 读取并比较完整 row，JSON bytes、DB version、store 列表和 keyPath 均一致。
- 对 3,914 个原始敏感字符串进行精确 JSON 字符串碰撞检查，脱敏产物中的原文碰撞为 0。
- 原始仓库外临时文件在验证和报告完成后删除；仓库和 worktree 中均不保留原始单词或句子。

- fixture 原始 SHA-256（公开 key gate）：`d66511eb2778552fe39088236d04b2fc3d5ad7abdad92965fbf44dd75367d932`
- fixture source HMAC-SHA-256：`fdca94c2e46a847cee2c4ac9a361ab3c75ce86b1858a44f132d4bda0ce033600`
- sanitized SHA-256：`81c16b7be9606e049742547e20b9865461f773a0fd5b73f3086175ddf2632a30`
- 未知字段 `private_note`、`secret_hint` 的值未进入脱敏输出。

## 既有基线

首次因 `node_modules` 不存在而出现环境失败：vite/playwright/ts-fsrs 未找到。执行现有 lockfile 的 `npm ci` 后：

| 命令 | 结果 |
|---|---|
| `node .../verification/p0-snapshot-check.cjs` | PASS |
| `node .../verification/p0-architecture-guard.cjs` | PASS |
| `node .../verification/p0-contract-check.cjs` | PASS |
| `openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS |
| `npm run verify:vite` | PASS |
| `npm run verify:vocab-matching` | PASS |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run verify:vocabulary-preview` | PASS |
| `npm run verify:srs-review` | PASS |

依赖安装报告 2 moderate、2 high vulnerabilities；未运行 `npm audit fix`。当前无代码级既有失败。

## Guard

`verification/p0-architecture-guard.cjs` 使用 `@babel/parser` AST：

- 检查点式、bracket access、optional chaining、解构、赋值与 `.bind()` 别名后的 IndexedDB open/createObjectStore 调用；追踪 database/open-request aliases，并拒绝数据库对象动态成员调用。
- 新调用必须直接使用 literal `SeekPlayerDB`、version `1`、`files`、`{ keyPath: 'id' }`。
- repository factory 只允许无参数或 literal `{ indexedDBApi }`；运行时 options、spread、`dbName/dbVersion/storeName` 属性均拒绝。
- 当前已有可注入 repository seam 没有在 P0 修改业务代码，而是连同其 production 调用链按精确文件 SHA-256 冻结；任一 byte 变化都会失败，新文件不能继承例外。
- 固化 `reader-runtime.js` 与 `session-init.js` 的当前薄入口 hash。
- 自测覆盖 optional/bracket open、绑定/赋值 open alias、optional/bracket/bound/destructured createObjectStore、`db[method](...)`、`Reflect.apply(indexedDB.open, ...)`、运行时 factory options、spread 和 schema override。

## 契约

`p0-contracts.md` 以字段表冻结每个 DTO 的类型、必需性、nullability、默认值、约束和稳定错误。`verification/p0-contract-check.cjs` v2 将十个 DTO 的 184 个字段解析为结构化语义快照并固定 SHA-256；类型、必需性、可空性、默认/约束或字段集合任一变化都会失败，并有对应 mutation self-test。关键决策：

- 同一 `word_id` 允许多个 active target senses；唯一键是 `(word_id, target_sense_key)`。
- `acquisition-delay.v1` 固定为至少 86,400,000ms 且必须跨 acquisition episode。
- AcquisitionAttempt、ReviewAttempt、LearningEvent 均保存 command/attempt/reveal/eligibility 可追溯字段。
- ReviewState v2 以 `learning_unit_id` 关联并归属 `vocabulary.review.store.v2`。
- ContextEvidence 固定归属 `vocabulary.context-evidence.store.v1`，P2 提供普通 repository 和 transaction binding，P6 在同一 transaction 读取并验证 anchor。
- `GraduationEligibilityInput`、显式 `evaluated_at` 来源和完整稳定 reason-code 顺序已冻结。
- 每个 command 有独立 `command-receipt.v1` row，保存 canonical payload fingerprint、完整 result、result hash 与 touched rows/events。
- `vocabulary-learning-uow.v1` 在同一 `files` transaction 提交 acquisition、review v2、event manifest/shard 和 receipt；跨刷新相同 fingerprint 返回已存 result，不同 fingerprint abort。
- P1/P2/P3 binder 只接收底层 `VocabularyLearningTransactionRowPort`；P6 先创建 row port、绑定四个 repository，再组装完整 UoW，消除 binder/UoW 循环依赖。
- P1–P5 的 normalize/assert/repository/planner/audit 函数签名已逐项固定，公开 IndexedDB 工厂不得接受 schema override。
- `ReviewTransactionRepository`、review v2 repository 和共享 UoW 的唯一实现 owner 是 P6；P7 等待 P6 并复用。

design 的 wave 已与 tasks/parallel plan 对齐；P6 明确依赖 P1+P2+P3。

## 并行 worktree 与 gate

五个 worktree 均从 canonical working tree 的 HEAD `c623bb335b9082e7ab24479569a4f2250d5789fe` 建立，并复制当时全部 tracked diff 与显式 untracked manifest。未对原 working tree 执行 commit、stash、reset 或清理。

| Wave | Branch | Worktree |
|---|---|---|
| P1 | `codex/vocab-p1-acquisition` | `E:\read-web-worktrees\vocab-p1-acquisition` |
| P2 | `codex/vocab-p2-context` | `E:\read-web-worktrees\vocab-p2-context` |
| P3 | `codex/vocab-p3-events` | `E:\read-web-worktrees\vocab-p3-events` |
| P4 | `codex/vocab-p4-review-policy` | `E:\read-web-worktrees\vocab-p4-review-policy` |
| P5 | `codex/vocab-p5-legacy-audit` | `E:\read-web-worktrees\vocab-p5-legacy-audit` |

每个 worktree 的 branch、HEAD、dirty path manifest 和逐文件 SHA-256 均与 canonical baseline 核对一致。任务开始后，各 wave 必须只在自己的 worktree 和声明文件范围内编辑。

P0 的 1.1–1.5 已全部完成，进度为 5/90；P1–P5 gate 开启。本报告仅开启 gate，没有启动任何 Wave 1 业务实现。
