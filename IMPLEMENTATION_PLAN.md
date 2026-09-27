## Stage 1: Verify administrator authorization
**Goal**: Create and verify a real platform role for read-only global management.
**Success Criteria**: Requesting user matches the verified role; no public role assignment.
**Tests**: Role list, role get, role match.
**Status**: Complete

## Stage 2: Implement global read API
**Goal**: Add a protected global query with creator, conversation, status and keyword filters.
**Success Criteria**: Admin sees multiple owners; ordinary users cannot access global data.
**Tests**: Real role guard, SQL filters, pagination, validation and personal list regression.
**Status**: Complete

## Stage 3: Implement management UI
**Goal**: Add administrator navigation, route guard, filters, creator display and read-only details.
**Success Criteria**: Loading, empty, error and denied states work; private names are not impersonated.
**Tests**: Typecheck, lint and browser checks across desktop/mobile.
**Status**: Complete

## Stage 4: Verify and publish
**Goal**: Commit and deploy the complete management feature.
**Success Criteria**: Build and tests pass; actual published admin page returns global data.
**Tests**: Release status and authenticated online page.
**Status**: In Progress

Local verification note: frontend resolves the platform administrator role, but the local
backend development identity still returns 403 after env refresh. Real platform guard
tests pass. Verify the authenticated deployed endpoint before claiming completion.
