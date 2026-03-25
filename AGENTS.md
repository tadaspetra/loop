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
- `src/preload.js` should remain a narrow bridge and not gain business logic.

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

Use npm only in this repo.

Primary commands:

- `npm run build:styles`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:e2e`
- `npm run package:smoke`
- `npm run check`

Before finishing a substantive change, run:

- `npm run check`

If `npm run check` is too slow during iteration, run a narrower loop while developing, but do not mark work complete until the full check passes.

## Build And Runtime Notes

- Start the app with `npm run dev` or `npm start`, not raw `electron .`
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
- `npm run check` passed

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
- `npm run check` before completion
- a summary of the exact tests added

Bad prompt shape:

- "add this feature and make the tests pass"

Better prompt shape:

- "define the behavior, add the proving tests first, implement the feature, do not weaken tests, run `npm run check`, and report what tests were added"

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
- full `npm run check` before completion

## Learned User Preferences

- Prefer compact plans and concise summaries unless more depth is requested.
- Prefer resilient recording stop/finalize behavior: if one recorder (e.g. camera) fails during finalize, do not wedge the whole flow; allow partial success where possible and surface a clear error instead of hanging.
- When judging recording reliability, do not treat helper-only unit tests as sufficient proof for real `MediaRecorder`, device, or OS-level capture edge cases.

## Learned Workspace Facts

- Cross-platform behavior matters for this app; avoid macOS-only assumptions in filesystem paths, dialogs, and project workflows.
- Editor PiP and similar overlay positions are authored in a fixed 1920×1080 canvas space; export/ffmpeg composition should use that same coordinate space so preview and rendered output stay aligned.
- Same-screen system audio may require Electron display-media loopback (`getDisplayMedia` with main-process coordination); external capture-device paths are not a substitute for all desktop/window sources.
- Screen and camera are separate capture/recorder pipelines; stop/save logic must tolerate independent outcomes so one stream cannot block finalization of the other.
