## 1. Renderer Cleanup Function

- [x] 1.1 Create `cleanupAllMedia()` function in `app.js` that: stops all tracks on `screenStream`/`cameraStream`/`audioStream` (null-safe), calls `stopAudioMeter()`, closes `AudioContext` if open, stops any active `MediaRecorder` instances, clears `screenRecInterval`, disconnects `scribeWorkletNode` if connected, closes `scribeWs` WebSocket if open, clears `audioSendInterval`, cancels `drawRAF` and editor draw loop
- [x] 1.2 Ensure `cleanupAllMedia()` is idempotent — safe to call multiple times, handles null/already-stopped resources without throwing
- [x] 1.3 Add unit-testable guards: each resource check uses `if (resource) { ... resource = null; }` pattern so double-calls are no-ops

## 2. Renderer beforeunload Integration

- [x] 2.1 Call `cleanupAllMedia()` in the existing `beforeunload` handler (before the project save flush)
- [x] 2.2 If recording is active when `beforeunload` fires, set `recording = false` before cleanup so `screenRecInterval` callback and other guards stop immediately

## 3. Main Process Quit Cleanup

- [x] 3.1 Export a `cleanupMouseTrailTimer()` function from `register-handlers.js` that clears `mouseTrailTimer` if running and resets `mouseTrailSamples`
- [x] 3.2 Add `app.on('before-quit', ...)` handler in `main.js` that calls `cleanupMouseTrailTimer()`
- [x] 3.3 Update `registerIpcHandlers` to return (or export via the module) the cleanup function so `main.js` can call it

## 4. Tests

- [x] 4.1 Add unit test: `cleanupAllMedia` called with all-null resources does not throw
- [x] 4.2 Add unit test: `cleanupMouseTrailTimer` clears active timer and resets samples
- [x] 4.3 Add unit test: `cleanupMouseTrailTimer` called with no active timer does not throw

## 5. Verification

- [x] 5.1 Run `npm run check` — all tests pass, lint clean
- [ ] 5.2 Manual test: start recording, close window, reopen app, record again — verify new recording produces full frames
- [ ] 5.3 Manual test: repeat 5+ rapid start/stop/restart cycles — verify no degradation
