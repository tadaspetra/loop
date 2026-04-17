# AGENTS.md

This file is the canonical contributor guide for this repository.

If another assistant-specific file exists, it should defer to this document for repo workflow, quality gates, and architecture constraints.

## Mission

Keep this Electron video app production-ready while preserving:

- clear module boundaries
- deterministic tests
- stable user-facing behavior
- release integrity

Do not optimize for "quickly making tests pass." Optimize for making the codebase more robust.

## Required Workflow

For any non-trivial change, follow this order:

1. Identify the affected feature and expected behavior.
2. Define or update acceptance criteria before implementation.
3. Add or update tests first for the intended behavior.
4. Implement the code change.
5. Run the full verification suite.
6. Fix code defects if tests fail. Do not weaken assertions unless the product requirement itself changed.

## Change Policy

- Prefer small, isolated changes over broad rewrites.
- Preserve behavior unless the task explicitly changes product behavior.
- Do not introduce duplicate business logic across renderer and main.
- Shared normalization/domain logic belongs in `src/shared/`.
- Main-process business logic belongs in `src/main/services/`, not in IPC registration or app bootstrap.
- Renderer feature logic belongs in `src/renderer/features/`, not inline in `src/index.html`.
- `src/preload.ts` should remain a narrow bridge and not gain business logic.

## Architecture Guardrails

Current intended structure:

- `src/main/`
  - Electron runtime bootstrapping, IPC registration, services, infra
- `src/shared/`
  - domain rules, normalization, data-shape helpers shared across layers
- `src/renderer/`
  - renderer entrypoint and feature utilities
- `tests/unit/`
  - pure logic and isolated helper tests
- `tests/integration/`
  - service/integration tests with controlled fakes
- `tests/e2e/`
  - Electron smoke and workflow checks

When adding new code:

- Put pure data logic in a testable module first.
- Keep side effects at the edges.
- Inject dependencies where practical for testability.
- Favor explicit validation and errors over silent fallback when data is invalid.

## Test-First Requirements

Before implementing behavior changes:

- Add unit tests for pure logic.
- Add integration tests for filesystem, IPC, or service coordination.
- Add or extend e2e coverage for critical user flows if the change affects runtime behavior.
- For every user-visible behavior change, add at least one proving test that would fail without the change.
- Treat "what behavior changed?" as a required design question before coding.

Minimum expectation by change type:

- Pure helper/domain change: unit tests
- Main-process service or IPC change: unit + integration tests
- Renderer feature change: utility tests and, if behaviorally important, e2e or smoke coverage
- Release/build/packaging change: verification via packaging smoke and relevant CI updates

## Coverage Policy

Do not chase 100% coverage as a vanity target. Protect confidence instead.

Coverage priorities by layer:

- `src/shared/**`
  - target very high coverage
  - new logic should normally ship with direct unit coverage
- pure modules in `src/main/services/**`
  - target high coverage
  - normalization, parsing, validation, section math, FPS selection, ffmpeg filter builders should be directly tested
- orchestration-heavy main-process code
  - combine unit coverage with integration coverage
  - do not rely on line coverage alone
- renderer runtime glue
  - prefer behavior tests and smoke/e2e coverage over brittle implementation-detail tests

Use this rule when changing code:

- if logic moved or behavior changed, coverage for that area should stay the same or improve
- if an agent adds a new branch/edge case, it should usually add a test for that branch
- do not lower confidence in a critical path while keeping the global coverage number flat

## Testing Rules

- Never "fix" a test by removing meaningful assertions just to get green CI.
- If a test reveals a bug, fix the underlying code.
- Prefer deterministic tests using mocks, fakes, fixtures, and temp directories.
- Avoid live external dependencies in tests.
- Keep tests readable and behavior-focused.

## Required Commands

Use pnpm only in this repo.

Primary commands:

- `pnpm run build:styles`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run test:e2e`
- `pnpm run package:smoke`
- `pnpm run check`

Before finishing a substantive change, run:

- `pnpm run check`

If `pnpm run check` is too slow during iteration, run a narrower loop while developing, but do not mark work complete until the full check passes.

## Build And Runtime Notes

- Start the app with `pnpm dev` or `pnpm start`, not raw `electron .`
  - this ensures renderer styles are rebuilt first
- Tailwind output is generated into `src/renderer/styles/main.css`
- Do not reintroduce Tailwind CDN loading
- Keep the stricter CSP in `src/index.html`

## Environment Rules

- Required env vars must be documented in `.env.example`
- Validate required env at runtime before using it
- Do not hardcode secrets
- Do not commit `.env`

## Release Integrity

Any change that affects build, packaging, or runtime startup must keep these green:

- lint
- typecheck
- unit/integration tests
- Electron smoke test
- packaging smoke

Update `.github/workflows/ci.yml` if the required validation steps change.

## Agent Completion Checklist

A non-trivial task is not complete until all of the following are true:

- acceptance criteria were identified or updated
- tests were added or updated for the changed behavior
- implementation matches the tested behavior
- no meaningful assertion was weakened just to get green results
- docs were updated if contributor workflow or product behavior changed
- `pnpm run check` passed

Every final handoff from an agent should clearly state:

- what behavior changed
- what tests were added or updated
- what commands were run
- any residual risk or intentionally untested edge case

## Agent Prompting Guidance

When asking an agent to add or change a feature, prefer prompts that explicitly require:

- acceptance criteria first
- tests first or tests alongside the change
- code robustness over test weakening
- `pnpm run check` before completion
- a summary of the exact tests added

Bad prompt shape:

- "add this feature and make the tests pass"

Better prompt shape:

- "define the behavior, add the proving tests first, implement the feature, do not weaken tests, run `pnpm run check`, and report what tests were added"

## Code Quality Expectations

- Prefer composition over large monoliths.
- Keep files focused.
- Name modules by responsibility.
- Write defensive normalization around persisted project/timeline data.
- Add comments only where the logic is non-obvious.
- Avoid dead code and stale compatibility layers unless intentionally retained.

## Documentation Expectations

Update docs when behavior or contributor workflow changes:

- `docs/production/feature-inventory.md`
- `docs/production/target-architecture.md`
- `docs/production/runbook.md`
- this file

## If You Are Unsure

Default to:

- tests first
- smaller modules
- stricter validation
- shared domain logic
- full `pnpm run check` before completion

## Learned User Preferences

- Prefer compact plans and concise summaries unless more depth is requested.
- Prefer resilient recording stop/finalize behavior: if one recorder (e.g. camera) fails during finalize, do not wedge the whole flow; allow partial success where possible and surface a clear error instead of hanging.
- When judging recording reliability, do not treat helper-only unit tests as sufficient proof for real `MediaRecorder`, device, or OS-level capture edge cases.
- Prefer making live transcription failures visible (surface realtime close/error reasons from Scribe) rather than failing silently when the WebSocket drops.
- Treat recording durability as non-negotiable: an app crash, quit, or finalize failure must not lose captured bytes, and recovery must still surface whatever was saved.
- Recurring regressions (camera/audio sync drift, export/playback stutter on long or multi-section timelines) deserve root-cause investigation with end-to-end proving tests over surface-level fixes; these categories have regressed repeatedly across sessions and helper-only tests have missed them.

## Learned Workspace Facts

- Cross-platform behavior matters for this app; avoid macOS-only assumptions in filesystem paths, dialogs, and project workflows.
- Editor PiP and overlay positions are authored in a fixed 1920×1080 space; when export resolution is above 1080p (derived from source, capped at 2560×1440), scale PiP and overlay geometry proportionally so placement matches preview instead of reusing literal 1080p pixel offsets on a larger frame.
- Same-screen system audio may require Electron display-media loopback (`getDisplayMedia` with main-process coordination); external capture-device paths are not a substitute for all desktop/window sources.
- Multi-section ffmpeg export accumulates A/V drift from two distinct sources: (1) per-section `fps` normalization rounds each video to the nearest frame boundary while paired audio keeps the exact source duration — clamp with `trim=duration=<exact>,setpts=PTS-STARTPTS` after the `fps` filter (or apply `fps` once after concat) so per-section video matches paired audio length before concat; (2) screen and camera MediaRecorders start emitting at slightly different wall-clock epochs and camera WebM is VFR with no seekable index, so trims driven by a single shared timeline offset cut the two files at non-matching moments — persist per-file start epochs at record time and apply per-file offsets during ffmpeg trim.
- Very long timelines with dense camera-overlay keyframes can produce extremely nested ffmpeg filter expressions that exceed parser limits and fail render; the overlay graph needs to stay bounded for long sessions.
- Heavy H.264 screen exports (high resolution, high quality, dense UI detail) can stress QuickTime playback more than NLEs; explicit yuv420p and a compatible profile/level—and avoiding unnecessary output resolution—improves default macOS playback.
- `@electron/packager` dependency pruning can miss transitive packages under `pnpm`’s symlinked `node_modules` layout (fresh CI installs surface this); the packaging smoke harness avoids relying on that prune path.
- The Scribe live-transcription `AudioWorklet` (`audio-processor`) must load as a plain browser worklet script; compiling it with the main-process TypeScript target (e.g. CommonJS/NodeNext) breaks loading (`exports` undefined) and silently disables transcription-driven features.
- `src/renderer/styles/main.css` is Tailwind build output (`build:styles`, minified); full `check` rebuilds styles via nested steps, so tracking a non-matching formatted copy causes perpetual diffs—prefer generating locally and not treating it as hand-edited source.
- Recording durability depends on streaming `MediaRecorder` chunks directly to disk via IPC temp `.part` files (renamed on finalize) instead of buffering in the renderer; screen and camera are independent recorder pipelines, so stop/save/finalize must tolerate one failing without blocking the other, and recovery normalization must require the screen file but tolerate a missing camera file so a partial failure does not discard an otherwise-recoverable take. Partial WebM files report `duration=Infinity`; resolve real duration by seeking a probe `<video>` element to `1e101` so the browser computes duration from the seekable range, and tolerate unreadable probes without wedging the whole recovery flow.
- Premiere Pro FCP7 xmeml `Crop` must be emitted as `<effecttype>filter</effecttype>` + `<effectcategory>Matte</effectcategory>`; mis-classifying it as a motion effect makes Premiere silently drop the effect, leaving the camera uncropped and PiP placement drifting off the intended corner. Crop runs before the fixed Motion effect in Premiere's pipeline, which shapes how authored PiP geometry translates into Motion center/scale + Crop percentages.
- `flushScheduledProjectSave()` runs when switching away from or closing a project and writes the in-memory project state back to `project.json`, overwriting any external edits made to the file while the app was running; edit `project.json` externally only with the app fully quit.
