## ADDED Requirements

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
