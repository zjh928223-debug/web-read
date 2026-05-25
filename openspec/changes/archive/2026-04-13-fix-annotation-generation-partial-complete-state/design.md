## Context

当前问题的主线已经定位清楚：target 实际进入了 plan，但 provider 返回数量不足、或 provider 返回后在 normalize 阶段没有形成完整 item 时，generated bundle 会少条目。现有 controller 并不校验“本次请求的 target 是否真的都落成 generated item”，而是只要 block request 成功完成，就把整次运行通过 `deriveBundleState()` 判成 `complete`，随后 entry UI 也按 `resultState = complete` 去显示。

这次 change 只修“少条目但仍判 complete”的问题。范围必须控制在 controller 的 final-state derivation、incremental completion semantics，以及 controller 结果映射到 entry UI 的表达层。provider 为什么会少回、merge 是否要 replace/repair、以及 refresh 后 entry restore 状态是否要更聪明，全部不在本次范围。

## Goals / Non-Goals

**Goals:**
- 让 controller 的 final state 基于“target 是否补齐”而不是只基于“block request 是否成功返回”
- 让 requested / generated / missing 这些计数进入状态判定与消息生成
- 当仍存在 missing targets 时，返回准确的非完成语义，而不是误报 `complete`
- 让 entry UI 忠实反映 controller 的更准确结果语义
- 保留并增强 diagnostics，方便继续追踪 requestedTargetCount、returnedCount、normalizedCount、generatedTargetsCount、missingTargetsCount、final result state

**Non-Goals:**
- 不修改 provider 行为，不尝试强制 provider 一定返回所有 target
- 不修改 `appendGeneratedItems()` 的 add-only merge 语义
- 不引入 replace / repair / bulk replace 策略
- 不修改 refresh 后 entry restore 状态逻辑
- 不重构 annotation controller、storage、restore、bubble、click resolver

## Decisions

### Decision 1: final state 以“是否仍有 missing targets”作为完成判定门槛

当前 `deriveBundleState()` 更接近 block-level 成功判定，而不是 target-level 完整性判定。本次改为：controller 在结束时必须重新对当前 target 集与最终 generated bundle 做一次 completeness 判断；只要仍有 missing targets，就不得落成 `complete`。

备选方案：
- 只看 provider `returnedCount` 是否等于 `targetCount`：不够稳，因为 provider 可能返回了 item，但 normalize 后仍会丢
- 只看 merge `insertedCount`：也不够稳，因为已有 item 与本次新增 item 的关系需要放回完整 generated bundle 才能判断

### Decision 2: 保持 add-only merge，不把“状态修正”扩成“数据修正”

本次只修状态语义，不碰 replace/repair。也就是说，controller 会更诚实地说“还没补齐”，但不会因为状态问题顺手改变 merge 行为。

备选方案：
- 直接给 merge 增加 patch/replace：超范围，会把这次最小修复变成数据策略 change

### Decision 3: diagnostics 必须把“请求过多少、产出了多少、最终还缺多少”连成一条证据链

仅靠最终 `resultState` 不足以继续排查 provider 产出不足场景。本次要求 diagnostics 至少把 `requestedTargetCount`、`returnedCount`、`normalizedCount`、`generatedTargetsCount`、`missingTargetsCount` 和 final state 连起来，方便继续区分“provider 少回”与“provider 回了但 normalize/merge 后没补齐”。

备选方案：
- 只改状态不补 diagnostics：会让后续复测再次失去定位依据

### Decision 4: entry UI 只忠实映射 controller 结果，不自行发明第二套完整性规则

这次 entry UI 不单独去重算 generated completeness，而是以 controller 返回的更准 resultState 为主，避免 controller 和 UI 各自维护不同判定规则。

备选方案：
- 在 entry UI 自己再读 generated bundle 和 diff 重新判断：会导致规则分叉，增加后续不一致风险

## Risks / Trade-offs

- [Risk] 状态从 `complete` 改为更准确的非完成语义后，用户会更频繁看到“未补齐” → Mitigation：这是本次目标，必须优先保证语义诚实
- [Risk] 现有 UI 只有 `complete / partial-failed / retryable` 等状态，新增或细化状态需要与既有展示兼容 → Mitigation：优先复用最接近的现有状态或做最小新增，避免大改 UI 结构
- [Risk] provider 返回不足与 normalize 过滤在 diagnostics 中可能仍需进一步细分 → Mitigation：本次至少把 returned / normalized / final missing 暴露出来，为后续单独 change 提供依据
