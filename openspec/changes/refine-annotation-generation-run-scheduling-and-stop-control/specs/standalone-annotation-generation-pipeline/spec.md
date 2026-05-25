## MODIFIED Requirements

### Requirement: Generation controller MUST schedule a run under a fixed request contract
The generation controller MUST execute a run under a fixed scheduling contract instead of trying to exhaustively push the whole planner output in one go.

#### Scenario: Controller trims the executable plan for the current run
- **WHEN** planner returns more than 10 executable blocks for the current document or missing-target subset
- **THEN** the controller MUST keep planner output intact as planning data
- **AND** it MUST execute only the first 10 executable blocks for the current run

#### Scenario: Controller runs blocks serially with pacing
- **WHEN** the controller has multiple executable blocks in the current run
- **THEN** it MUST execute them serially
- **AND** it MUST enforce a 5-second minimum gap between consecutive request start times

### Requirement: Controller MUST stop a run honestly
The generation controller MUST treat stop as a real run-control signal rather than only a UI state.

#### Scenario: Stop prevents later block execution
- **WHEN** stop is requested after some blocks have already run
- **THEN** the controller MUST stop before issuing any later block request
- **AND** the run MUST finish with a stopped final reason or equivalent semantics

### Requirement: Controller MUST not reuse automatic retry semantics inside the run
The generation controller MUST NOT automatically retry the same failed block request within the same run under the new scheduling contract.

#### Scenario: Failed block does not auto-repeat in the same run
- **WHEN** a block request fails during a run
- **THEN** the controller MUST record the failure and continue or finalize under the run contract
- **AND** it MUST NOT reissue the same block request automatically in that run
