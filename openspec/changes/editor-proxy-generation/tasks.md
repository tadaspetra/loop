## 1. Proxy Service (Main Process)

- [x] 1.1 Create `src/main/services/proxy-service.js` with a `generateProxy({ screenPath, proxyPath, ffmpegPath })` function that builds and runs the ffmpeg command (960×540, H264 CRF 23, preset fast, -g 15, AAC 64k, +faststart), writing to a `.tmp` path first then renaming on success and deleting `.tmp` on failure
- [x] 1.2 Add a concurrency queue inside `proxy-service.js` (max 2 concurrent jobs) so multiple `generateProxy` calls are serialized when more than 2 arrive simultaneously
- [x] 1.3 Write unit tests for `generateProxy` in `tests/unit/proxy-service.test.js` covering: happy path (ffmpeg exit 0 → rename), ffmpeg failure (exit non-zero → .tmp deleted, no final file), concurrency limit (3 calls → only 2 run at once, 3rd starts after first completes)

## 2. IPC Handler (Main Process)

- [x] 2.1 Add `proxy:generate` IPC handler in `register-handlers.js` that accepts `{ takeId, screenPath, projectFolder }`, derives the proxy output path (`screenPath` basename with `-proxy.mp4` suffix in same directory), calls `proxyService.generateProxy(...)` in the background (non-blocking), and sends `proxy:progress` events with `{ takeId, status: 'started' }`, `{ takeId, status: 'done', proxyPath }`, or `{ takeId, status: 'error', error }` back to the renderer window
- [x] 2.2 Inject `proxyService` into `registerIpcHandlers` via its deps object (same pattern as `renderComposite`) and update `src/main.js` to construct and pass the proxy service
- [x] 2.3 Expose `proxy:generate` on `window.electronAPI` via `src/preload.js` (invoke) and expose a `onProxyProgress` listener (ipcRenderer.on) following the existing `onRenderCompositeProgress` pattern
- [x] 2.4 Write integration tests in `tests/integration/proxy-ipc.test.js` covering: IPC handler calls generateProxy, on-success event reaches renderer, on-error event reaches renderer

## 3. Data Model — proxyPath on Take

- [x] 3.1 Update `normalizeProjectData` in `src/shared/domain/project.js` to pass `proxyPath` through the same `toProjectAbsolutePath` resolution as `screenPath`, `cameraPath`, and `mousePath` (null if absent)
- [x] 3.2 Update `saveProjectToDisk` in `src/main/services/project-service.js` to serialize `proxyPath` via `toProjectRelativePath` alongside the other take paths
- [x] 3.3 Update `stageTakeFiles` (and its IPC layer) in `project-service.js` to include `proxyPath` in the list of files moved to `.deleted/`, skipping gracefully if `proxyPath` is null or the file doesn't exist
- [x] 3.4 Update `unstageTakeFiles` in `project-service.js` to restore the proxy file from `.deleted/` alongside the other take files
- [x] 3.5 Write/update unit tests in `tests/unit/project.test.js` and `tests/unit/project-service.test.js` covering: proxyPath round-trips through normalizeProjectData, proxyPath serialized as relative in saveProjectToDisk, stageTakeFiles moves proxyPath to .deleted/ when present, stageTakeFiles skips proxyPath gracefully when null, unstageTakeFiles restores proxyPath from .deleted/

## 4. Renderer — Trigger Proxy Generation

- [x] 4.1 In `src/renderer/app.js`, after `persistProjectNow()` completes inside `stopRecording()`, call `window.electronAPI.generateProxy({ takeId, screenPath, projectFolder: activeProjectPath })` — fire and forget, no await needed
- [x] 4.2 In `src/renderer/app.js`, after `enterEditor()` is called during `activateProject()`, iterate `activeProject.takes` and for any take where `take.proxyPath` is null or `take.proxyPath` does not exist on disk (check via a preload-exposed `fs.existsSync` or accept that the existence check happens in the main process), call `window.electronAPI.generateProxy(...)` for each missing-proxy take
- [x] 4.3 Register a `window.electronAPI.onProxyProgress` listener in the renderer that on `status: 'done'` finds the matching take in `activeProject.takes` by `takeId`, sets `take.proxyPath = proxyPath`, and calls `persistProjectNow()`; on `status: 'error'` logs the error to console

## 5. Renderer — Use Proxy in Video Element

- [x] 5.1 In `getOrCreateTakeVideos(takeId)` in `src/renderer/app.js`, change `screen.src = pathToFileUrl(take.screenPath)` to `screen.src = pathToFileUrl(take.proxyPath || take.screenPath)` — this is the only line that needs to change for playback
- [x] 5.2 Verify (manual test or e2e) that the export path (`render-composite` IPC) still receives `take.screenPath` values from `editorState.takes` and is never passed `proxyPath`

## 6. Tests and Verification

- [x] 6.1 Update existing `take-file-cleanup` integration/unit tests to assert that `proxyPath` is included in staged files when present, and that it is correctly restored on unstage
- [x] 6.2 Run the full test suite (`pnpm test`) and confirm all tests pass with no regressions
- [x] 6.3 Manual smoke test: record a 90-second clip → stop recording → confirm proxy `.mp4` appears in project folder within ~30 s → open editor → scrub timeline and confirm no lag → export and confirm output is 1920×1080 (not 960×540)
- [x] 6.4 Manual smoke test: open an existing project (recorded before this change) with no proxy files → confirm proxy generation starts in background → editor is immediately usable against original `.webm` → proxy takes effect on next section/take switch
