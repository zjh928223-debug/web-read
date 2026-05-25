# standalone-annotation-generation-pipeline Specification

## Purpose
TBD - created by archiving change add-standalone-annotation-generation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Standalone annotation generation controller

The system MUST provide an independent annotation generation controller through `window.AnnotationGenerationController`. The controller MUST manage full-article generation orchestration and MUST NOT own bubble DOM, entry/status DOM, API settings UI, or the reader playback/highlight main flow.

#### Scenario: Controller starts from existing entry seam
- **WHEN** page-level entry UI calls `window.AnnotationGenerationController.startFullArticle(context, callbacks)`
- **THEN** the controller MUST accept reader document context
- **AND** the controller MUST emit normalized progress/status through callbacks
- **AND** the controller MUST NOT call bubble-only APIs directly

### Requirement: Block remains the execution and progress unit

The system MUST keep article block as the execution unit and progress-reporting unit for annotation generation. A block MUST NOT be treated as the final annotation content unit shown to users.

#### Scenario: Progress stays block-based
- **WHEN** the system runs full-article annotation generation
- **THEN** progress MUST continue to report total/completed/failed/running by block
- **AND** final annotations MAY be multiple compact annotation items inside one block

### Requirement: Unified target source drives generation

Annotation generation target input MUST come from a unified target source. The system MUST support these three sources:

- raw `** **` markup
- imported `marks.json`
- current page manual marking

#### Scenario: Multiple source adapters feed one pipeline
- **WHEN** the system reads raw markup, imported marks, or manual marks
- **THEN** each source MUST be normalized into a unified target shape before generation
- **AND** later stages MUST NOT depend on source-specific input formats

### Requirement: Each target is resolved through sentence context

Each unified target MUST be mapped to its containing full sentence before generation. The system MUST treat `markedText` as the user-marked starting point, not as the final boundary decision.

#### Scenario: Target enters sentence-aware generation
- **WHEN** any target from raw markup, imported marks, or manual marking enters the pipeline
- **THEN** the system MUST locate the target inside its containing full sentence
- **AND** the prompt builder MUST use that full sentence as generation context

### Requirement: Final boundary is sentence-context-aware

The model MUST determine final `boundary` from sentence context instead of mechanically preserving or expanding the original mark.

#### Scenario: Boundary stays a single word when appropriate
- **WHEN** the marked target is best understood as a single word inside its sentence
- **THEN** the final `boundary` MUST be allowed to remain that single word

#### Scenario: Boundary expands to phrase when appropriate
- **WHEN** the marked target is best understood as a fixed collocation, phrase, or phrasal verb inside its sentence
- **THEN** the final `boundary` MUST be allowed to expand to that natural phrase boundary

### Requirement: Occurrence identity remains stable through generation and click consumption

The system MUST preserve stable occurrence identity from unified target creation through generated-result persistence and click consumption. The system MUST NOT rely only on `markedText`, `boundary`, or other pure text matching to distinguish repeated occurrences.

#### Scenario: Repeated occurrences remain distinct
- **WHEN** the same marked word appears multiple times in one document
- **THEN** each occurrence MUST keep distinct identity through target normalization, generation output, persistence, restore, and click resolution

#### Scenario: Click resolver prefers occurrence identity
- **WHEN** the user clicks a marked word that has a generated annotation
- **THEN** the click resolver MUST first resolve by stable occurrence identity
- **AND** it MAY fall back to legacy text-based matching only when occurrence identity is unavailable

### Requirement: Sentence context does not leak into final user-facing result

Sentence context MUST be used only for internal generation reasoning. The final generated annotation result MUST remain compact and MUST NOT expose the sentence as a display field or persisted user-facing field.

#### Scenario: Compact result remains stable
- **WHEN** the system normalizes provider output into persisted/generated annotation items
- **THEN** the result MUST remain limited to compact annotation fields plus the smallest necessary internal occurrence identity fields
- **AND** the result MUST NOT include full sentence text as a user-facing field

### Requirement: Prompt builder uses sentence context and compact output contract

The prompt builder MUST pass the target sentence and optional block-local context to the model, while enforcing a compact output contract.

#### Scenario: Prompt builder supplies sentence-aware context
- **WHEN** prompt builder creates payload for one block
- **THEN** it MUST include each target's containing sentence for interpretation
- **AND** it MAY include block-local context as auxiliary context
- **AND** it MUST instruct the model not to output sentence text in final annotation fields

### Requirement: Output language style serves Chinese learners and stays concise

The generated annotation output MUST use a language style suitable for Chinese-speaking English learners and MUST stay compact enough for quick reading in the bubble.

#### Scenario: Meaning is concise natural Chinese explanation
- **WHEN** the system generates `meaning`
- **THEN** `meaning` MUST primarily be a natural and easy-to-understand Chinese explanation
- **AND** it SHOULD usually stay within 1 to 2 concise sentences
- **AND** it MUST NOT degrade to a pure English dictionary gloss
- **AND** it MUST NOT degrade to an overly short word-for-word translation only

#### Scenario: Memory hint is concise Chinese plus English cue
- **WHEN** the system generates `memoryHint`
- **THEN** `memoryHint` MUST combine Chinese guidance with English boundary breakdown, collocation cues, or chunk-level memory hints
- **AND** it SHOULD usually stay within 1 concise sentence
- **AND** it MUST NOT be pure English only

### Requirement: Final generated result remains compatible with current bubble consumption

The generated result contract MUST remain compatible with the current click resolver and annotation bubble consumer chain.

#### Scenario: Bubble-compatible compact result
- **WHEN** a generated annotation item is restored, indexed, resolved, and sent to the bubble
- **THEN** the item MUST remain consumable through the existing compact structure
- **AND** the pipeline MUST NOT require a bubble-specific redesign

### Requirement: Bubble presentation stays compact

The bubble presentation MUST stay compatible with generated annotations while removing redundant front-end fields.

#### Scenario: Bubble no longer shows markedText row
- **WHEN** the bubble renders a generated annotation
- **THEN** it MUST show `boundary`, `meaning`, `type`, and `memoryHint`
- **AND** it MUST NOT show `markedText` as a visible row
- **AND** `markedText` MAY remain in the internal annotation data structure for compatibility

### Requirement: No-targets remains an honest non-success terminal state

The system MUST keep `no-targets` / all-skipped runs as non-success terminal states.

#### Scenario: No marks produce no-targets state
- **WHEN** the current article has no usable marks from any supported target source
- **THEN** generation MUST end in a non-success `no-targets`-like state
- **AND** the UI MUST NOT present the run as completed success

### Requirement: Generated annotations and status persist per audio document

The system MUST persist generated annotations and generation status per audio/document scope.

#### Scenario: Restore previously generated compact results
- **WHEN** the user reopens the same audio/document
- **THEN** the system MUST restore previously generated compact annotation results and status
- **AND** restored results MUST remain compatible with click resolver and bubble consumption
- **AND** restored results MUST retain the occurrence identity needed for stable repeated-word resolution

### Requirement: Incremental generation reuses the same occurrence-aware identity across diff, planning, and merge

系统 MUST 在 incremental generation 路径中复用与 unified target source、generated result store、click resolver 相同的稳定 occurrence-aware identity。diff、planner、controller merge 和 generated refresh MUST 使用同一套 identity 语义，而不是各自定义不同的匹配规则。

#### Scenario: Incremental helper and generated store agree on target identity
- **WHEN** 系统计算 missing targets 并准备生成
- **THEN** diff helper、planner、controller merge 和 generated result store MUST 以同一稳定 target identity 识别 target
- **AND** 系统 MUST NOT 在不同层分别发明不同的重复词匹配规则

### Requirement: Planner can operate on a target subset instead of whole-article targets

现有 planner MUST 能在保留 block 规则和 cap 规则的前提下，只围绕指定的 target 子集进行规划。对于 incremental generation，这个 target 子集 MUST 是 missing targets，而不是当前上下文中的全量 targets。

#### Scenario: Planner builds blocks only for missing targets
- **WHEN** controller 传入一个仅包含 missing targets 的 generation context 或等价过滤条件
- **THEN** planner MUST 只为这些 missing targets 建立 blocks
- **AND** planner MUST NOT 将已生成 targets 混入本次 block planning

### Requirement: Restore and immediate re-run use merged generated state consistently

系统 MUST 让 restore 后的 generated state 与刚完成 merge/refresh 后的 generated state 使用同一套增量判断语义。一次增量生成刚完成并完成 merge/refresh 后，重复点击生成 MUST NOT 继续把刚生成的 targets 误判为 missing。

#### Scenario: Immediate re-run after incremental completion is up to date
- **WHEN** 系统刚完成一次增量生成，并已将新增 items 合并入 generated bundle 且刷新 generated index
- **THEN** 用户立刻再次点击生成时，diff MUST 识别这些 targets 已经存在
- **AND** 系统 MUST 进入无缺口 no-op 结果，而不是再次请求 provider

### Requirement: Generation pipeline exposes block-level diagnostics for target, response, and merge counts
annotation generation pipeline MUST 在 block 粒度暴露可诊断计数，至少包括每个 block 的 `targetCount`、本次实际请求的 block 标识、provider `returnedCount`、merge 前 item 数量与 merge 后 item 数量。

#### Scenario: Block generation is observable end to end
- **WHEN** controller 针对某个 block 发起 annotation generation request
- **THEN** diagnostics 输出 MUST 记录该 block 的 `targetCount`
- **AND** diagnostics 输出 MUST 记录该 block 的 provider `returnedCount`
- **AND** diagnostics 输出 MUST 记录 merge 前后 generated item 数量变化

### Requirement: Generation pipeline diagnostics carries stable identity samples
annotation generation pipeline MUST 在 diagnostics 中暴露与当前链路一致的稳定 identity 样本，以便验证 diff、planner、merge 与后续消费使用的是同一套 identity 语义。

#### Scenario: Identity samples can be compared across pipeline stages
- **WHEN** 系统为某个 block 规划 targets、生成 annotation、并执行 merge
- **THEN** diagnostics 输出 MUST 至少包含该 block 对应的 `blockId`
- **AND** diagnostics 输出 MUST 提供可用于抽样比对的 `occurrenceKey`、target key 或等价稳定 identity 样本
- **AND** 不同阶段的 diagnostics 输出 MUST 能用这些字段对齐

### Requirement: Generated bundle scope MUST remain stable across manual transcript import and later restore
annotation generation pipeline 在手动导入 transcript 后 MUST 立即建立与后续刷新恢复一致的 `audioKey + documentId` scope 语义。当前会话中的 generated bundle 保存与刷新后的 generated bundle 恢复 MUST 使用同一 scope，而不是在保存时继续沿用旧 `currentDocId`、恢复时再切换到新的 derived doc id。

#### Scenario: Save scope and restore scope stay aligned for the same article

- **WHEN** 用户手动导入 transcript，并在当前会话里生成或增量生成 annotation
- **THEN** pipeline 保存 generated bundle 时使用的 `audioKey + documentId` scope MUST 与刷新后 restore 使用的 scope 一致
- **AND** refresh 之后 generated bundle MUST 能按该 scope 被重新 load 和 index

### Requirement: Restore scope fix MUST NOT change add-only merge semantics
这次 restore scope 修复 MUST 只解决保存 scope 与恢复 scope 的一致性问题。system MUST NOT 借此修改 `appendGeneratedItems()` 的 add-only merge 语义，也 MUST NOT 引入 replace、repair 或批量替换旧 annotation 的行为。

#### Scenario: Merge strategy remains unchanged while restore scope is fixed

- **WHEN** system 实施本 change 的 restore / scope 修复
- **THEN** 增量生成的 merge 仍然 MUST 保持现有 add-only 行为
- **AND** 同一 `occurrenceKey` 的旧 item 处理策略 MUST 保持不变

### Requirement: Final generation state MUST reflect target completeness, not only block request success

annotation generation controller 在一次运行结束时 MUST 基于 target-level completeness 判定最终结果。system MUST NOT 仅因为每个 planned block 的 request 成功返回，就把整次运行判成 `complete`。若本次运行后仍存在 missing targets，最终状态 MUST 使用准确的非完成语义。

#### Scenario: Provider returns fewer valid items than requested targets

- **WHEN** 某次 generation run 中，planned targets 已进入 provider request，但 provider `returnedCount` 或 normalize 后的有效 item 数量少于 `requestedTargetCount`
- **THEN** controller MUST 在运行结束时重新判断当前 generated bundle 是否仍存在 missing targets
- **AND** 若仍存在 missing targets，controller MUST NOT 返回 `complete`

### Requirement: Final diagnostics MUST expose requested, generated, missing, and result state together

annotation generation pipeline MUST 在最终 diagnostics 中同时暴露 `requestedTargetCount`、`generatedTargetsCount`、`missingTargetsCount` 与 final result state，便于区分“block 成功返回”与“target 已全部补齐”。

#### Scenario: Completion diagnostics reveals remaining missing targets

- **WHEN** controller 完成一轮全文或增量 generation
- **THEN** diagnostics MUST 记录本次 `requestedTargetCount`
- **AND** diagnostics MUST 记录最终 `generatedTargetsCount` 与 `missingTargetsCount`
- **AND** diagnostics MUST 记录最终 result state

