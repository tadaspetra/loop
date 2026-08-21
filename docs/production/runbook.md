# Production Runbook

## Environment

- Use the Node version from `.nvmrc` (Node 22). Node >= 26 is unsupported: `@electron/packager` / `extract-zip` zip extraction stalls there, which breaks `pnpm run package:smoke` and the `electron` package's install script (`node_modules/electron/path.txt` is never written). The packaging smoke detects the stall and fails loudly instead of reporting a false success.
- Copy `.env.example` to `.env`.
- Set `ELEVENLABS_API_KEY` for post-recording batch transcription (used only in the main process; never exposed to the renderer).

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
