## MODIFIED Requirements

### Requirement: Diagnostics records MUST expose run scheduling budget and pacing
Diagnostics records MUST let developers reconstruct how a generation run consumed request budget and observed pacing.

#### Scenario: Records show request budget usage
- **WHEN** a run issues requests under the scheduling contract
- **THEN** diagnostics MUST record the run request budget
- **AND** diagnostics MUST record which numbered request each actual request consumed in that run

#### Scenario: Records show next allowed request start
- **WHEN** the controller schedules the next block request
- **THEN** diagnostics MUST record the current request start time and `nextAllowedStartAt`
- **AND** later inspection MUST make the 5-second pacing rule auditable

### Requirement: Diagnostics records MUST expose stop handling
Diagnostics records MUST clearly show whether stop was requested, whether stop was handled, and whether the current in-flight request was aborted.

#### Scenario: Stop is visible in records
- **WHEN** the user requests stop during a run
- **THEN** diagnostics MUST record `stopRequested`
- **AND** diagnostics MUST later record whether stop was handled before more requests were sent
- **AND** if the current request was aborted, diagnostics MUST record that fact

### Requirement: Diagnostics records MUST expose final run reason
Diagnostics records MUST preserve the reason a run ended so that complete, budget-exhausted, stopped, and failed outcomes can be distinguished later.

#### Scenario: Final run reason is inspectable
- **WHEN** a run ends
- **THEN** diagnostics MUST record whether the run ended because it completed, exhausted budget, was stopped, or failed
- **AND** later inspection MUST NOT require inference from unrelated fields alone
