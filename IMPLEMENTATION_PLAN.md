## Stage 1: Integrate Miaoda scaffold into this repository
**Goal**: Create a full_stack app, inspect its generated project, and incorporate its platform baseline into develop/miaoda-migration without replacing this GitHub repository.
**Success Criteria**: This directory contains the real .spark metadata and platform scaffold; its Git history can fast-forward the Miaoda sprint/default branch without force-push.
**Tests**: Run the generated project's build/typecheck and the existing domain tests.
**Status**: Complete

## Stage 2: Port backend and data contracts
**Goal**: Implement Feishu authentication, card callback, transactional checklist persistence, and media transfer using the platform's documented SDKs.
**Success Criteria**: No CloudBase runtime dependency; callback identity, idempotency, binding, and media validation are covered by tests.
**Tests**: Backend unit/integration tests and platform typecheck/build.
**Status**: In Progress

Dev database, authenticated creation, conditional single-row event updates, and callback/card pure logic are in place. Callback ingress verification (2026-09-19): an unauthenticated POST to the local `/api/checklist` returned 403 for missing CSRF cookie; the sandbox platform URL redirected an unauthenticated POST to SSO. The `/openapi` gateway requires an API Key. The installed `@lark-apaas/nestjs-trigger` implementation calls the automation handler without awaiting or forwarding its return value and responds to the trigger server with a fixed `{ code: 200, message: 'success' }`, so its Webhook automation cannot supply Feishu's synchronous `challenge` or card JSON. An isolated custom POST route returned synchronous JSON locally, but `rawBodyAvailable` was false. Its first published release (`7687266436658646219`) completed; an unauthenticated POST to the published route returned 302 to Feishu login. The current access scope is `Range` with no explicit users and access-request approval enabled, so a temporary switch to public cannot be exactly restored with the CLI's required nonempty `specific --targets`. The probe route is removed in the cleanup commit. A published custom route without login has not been tested; do not assert that the entire platform is incapable of it. No Feishu callback switch or CloudBase shutdown until this is proven.

## Stage 3: Port the editor and file workflow
**Goal**: Restore the side-panel editor, image compression, per-file progress, and current-chat card sending against the Miaoda APIs.
**Success Criteria**: Desktop/mobile editor behavior matches the archived baseline; browser upload does not expose server credentials or permit arbitrary server-side URL fetching.
**Tests**: Frontend tests, build, and browser verification.
**Status**: Not Started

## Stage 4: Verify, deploy, migrate, and retire CloudBase
**Goal**: Validate real Feishu callbacks and 30 MB MP4 transfer, migrate existing data, then switch the Feishu entry points and retire CloudBase resources.
**Success Criteria**: Real two-user card updates work within 3 seconds; migrated records/media reconcile; rollback is possible before old resources are deleted.
**Tests**: End-to-end acceptance on desktop/mobile, migration reconciliation, online logs/metrics.
**Status**: Not Started
