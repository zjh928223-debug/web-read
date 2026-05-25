## ADDED Requirements

### Requirement: Cloze utility helpers can be isolated without changing reader behavior
The system SHALL allow cloze-specific utility helpers to live outside `app.js` as a dedicated helper module, provided that cloze validation, answer normalization, and HTML escaping behavior remain unchanged.

#### Scenario: Cloze validation behavior is preserved
- **WHEN** cloze data is imported after the utility extraction
- **THEN** the system MUST accept and reject the same cloze payload shapes as before the extraction

#### Scenario: Cloze answer normalization behavior is preserved
- **WHEN** a learner submits a cloze answer before and after the utility extraction
- **THEN** the answer matching result MUST remain identical for the same input and target answer

#### Scenario: Cloze result rendering output is preserved
- **WHEN** cloze cards are rendered after the utility extraction
- **THEN** the generated UI structure and visible behavior MUST remain unchanged except for the internal source location of the helper functions

#### Scenario: Non-cloze reader behavior is unaffected
- **WHEN** transcript, AI chunk, playback, highlight, or note flows run after the utility extraction
- **THEN** those flows MUST behave the same as before the extraction
