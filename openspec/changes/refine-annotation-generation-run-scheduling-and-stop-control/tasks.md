## 1. Controller scheduling contract

- [x] 1.1 Audit the current controller plan, execution loop, retry behavior, end conditions, and diagnostics handoff.
- [x] 1.2 Hard-cap each run to the first 10 executable blocks in the controller/planning wrapper layer.
- [x] 1.3 Enforce a run-level actual request budget of 10 where success, 503, 400, network, and abort all consume budget.
- [x] 1.4 Enforce pacing by request start time with `nextAllowedStartAt = previousRequestStartAt + 5000ms`.
- [x] 1.5 Disable same-run automatic retry so multiple requests in one run cannot come from the same block retry loop.
- [x] 1.6 Finalize clear run end reasons for `complete`, `budget_exhausted`, `stopped`, and `failed/remaining`.

## 2. Stop control

- [x] 2.1 Audit the current API client abort seam and controller call path for stop handling.
- [x] 2.2 Ensure `stopRequested` prevents any later block request from starting.
- [x] 2.3 Wire the controller stop path through the API client abort signal so an in-flight request can be cancelled.
- [x] 2.4 Keep UI/diagnostics honest when stop is requested and the current request is still finishing.

## 3. Shared initial / incremental scheduling

- [x] 3.1 Confirm initial and incremental runs share the same controller scheduling path.
- [x] 3.2 Apply the same 10-request cap, 5-second pacing, no retry, and no auto-next-run rules to incremental runs.

## 4. UI and diagnostics

- [x] 4.1 Update entry/page-level status mapping to express `running`, `waiting-next-block`, `stopping/stopped`, `complete`, and `incomplete/remaining`.
- [x] 4.2 Extend diagnostics to record request budget, consumed request count, request start times, `nextAllowedStartAt`, stop flags, abort state, and final run reason.
- [x] 4.3 Confirm diagnostics can distinguish `complete`, `budget_exhausted`, `stopped`, and `failed/remaining`.

## 5. Verification

- [x] 5.1 Verify a single click sends at most 10 requests.
- [x] 5.2 Verify adjacent request start times are at least 5 seconds apart.
- [x] 5.3 Verify there is no same-run automatic retry and failures do not trigger hidden extra requests.
- [x] 5.4 Verify stop prevents later blocks and aborts the current in-flight request when supported.
- [x] 5.5 Verify initial and incremental runs both obey the same scheduling rules.
- [x] 5.6 Run `node --check` on all touched files and keep the scope limited to scheduling and stop control.
