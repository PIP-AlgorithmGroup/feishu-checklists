## Stage 1: Protected image retrieval
**Goal**: Read only images belonging to an accessible checklist.
**Success Criteria**: Owners can read their images; administrators can read all; foreign keys are rejected.
**Tests**: Ownership, image membership, administrator guard and image response validation.
**Status**: Complete

## Stage 2: Thumbnail and full image UI
**Goal**: Show small previews in both detail pages and allow opening the full image.
**Success Criteria**: Loading, retry, close and resource cleanup work.
**Tests**: Typecheck, lint, desktop/mobile screenshots and actual image loading.
**Status**: Complete

## Stage 3: Verify and publish
**Goal**: Commit and publish the verified image viewing feature.
**Success Criteria**: Tests/build pass and the correct release finishes.
**Tests**: Authenticated online preview and full image.
**Status**: In Progress
