# Review Loops and Evidence Validators

## Purpose

This document records the F-004 review-loop failure from the
`enable-mac-frontend-windows-backend` change and turns it into operating rules. The goal is to keep
review proportional to a personal tool and focused on product, data, startup, cross-machine, media,
and rollback risk.

## What happened in F-004

E-004 was intended to create a nine-journey cross-machine checklist, a fillable evidence manifest,
and a small structural check. Its first implementation added a 253-line validator. Repeated R-004
reviews then asked the validator to distinguish increasingly adversarial combinations of log text,
nested fields, request identities, failure wording, restart timelines, media ranges, reconnect
sequences, recovery actions, and synthetic provenance.

Thirteen committed fixes and a fourteenth uncommitted attempt grew the validator to 7,441 lines.
The work remained in an isolated worktree and never reached G-0. During that time no LAN listener,
Mac Vite proxy, Range transport, remote Reader adapter, or learning-domain writer migration was
implemented.

The first review found a legitimate structural gap: a PASS could cite a missing, placeholder,
out-of-root, or manual-only evidence reference. Later reviews moved beyond that bounded problem and
tried to make a static validator prove that real cross-machine events had happened. That is not a
property a JSON manifest or arbitrary log parser can establish.

## Three verification responsibilities

Keep these layers separate:

1. Artifact validation checks schema, required journey IDs, allowed statuses, relative paths,
   evidence-file existence, root containment, non-empty files, and optional checksums.
2. Evidence review checks whether the collected browser/network/owner/media/restart material
   supports the claimed outcome. This is an independent review responsibility.
3. System validation performs the real Windows/Mac journey and observes behavior. Only this layer
   can establish that a restart, reconnect, seek, or durability result actually occurred.

A lower layer must never claim the authority of a higher layer. A fixture proving that the
validator accepts a string is not evidence that the product works across two machines.

## Required stop rules

- Write the review acceptance criteria before implementation begins.
- A finding must cite an existing criterion or a concrete P0-P2 product/data/rollback failure.
- One fix may repair one bounded finding and add its direct regression check.
- After two consecutive failed fix/re-review cycles on the same task, pause automatic scheduling.
  Reassess and ask the user whether to simplify, split, or continue.
- Do not turn hypothetical malformed input into a new requirement unless that input is realistic
  for this personal tool and could cause a P0-P2 outcome.
- A support script above roughly 500 lines, or more than twice its reviewed baseline, triggers a
  scope review. Line count is a warning signal, not a quality metric.
- Prefer deleting speculative validation to adding another semantic parser.
- Keep real environment checks in their owning phase. E-004 prepares the form; E-202B, E-304 and
  later journey tasks collect and interpret real evidence.

## F-004 cleanup decision

The accepted F-004 validator boundary is intentionally small:

- Keep the nine required journeys and documented coverage tokens.
- Keep `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN` consistency rules.
- For real evidence, reject placeholders, absolute or escaping paths, missing/non-file/empty
  references, and mismatched optional checksums.
- Require at least one journey-appropriate non-manual evidence kind before recording PASS.
- Do not parse arbitrary evidence content to infer product behavior.
- State explicitly that structural validation does not establish live acceptance.

The oversized F-004 commit chain remains reachable in its isolated worktree for diagnosis. It is
not the integration source. The main implementation keeps the small E-004 baseline plus only the
bounded structural protections above.
