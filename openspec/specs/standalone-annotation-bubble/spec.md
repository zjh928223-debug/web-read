# standalone-annotation-bubble Specification

## Purpose
TBD - created by archiving change add-standalone-annotation-bubble-module. Update Purpose after archive.
## Requirements
### Requirement: Annotation bubble can be toggled as an independent fixed floating layer
The system MUST provide an independent annotation bubble that can be shown or hidden by a custom hotkey. The bubble MUST exist as a fixed-position floating UI layer and MUST NOT be rendered inline in article text or as a right-side explanation panel.

#### Scenario: Toggle bubble from hidden to visible
- **WHEN** the user presses the annotation bubble show/hide hotkey
- **THEN** the system MUST show a fixed-position annotation bubble
- **AND** the bubble MUST NOT change article layout, article text, the audio player, or the current highlight state

#### Scenario: Toggle bubble from visible to hidden
- **WHEN** the annotation bubble is visible and the user presses the show/hide hotkey again
- **THEN** the system MUST hide the annotation bubble
- **AND** later text clicks MUST continue to use the existing reader click behavior
- **AND** later text clicks MUST NOT automatically show explanation UI

#### Scenario: Empty bubble state
- **WHEN** the annotation bubble is visible but no current annotation has been selected
- **THEN** the bubble MUST show an empty-state hint equivalent to “点击一个已标注单词查看释义”

### Requirement: Annotation bubble updates from annotated word clicks without replacing audio seek
The system MUST update the visible annotation bubble from annotated word clicks without changing the existing audio-seek behavior.

#### Scenario: Click annotated word while bubble is visible
- **WHEN** the annotation bubble is visible and the user clicks a word that has annotation data
- **THEN** the system MUST continue to run the existing audio jump and highlight update behavior
- **AND** the bubble MUST update to the annotation content for that clicked word
- **AND** the bubble content MUST replace the previous content instead of appending a history list

#### Scenario: Click normal word while bubble is visible
- **WHEN** the annotation bubble is visible and the user clicks a normal word without annotation data
- **THEN** the system MUST continue to run the existing audio jump and highlight update behavior
- **AND** the bubble MUST NOT refresh to the normal word content
- **AND** the bubble MUST NOT clear the previously displayed annotation

#### Scenario: Click text while bubble is hidden
- **WHEN** the annotation bubble is hidden and the user clicks any article text
- **THEN** the system MUST preserve the current click-to-audio behavior
- **AND** the system MUST NOT show the annotation bubble
- **AND** the system MUST NOT show a right-side explanation panel, article-embedded explanation card, or inline `[]` boundary marker

### Requirement: Annotation bubble displays the initial annotation field set
The annotation bubble MUST render a compact content layout based on the existing annotation data structure. The bubble MUST keep `markedText` internally for compatibility, but the visible front-end content MUST now be limited to `边界`, `意思`, and `要记`. The `type` field MUST NOT occupy an independent content row; instead, it MUST be rendered as a smaller, weaker abbreviation badge on the right side of the `boundary` value area.

#### Scenario: Render compact bubble content with type badge
- **WHEN** the bubble receives an annotation containing boundary, type, meaning, and memory hint
- **THEN** the bubble MUST render a `边界` content block
- **AND** the bubble MUST render the English boundary text on the left side of that block
- **AND** the bubble MUST render a smaller gray type abbreviation on the right side of that boundary value area
- **AND** the bubble MUST render `意思`
- **AND** the bubble MUST render `要记`
- **AND** the bubble MUST NOT render `类型` as an independent row
- **AND** the bubble MUST NOT render `标注内容` as a visible content row

#### Scenario: Render safe type abbreviation for known and unknown values
- **WHEN** the bubble receives a `type` value such as `verb`, `noun`, `adjective`, `adverb`, `phrase`, `phrasal-verb`, `collocation`, `expression`, or another compatible value
- **THEN** the bubble MUST map known values to a stable abbreviation such as `V`, `N`, `Adj`, `Adv`, `Phrase`, or `Ph-v`
- **AND** the bubble MUST use a safe fallback abbreviation strategy for unknown values
- **AND** the bubble MUST NOT throw visible errors or break bubble rendering because of an unknown `type`

#### Scenario: Render compact sections with separators
- **WHEN** the bubble renders annotation content
- **THEN** the bubble MUST visually group the main content into exactly three blocks: `边界`, `意思`, and `要记`
- **AND** the bubble MUST place a thin gray separator line between adjacent blocks
- **AND** the bubble MUST reduce the vertical spacing between blocks and within blocks compared with the previous four-row layout

#### Scenario: Compact layout preserves bubble behavior
- **WHEN** the bubble renders compact content with short or long annotation text
- **THEN** the bubble MUST preserve scrolling inside the existing body area
- **AND** the bubble MUST preserve the existing close button, drag behavior, resize behavior, fixed positioning, and visibility toggling
- **AND** the layout change MUST NOT require changes to generated annotation storage, click resolver contract, entry UI, or generation pipeline

### Requirement: Annotation bubble position and size are user-controlled
The annotation bubble MUST remain user-controlled for drag, resize, and fixed viewport positioning.

#### Scenario: Drag bubble
- **WHEN** the user drags the annotation bubble
- **THEN** the bubble MUST update to the dragged fixed viewport position
- **AND** article scrolling MUST NOT move the bubble away from that screen position

#### Scenario: Resize bubble
- **WHEN** the user resizes the annotation bubble
- **THEN** the bubble MUST update its size
- **AND** later annotation updates MUST NOT reset the user-selected size

### Requirement: Annotation bubble implementation remains modular
The annotation bubble implementation MUST remain modular, with only minimal wiring in `app.js`.

#### Scenario: Minimal app integration
- **WHEN** the reader integrates the annotation bubble
- **THEN** `app.js` MUST only contain thin integration for hotkey wiring, click notification wiring, and annotation resolver adaptation
- **AND** bubble DOM creation, show/hide state, content rendering, drag, resize, and position/size state MUST remain inside the standalone module

#### Scenario: No inline boundary rendering in reader text
- **WHEN** the system shows the annotation bubble or updates its annotation content
- **THEN** the system MUST NOT inject `[]`, boundary markers, explanation cards, or other explanation DOM into the article text

