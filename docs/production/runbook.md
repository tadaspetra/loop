# Production Runbook

## Environment

- Copy `.env.example` to `.env`.
- Set `ELEVENLABS_API_KEY` for realtime transcription token generation.

## Local Verification

- `pnpm run build:styles`
- `pnpm run check`

`check` runs:

- lint (`eslint`)
- static checks (`tsc --noEmit`)
- unit + integration tests (`vitest` with coverage thresholds)
- Electron smoke e2e (`tests/e2e/smoke-electron.test.mjs`)
- packaging smoke (`scripts/package-smoke.mjs`)

## CI

- Workflow: `.github/workflows/ci.yml`
- Verifies style build, lint, typecheck, test suite, e2e smoke, packaging smoke.

## Packaging

- Use `pnpm run package:smoke` as a release gate before publishing artifacts.
