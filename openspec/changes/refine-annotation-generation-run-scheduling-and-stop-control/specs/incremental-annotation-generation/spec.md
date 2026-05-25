## MODIFIED Requirements

### Requirement: Incremental generation MUST obey the same single-run scheduling contract
Incremental generation runs based on missing targets MUST obey the same request budget, pacing, stop, and no-auto-retry rules as initial full-article generation.

#### Scenario: Missing-target run respects request cap and pacing
- **WHEN** incremental generation starts for a document that still has missing targets
- **THEN** the controller MUST plan only for the missing-target subset
- **AND** it MUST still cap the current run at 10 actual requests
- **AND** it MUST still enforce 5 seconds between request start times

#### Scenario: Missing targets remain for manual follow-up
- **WHEN** an incremental run ends before all missing targets are covered
- **THEN** the remaining missing targets MUST stay pending for a later user-triggered run
- **AND** the system MUST NOT automatically start another incremental run
