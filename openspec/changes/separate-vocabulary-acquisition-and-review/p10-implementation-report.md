# P10 implementation report

日期：2026-07-29
工作树：`C:\Users\0\.codex\worktrees\4bd4\read-web`
基线 `HEAD`：`c623bb335b9082e7ab24479569a4f2250d5789fe`
状态：tasks 11.1–11.6 已完成；未提交、未推送、未迁入 canonical。

## 实现结果

- `vocabulary-service.js` 将写入边界拆为：
  - `upsertVocabularyEntry()`：只写 vocabulary entry/context，不建卡。
  - `queueVocabularyAcquisition()`：flag-on 的 candidate → introduced → acquiring 接入；只在 graduation 命令成功后由 P6 创建 v2 ReviewState。
  - `addWordLegacy()`：flag-off 的显式旧建卡适配器。
  - `addWord()`：保留的临时兼容适配器，带 `legacy-add-word.v1` 标记和调用追踪。
- `srs-candidates.js` 在 flag-on 时只调用 acquisition；`existing + relearn` 不再调用 `relearnWord()`，不创建或重置 legacy/v2 ReviewState。`relearnWord()` 仅存在于 flag-off 的显式 legacy fallback。
- flag-on 的 existing word 使用 `preserve_existing_metadata`，不会隐式改写已有 status/tags/timestamps/review state；允许追加新的文章 context。
- ignored 且未显式 relearn 的候选继续跳过并保持快照不变；known/ignored 的显式 relearn 进入 acquisition；已 graduated 的同 word/sense 复用终态 unit，不重复建 unit 或卡。legacy vocabulary schema 没有 `deleted` 状态；不存在的/已删除 entry 按新 candidate 处理，不会删除或改写其他旧记录。P5 的 `ignored_or_deleted` 仍保持只读审计语义。
- `article-srs-settlement.js` 的 context-only 路径改用 `upsertVocabularyEntry()`，不再经过隐式建卡入口。
- 真实主路径验证从 `applyArticleSrsSettlement()` 进入，覆盖 new、existing context、pending 恢复、失败上抛与重试、known/ignored existing+relearn、ignored skip、graduated 去重和 flag-off fallback。所有 graduation 前场景均断言 legacy `reviewStates` 与 `vocabulary.review.store.v2` 不新增。

## AST guard 与剩余 legacy allowlist

`scripts/vocabulary-add-word-boundary-check.cjs` 使用 Babel AST 扫描 `src/**/*.{js,mjs,cjs,vue}`，覆盖：

- dot/bracket/computed member；
- optional member/call；
- 解构和赋值别名；
- 间接别名链；
- `bind`、`call`、`apply`；
- `Reflect.apply` 与 `Reflect.construct`；
- feature flag 条件极性；只允许实际 flag-off 分支中的 legacy fallback。

守卫内置 16 个绕过自测和 3 个 fallback 极性自测。反向条件
`if (!acquisitionEnabled) {} else { addWordLegacy(...) }` 必须产生 forbidden finding；
`if (acquisitionEnabled) {} else { addWordLegacy(...) }` 及 legacy 位于
`if (!acquisitionEnabled)` consequent 的等价写法可放行。生产 allowlist 精确为：

1. 兼容定义：`src/services/vocabulary/vocabulary-service.js` 的 `addWord()`。
2. 兼容定义：`src/services/vocabulary/vocabulary-service.js` 的 `addWordLegacy()`。
3. 唯一允许调用：`src/services/vocabulary/srs-candidates.js` flag-off `else` 分支中的 `addWordLegacy()`，caller 为 `srs-candidates:feature-flag-fallback`。

除以上项目外，生产代码 forbidden finding 为 0。

## 精确 owned diff 与 SHA-256

| 文件 | P10 owned change | SHA-256 |
|---|---|---|
| `src/services/vocabulary/index.js` | 增量导出已落地 P1–P6 模块 | `2f3579e855e8dca7fde670d76339454ae77927a1afeca6fb4b6c1ec6656bb06a` |
| `src/services/vocabulary/vocabulary-service.js` | upsert/acquisition/legacy adapter、flag、trace、既有 metadata 保护 | `7fcc65404b019e9f7da0eef6c5daf6adc71132aa716720716111df0f0948c432` |
| `src/services/vocabulary/srs-candidates.js` | flag-on acquisition 与 flag-off legacy 分流 | `4279e30091a6072fe92ad34711e7e862bb5456dbe84600cf0baaf5c4605dbef0` |
| `src/services/vocabulary/article-srs-settlement.js` | context-only 显式 upsert | `fc5c16a5a0f6f1dca400de5b52e641be655132d24713f277d0cbed9366af1975` |
| `scripts/vocabulary-article-acquisition-check.cjs` | P10 真实文章结算主路径 focused verification | `268fb81f2f4acfa0ee89b3fb892d9beddf7b9eccda1db7ddf142dbeb58d3920c` |
| `scripts/vocabulary-add-word-boundary-check.cjs` | AST guard、极性判断、Reflect 绕过与自测 | `2028de523d93b39fda81c7eef551d19b5d2d6312dd424f9790702c905e3e4f43` |
| `scripts/annotation-backfill-ai-module-check.cjs` | fixture 显式 legacy adapter 与新模块 staging | `d7790d04c4b1902ce725a8ed09308a1a1d18f4dfc9b6c4280aa1e4c18869dd20` |
| `scripts/vocabulary-preview-service-check.cjs` | 旧建卡 fixtures 显式调用 `addWordLegacy()` | `5db7fbe88c4f21e8eb777c7c00e8d7b5c7177fe9640d27a67eb2a68ea3186b85` |
| `scripts/vocabulary-srs-service-check.cjs` | 旧 SRS fixtures 显式调用 `addWordLegacy()` | `36665a37a96d9de3da26734224e4a882fc53ca72933d46b6bf51d01255c356ce` |
| `package.json` | P10 仅拥有两条 verify script 键 | `6a1a61e6a0b754b038436129153ca790aabf65df8e238bb1b9b6d65cfd14ebde` |
| `tasks.md` | 仅 11.1–11.6 勾选 | `b8a37a458c1be57bc0505744fff574d34b07c85c79fb5680b50195d876dcd82c` |

`package.json` 中 P10 仅拥有：

```json
"verify:vocabulary-article-acquisition": "node scripts/vocabulary-article-acquisition-check.cjs",
"verify:vocabulary-add-word-boundary": "node scripts/vocabulary-add-word-boundary-check.cjs"
```

其余 package/package-lock 改动属于起点中其他 wave 或用户改动，不是 P10 owned diff。

## 验证

通过：

- P10：`verify:vocabulary-article-acquisition`、`verify:vocabulary-add-word-boundary`。
- P1–P6/Wave 1：acquisition repository、context evidence、learning events、review policy/planner、legacy audit、receipt fingerprint、Wave 1 integration、acquisition service、learning UoW browser。
- 受影响回归：annotation backfill、vocabulary preview、vocabulary SRS、SRS review、passage preview unit/browser。
- `npx openspec validate separate-vocabulary-acquisition-and-review --strict`。
- `npm run build`。
- `npm run verify:vite`。
- `npm run verify:production-preview`。

2026-07-29 轻量终验重新运行：

- `npm run verify:vocabulary-add-word-boundary`；
- `npm run verify:vocabulary-article-acquisition`；
- `npm run build`。

冻结 P0 guards 仍有三项起点既有失败，P10 未修改冻结资产：

1. `p0-contract-check.cjs`：guard regex 只接受 LF，而当前 `p0-contracts.md` 为 CRLF。
2. `p0-snapshot-check.cjs`：实际 fixture SHA `864044fe1576e7603d708bb65fd80e855a35bdecbca5754cfddf1144cec471cc`，冻结期望 `d66511eb2778552fe39088236d04b2fc3d5ad7abdad92965fbf44dd75367d932`。
3. `p0-architecture-guard.cjs`：`reader-runtime.js` 实际 SHA `d1e00419c0fa7644c4861497e59b1a3bc93d8534bf886a5dbc6f7c146683735a`，冻结期望 `bfd74109d8d93e20518f10d888dc114f0e76114820e7bc87fbdb57926ebf0a33`。

## Canonical 增量合并要求

- canonical `E:\read-web` 的 `package.json` 比本 P10 起点更新，并含用户脚本 `preview:build-package`。集成时只能增量加入上述两条 P10 verify script；禁止整文件复制 P10 `package.json`，禁止删除或覆盖 `preview:build-package` 及其他 canonical 用户脚本。
- 当前 `src/services/vocabulary/index.js` 只导出已在本起点落地的 P1–P6 模块。未来组合落地时由 integration owner 基于 canonical 增量导出已实际存在的 P7/P8/P9 模块；当前 P10 不伪造、不引用不存在文件。
- 合并应按本表逐文件审阅，不得覆盖 canonical 的 SRS UI、P7 review service、P8 importer、P9 reassessment 或任何起点用户改动。
- 未改变 `SeekPlayerDB` version 1、`files` object store 或 `id` keyPath；未删除任何新旧记录。
