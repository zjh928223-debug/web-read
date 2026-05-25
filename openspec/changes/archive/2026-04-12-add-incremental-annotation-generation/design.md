## Context

当前 annotation generation pipeline 已经具备以下基础：

- `annotation-target-source.js` 会把 raw `** **`、imported `marks.json`、manual marks 统一成同一套 target shape。
- unified target 已经带有稳定 occurrence identity，当前最合适的主键是 `occurrenceKey`，并辅以 `occurrenceGlobalStart` / `occurrenceGlobalEnd` 等定位字段。
- `annotation-generated-result-store.js`、`annotation-click-resolver.js`、generated bundle 持久化链路已经能消费 `occurrenceKey`，说明“重复单词按 occurrence 区分”这件事已经在消费链路上成立。
- `annotation-generation-controller.js` 当前负责 planner、prompt builder、API client、bundle merge、storage save 和 progress/status 回调。
- `annotation-block-planner.js` 当前按 block cap 规划请求，但默认仍基于当前上下文中的全量 targets。

因此，这次 change 不需要重做 generation pipeline 主结构。真正缺的是一个统一的“当前 targets 与当前 document scope 下已生成 annotations 的差集”能力，以及一个只围绕 missing targets 规划 blocks 的最小增量入口。

## Goals / Non-Goals

**Goals:**

- 在当前 document scope 下，基于统一 target identity 计算 missing targets。
- 让“生成全文注释”入口先做 diff，再决定是否真的发起 provider request。
- 无 missing targets 时，不发 provider request，并返回可区分于普通 complete 的 no-op 结果。
- 有 missing targets 时，只把 missing targets 送入 planner / generation pipeline。
- 在不突破现有 block caps 的前提下，尽量减少 provider request 次数。
- 增量生成回写时只补缺，不丢失已有 generated items，不默认覆盖旧结果。
- 保持 generated restore / index refresh / click resolver / bubble consumption 继续正常。

**Non-Goals:**

- 不做“自动随标随生成”。
- 不做“重新生成全部”或复杂的 replace / overwrite 策略。
- 不改 bubble UI、click resolver 主职责、API settings UI 主逻辑。
- 不做 generation pipeline 大重构。
- 不做版本管理、历史快照、撤销系统。

## Decisions

### 1. 用 `occurrenceKey` 作为 diff / planner / merge 的统一 target identity

沿用 unified target source 已经稳定输出的 `occurrenceKey` 作为增量生成的主键，不在 diff、planner、storage merge、click consumption 各自发明新的匹配规则。

原因：

- `markedText` 不能区分重复 occurrence。
- `boundary` 是模型产物，不适合作为 generation 前的 identity。
- `occurrenceKey` 已经贯穿 target source 和 generated result store，最适合扩展到 diff 语义。

备选方案：

- 使用 `markedText + sentenceIndex + globalStart` 现场重新拼 key：可行，但会把 identity 规则重复散落到多处。
- 使用 `targetId`：不稳，因为它更像一次规划内的局部编号，不适合作为 restore 后的长期 identity。

### 2. 新增一个薄 diff helper，集中计算 missing targets

新增一个薄模块，例如 `annotation-generation-diff.js`，职责仅包括：

- 从当前 reader context 构建 unified target source
- 从当前 document scope 的 generated bundle 读取已有 items
- 以 `occurrenceKey` 为主键计算：
  - `allTargetsCount`
  - `generatedTargetsCount`
  - `missingTargets`
  - `missingTargetKeys`

原因：

- 差集逻辑如果散落到 `app.js`、controller、UI 多处，后续很容易出现“刚生成完却仍判 missing”的不一致。
- 集中 helper 更容易和 restore 后的 generated bundle 保持一致。

备选方案：

- 直接在 `app.js` 里对 `targetSource` 和 `store` 做一次性差集：实现快，但会让业务规则散落在入口 wiring。
- 把 diff 全塞进 planner：planner 应负责规划，不应兼任 generated state 对比。

### 3. controller 负责“先 diff、再按 missing targets 规划”

保留 `window.AnnotationGenerationController.startFullArticle(...)` 这条主入口，但其内部语义升级为：

1. 读取当前 target source
2. 读取当前 scope 的 generated bundle
3. 计算 missing targets
4. 若 `missingTargets.length === 0`，直接返回 no-op / up-to-date 结果
5. 若有 missing targets，则把 missing target 子集送给 planner

原因：

- controller 已经是 generation orchestration 的中心，最适合承接这条行为升级。
- 这样 `app.js` 仍保持薄 wiring，不需要理解 diff、merge、planner filtering 的细节。

备选方案：

- 让 entry UI 先 diff 再决定是否调用 controller：会把业务语义推到 UI 层，后续 restore/refresh 更难统一。

### 4. planner 增加“只规划指定 target 子集”的最小入口

不改变现有 block 规则和 caps，只增加一个最小过滤入口，例如：

- 接收 `targetSource` 或 `targetFilterKeys`
- 只保留 missing target 子集参与 sentence/block 规划

这意味着：

- missing 很少时，planner 会只输出 1 个小 block，于是只发 1 次 request
- missing 很多时，planner 仍按现有 caps 拆成最少 block 数

原因：

- 这满足“尽量在 planner 输入侧就只传 missing targets，避免无意义规划和状态噪音”。

备选方案：

- 先对全量 targets 做 planning，再在 controller 里逐 block 过滤：会保留大量空 block / 无意义状态，不符合这次 change 目标。

### 5. generated bundle 回写采用“补缺合并，不默认替换”

controller 当前已经有 bundle append / merge seam。这里将其明确化为增量语义：

- 旧 bundle 作为 merge base
- 新生成 items 只按 `occurrenceKey` 补充缺失项
- 已存在同一 `occurrenceKey` 的旧 item 默认保留
- 不做批量替换旧结果

原因：

- 这次 change 的目标是补缺，不是重生成替换。
- 旧 item 一旦可点击可恢复，就不应该因为一次补生成被静默覆盖。

备选方案：

- 同 key 时以新结果覆盖旧结果：适合未来的 regenerate / replace 模式，但超出本次边界。

### 6. entry/status 新增“无缺口未发请求”的诚实状态语义

这次不会大改按钮文案，但需要新增一个可区分结果，例如：

- `up-to-date`
- 或 `no-missing-targets`

该状态必须满足：

- 不是 `failed`
- 不是普通 `complete`
- 能明确告诉用户这次没有发 provider request

同时，对于有缺口且成功补生成的场景，status message 应体现“补生成了 N 项”或等价语义。

原因：

- 用户需要知道这次操作是 no-op 还是实际调用了 API。

## Risks / Trade-offs

- [Risk] `occurrenceKey` 规则若未来被 target source 修改，diff 与 click consumption 会一起受影响。  
  → Mitigation：在 helper、planner、merge、store 中统一复用同一 identity 字段，不再新增并行规则。

- [Risk] restore 后的旧 bundle 若含早期缺少 `occurrenceKey` 的 items，可能影响 diff 准确性。  
  → Mitigation：设计中要求优先兼容当前已有 occurrence-aware bundle；对极旧数据可保守视为不可可靠命中，不冒进判定为已生成。

- [Risk] “无缺口”状态如果命名或展示不清晰，用户仍会误以为系统发起了请求。  
  → Mitigation：spec 明确要求该状态与普通 complete 区分，并明确表达未发 provider request。

- [Risk] missing targets 稀少时如果 planner 仍按句子/块分散，可能比预期多发请求。  
  → Mitigation：保持现有 block cap 规则，但只围绕 missing target 子集建块，优先让少量 missing 收敛成最少 blocks。

## Migration Plan

1. 新增 diff helper，并复用当前 `occurrenceKey` identity。
2. 修改 planner 以支持 target 子集规划。
3. 修改 controller，先 diff，再决定 no-op 或增量生成，并将新 items 合并入旧 bundle。
4. 修改 entry/status renderer，区分“无缺口未发请求”和“补生成完成”。
5. 用 restore + repeated click + repeated word 场景回归验证 diff、merge、refresh、click consumption。

本次 change 不涉及后端迁移，也不涉及数据格式强制重写；以向后兼容读取、前向写入增量语义为主。

## Open Questions

- `up-to-date` 与 `no-missing-targets` 哪个状态名更适合现有状态体系，需要在实现前统一。
- 对极旧 generated bundle 中缺少 `occurrenceKey` 的 item，最终是保守忽略，还是做一次受限 fallback 匹配，还需要在实现时根据现有样本决定。
