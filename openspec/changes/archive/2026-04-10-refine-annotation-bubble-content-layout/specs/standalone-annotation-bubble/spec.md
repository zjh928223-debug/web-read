## MODIFIED Requirements

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
