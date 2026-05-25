## ADDED Requirements

### Requirement: Single-run annotation generation MUST enforce a hard request budget
The system MUST enforce a hard budget of at most 10 actual API requests per run. Each request that is actually sent MUST consume one unit of budget, including successful requests, `503/provider_server`, `400/request_invalid`, `network`, and aborted in-flight requests.

#### Scenario: Budget is consumed by failed requests
- **WHEN** a run sends a request and that request fails with `503/provider_server`, `400/request_invalid`, or `network`
- **THEN** the run MUST count that request against the 10-request budget
- **AND** the run MUST NOT refund that budget slot

#### Scenario: Budget exhaustion stops the run
- **WHEN** a run has already sent 10 requests
- **THEN** the system MUST stop scheduling any further block requests in that run
- **AND** the run MUST end without sending an 11th request

### Requirement: Single-run scheduling MUST pace request start times by 5 seconds
The controller MUST schedule request start times so that each request starts at least 5 seconds after the previous request start time.

#### Scenario: Next request waits for nextAllowedStartAt
- **WHEN** the previous request for the run started at time `T`
- **THEN** the next request MUST NOT start before `T + 5000ms`
- **AND** the controller MUST treat `nextAllowedStartAt` as the gate for the next request start

### Requirement: Single-run scheduling MUST NOT auto-retry within the same run
The system MUST NOT automatically retry failed requests within the same run. If a request fails, that failure MUST remain part of the current run outcome and any follow-up generation MUST require a new user-triggered run.

#### Scenario: Failed request does not trigger automatic retry
- **WHEN** a block request fails during a run
- **THEN** the system MUST NOT automatically re-send that same block request in the same run
- **AND** any later recovery MUST come from a new user-triggered run

### Requirement: Initial and incremental generation MUST share the same scheduling contract
Initial full-article generation and incremental missing-target generation MUST use the same request budget, pacing, stop, and run-finalization rules.

#### Scenario: Incremental run follows the same hard contract
- **WHEN** the controller starts a run for missing targets only
- **THEN** that run MUST still enforce the 10-request budget
- **AND** it MUST still pace request start times by 5 seconds
- **AND** it MUST NOT auto-retry in the same run

### Requirement: A run MUST end explicitly instead of auto-starting the next run
When a run reaches completion, failure, stop handling, or budget exhaustion, the system MUST end that run and MUST NOT automatically open a follow-up run.

#### Scenario: Remaining targets require manual follow-up
- **WHEN** a run ends with remaining missing targets
- **THEN** the system MUST leave those targets for a later user-triggered run
- **AND** the system MUST NOT automatically start another run

### Requirement: Run stop control MUST be real and observable
The system MUST support stopping a running generation run. At minimum, stop handling MUST prevent any further block requests from being scheduled after stop is requested. If the current structure allows aborting the in-flight request, the system SHOULD abort it and record that fact.

#### Scenario: Stop prevents future requests
- **WHEN** the user requests stop during a running run
- **THEN** the controller MUST set stopRequested
- **AND** the controller MUST NOT schedule any new later block requests after stop is handled

#### Scenario: Abort is recorded when supported
- **WHEN** stop is requested while a request is in flight and the client supports aborting it
- **THEN** the system SHOULD abort the current request
- **AND** diagnostics MUST record that the in-flight request was aborted

### Requirement: Budget exhaustion MUST be non-failed when it only reflects scheduling limits
If a run reaches the 10-request budget and still has remaining missing targets, the run MUST NOT be reported as a simple failed run. It MUST surface a non-failed partial-or-remaining state that reflects contract exhaustion rather than a provider error.

#### Scenario: Budget exhausted remains non-failed
- **WHEN** a run uses all 10 request slots and still has remaining missing targets
- **THEN** the final run reason MUST indicate budget exhaustion or equivalent remaining-work semantics
- **AND** the final run MUST NOT be misreported as plain failed solely because the budget was consumed

### Requirement: Diagnostics MUST capture run scheduling and stop semantics
Diagnostics records MUST preserve enough run-level information to reconstruct request budget usage, pacing, stop handling, and final run reason.

#### Scenario: Scheduling diagnostics survive inspection
- **WHEN** a run executes under the new scheduling contract
- **THEN** diagnostics MUST record the run request budget, request index, each request start time, `nextAllowedStartAt`, `stopRequested`, `stopHandled`, whether the current request was aborted, and the final run reason
- **AND** those records MUST remain available for later inspection after the run ends
