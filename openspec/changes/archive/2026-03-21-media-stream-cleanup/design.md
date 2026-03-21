## Context

The Electron app captures screen, camera, and audio via `getUserMedia` and records them with `MediaRecorder` + `canvas.captureStream`. On macOS, screen capture uses ScreenCaptureKit which creates system-level capture sessions managed by WindowServer — outside the Electron process boundary.

**Current cleanup state:**

| Resource | Created in | Cleanup exists? | Gap |
|----------|-----------|-----------------|-----|
| `screenStream` tracks | `updateScreenStream()` | Only when switching source | Not on quit/close |
| `cameraStream` tracks | `updateCameraStream()` | Only when switching source | Not on quit/close |
| `audioStream` tracks | `updateAudioStream()` | Only when switching source | Not on quit/close |
| `AudioContext` | `startAudioMeter()` | `stopAudioMeter()` on source change | Not on quit/close |
| `MediaRecorder` × 2 | `startRecording()` | `stopRecording()` | Not on quit during recording |
| `screenRecInterval` | `startRecording()` | `stopRecording()` | Not on quit during recording |
| `captureStream` | `startRecording()` | Implicit when canvas is GC'd | May leak with MediaRecorder |
| `scribeWs` WebSocket | `startRecording()` | `stopRecording()` | Not on quit during recording |
| `scribeWorkletNode` | `startRecording()` | `stopRecording()` | Not on quit during recording |
| `mouseTrailTimer` | `start-mouse-trail` IPC | `stop-mouse-trail` IPC | Not on main process quit |
| `drawRAF` | `drawComposite()` | `cancelAnimationFrame` on view switch | Not on quit |

The `beforeunload` handler (line 5460) only flushes the project save and cleans deleted files — no media cleanup.

## Goals / Non-Goals

**Goals:**
- Release all media streams (screen, camera, audio) on window close and app quit
- Close AudioContext on shutdown
- Stop active MediaRecorders gracefully on shutdown
- Clear main-process mouse trail timer on quit
- Prevent resource leaks during rapid dev restarts (`npm run dev` → Ctrl+C → repeat)
- Guard against recording being active when the user closes the window

**Non-Goals:**
- Crash recovery (restoring recording state after crash) — out of scope
- Changing the recording pipeline architecture (setInterval + captureStream stays as-is)
- Handling edge cases like switching screen source mid-recording
- Adding user-visible UI for "recording in progress, are you sure you want to quit?"

## Decisions

### 1. Single `cleanupAllMedia()` function in renderer

**Decision:** Create one function that stops everything — streams, AudioContext, MediaRecorders, intervals, WebSocket — and call it from `beforeunload`.

**Why over alternatives:**
- Alternative: Separate cleanup per resource type → harder to ensure all paths are covered
- Alternative: Cleanup in main process → media streams live in the renderer, can't be stopped from main
- The single function is simple, testable, and covers all exit paths

### 2. Synchronous cleanup in `beforeunload`

**Decision:** The cleanup function must be synchronous (no `await`). `beforeunload` handlers that go async may not complete before the window is destroyed.

**Why:** `beforeunload` in Electron gives limited time. We call `.stop()` on tracks (sync), `.close()` on AudioContext (returns promise but we don't await), and `.stop()` on MediaRecorder (sync). All the critical cleanup is synchronous.

### 3. Main process `before-quit` cleans mouse trail timer

**Decision:** Add `app.on('before-quit', ...)` in `main.js` that clears the `mouseTrailTimer` interval if running.

**Why:** The mouse trail timer lives in the main process (not the renderer), so renderer cleanup can't reach it. The `before-quit` event fires before windows close, giving us a chance to clean up.

**Implementation:** Export a `cleanupMouseTrailTimer()` function from the IPC registration module, call it from the `before-quit` handler.

### 4. No recording-state guard on close (non-goal for now)

**Decision:** Don't add a "you're recording, are you sure?" dialog. Just clean up silently.

**Why:** This is a dev-facing reliability fix, not a UX feature. Adding a dialog requires `event.preventDefault()` in `beforeunload` which has complex interactions with Electron. Keep it simple.

## Risks / Trade-offs

**[Risk] `beforeunload` may not fire on force-kill (Ctrl+C, kill -9)**
→ Mitigation: This is unavoidable. The `before-quit` handler in main process covers the mouse trail timer. For renderer streams, a force-kill will terminate the process and macOS will eventually reclaim the capture sessions (a restart remains the nuclear option).

**[Risk] `MediaRecorder.stop()` in beforeunload might not flush final chunks**
→ Mitigation: If the user is recording when they close, the recording is already lost. We prioritize releasing system resources over saving partial data.

**[Risk] Calling `.close()` on AudioContext during active worklet processing**
→ Mitigation: Disconnect the worklet node before closing. The disconnect is synchronous.
