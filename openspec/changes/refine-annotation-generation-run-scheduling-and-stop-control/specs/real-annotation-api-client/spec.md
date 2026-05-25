## MODIFIED Requirements

### Requirement: Real API client SHOULD cooperate with run stop control
The real annotation API client SHOULD provide an abort seam that the generation controller can use when stop is requested during an in-flight request, provided the current structure allows that without broad refactoring.

#### Scenario: Controller aborts an in-flight request when supported
- **WHEN** stop is requested while a real provider request is still in flight
- **THEN** the client SHOULD allow the controller to abort that request
- **AND** the resulting aborted state SHOULD be observable by diagnostics

#### Scenario: Honest fallback when abort is not fully available
- **WHEN** the current request cannot be aborted cleanly in the existing structure
- **THEN** the client/controller boundary MUST still allow the run to stop before any further request is sent
- **AND** the system MUST preserve honest stopped-requested semantics rather than pretending the run was fully cancelled
