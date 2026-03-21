## Why

The app creates system-level media resources (ScreenCaptureKit sessions, camera streams, AudioContext, WebSocket connections, main-process timers) during recording but has no cleanup on window close, app quit, or crash. When the Electron process terminates without releasing these resources, macOS WindowServer retains stale capture sessions. Over multiple dev restarts this accumulates, eventually starving the GPU readback path that `captureStream` + `MediaRecorder` depend on — causing recordings to produce only a handful of frames. The only recovery is a full system restart.

## What Changes

- Add a comprehensive `beforeunload` cleanup in the renderer that stops all active streams (`screenStream`, `cameraStream`, `audioStream`), closes `AudioContext`, stops `MediaRecorder` instances, clears recording intervals, and closes any open Scribe WebSocket.
- Add a `before-quit` handler in the main process that clears the mouse trail capture timer if still running.
- Add a `will-quit` IPC message from main → renderer (or direct cleanup) to ensure streams are released even when the window is force-closed via the OS.
- Add an IPC endpoint `cleanup-mouse-trail` that the main process calls on quit to clear its own timer without waiting for the renderer.
- Guard project/recording transitions so switching projects while recording forces a clean stop first.

## Capabilities

### New Capabilities
- `media-stream-lifecycle`: Defines the cleanup contract for all media resources (streams, AudioContext, MediaRecorder, WebSocket, main-process timers) across app quit, window close, project switch, and crash recovery scenarios.

### Modified Capabilities
_(none — this is a cleanup/reliability improvement, not a behavior change to existing features)_

## Impact

- **Renderer** (`src/renderer/app.js`): `beforeunload` handler expanded; new `cleanupAllMedia()` function; guard in `loadProject`/`switchProject` path.
- **Main process** (`src/main.js`): New `before-quit` handler.
- **IPC** (`src/main/ipc/register-handlers.js`): Mouse trail timer cleanup on quit.
- **Preload** (`src/preload.js`): Possible new IPC bridge for cleanup signal (if needed).
- **No breaking changes** to user-facing behavior or project data.
