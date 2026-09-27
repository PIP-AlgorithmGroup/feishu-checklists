## Stage 1: Confirm failures
**Goal**: Identify missing conversation binding and name lookup failure.
**Success Criteria**: Actual online errors and official send receipt documented.
**Tests**: Online logs and official API contract.
**Status**: Complete

## Stage 2: Persist send receipts
**Goal**: Bind successful sends immediately with owner checks and conflict protection.
**Success Criteria**: New sent cards expose conversation without a callback.
**Tests**: Receipt parsing, ownership, conflict, retry and callback compatibility.
**Status**: Complete

## Stage 3: Verify and publish
**Goal**: Deploy validated binding fix and verify names after permission activation.
**Success Criteria**: Build and tests pass, release finished, names verified or permission blocker stated.
**Tests**: Typecheck, lint, tests, build, release status and online logs.
**Status**: In Progress
