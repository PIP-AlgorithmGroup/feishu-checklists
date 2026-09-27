## Stage 1: Confirm private chat contract
**Goal**: Verify private chat API and add nullable name storage.
**Success Criteria**: Official client API confirmed and generated schema contains name column.
**Tests**: Documentation and schema generation.
**Status**: Complete

## Stage 2: Read and persist private chat names
**Goal**: Resolve names in Feishu on send and when loading existing checklists.
**Success Criteria**: Owner scoped names survive opening the management page in a browser.
**Tests**: SDK arguments, empty names, failures, owner scoped storage and list fallback.
**Status**: Complete

## Stage 3: Verify and publish
**Goal**: Deploy validated name retrieval and report actual runtime verification.
**Success Criteria**: Checks pass and release finished; missing client permissions reported accurately.
**Tests**: Typecheck, lint, tests, builds and release status.
**Status**: In Progress
