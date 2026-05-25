## MODIFIED Requirements

### Requirement: Entry UI MUST reflect scheduling states honestly
The generation entry UI MUST distinguish between actively running work, waiting for the next allowed request slot, stopped runs, completed runs, and runs that ended with remaining work.

#### Scenario: UI shows pacing wait instead of looking stuck
- **WHEN** the controller is waiting for `nextAllowedStartAt` before starting the next request
- **THEN** the entry UI MUST show a waiting-next-block or equivalent cooling-down state
- **AND** it MUST NOT make the run look like a silent stall

#### Scenario: UI shows stopped instead of failed
- **WHEN** the run ends because stop was requested and handled
- **THEN** the entry UI MUST show stopped or equivalent semantics
- **AND** it MUST NOT mislabel that run as a generic failure

#### Scenario: UI distinguishes remaining-work from complete
- **WHEN** the run ends because request budget was exhausted while missing targets remain
- **THEN** the entry UI MUST show a partial / remaining / still-missing style state
- **AND** it MUST NOT mislabel that run as complete
