## Why

Editing and scrubbing recordings longer than ~1 minute is noticeably laggy in the editor canvas. The root cause is that the editor plays back the original `.webm` source files (VP9/VP8 codec) directly: VP9 has sparse keyframes (every 2–5 s), so every seek requires decoding potentially dozens of frames; and decoding 1920×1080 VP9 in software while simultaneously running canvas 2D compositing saturates the renderer thread. Since the user edits constantly (scrubs, adjusts zoom, cuts sections), this lag affects every editing session on longer recordings.

## What Changes

- **After each recording finishes**, a background ffmpeg job transcodes the raw `.webm` screen recording into a lightweight proxy `.mp4` (H264, 960×540, keyframe every 0.5 s, `+faststart`).
- **The editor uses the proxy** for its `<video>` element when it exists, falling back to the original `.webm` while the proxy is still being built.
- **On project open**, any takes that are missing a proxy (e.g. recorded before this feature shipped) are queued for background proxy generation.
- **The proxy path is persisted** on the take in `project.json` alongside `screenPath` / `cameraPath` / `mousePath`.
- **Proxy cleanup** is integrated into the existing file-staging mechanism: when a take is staged for deletion, its proxy is staged too.
- **Export is unaffected**: `render-service.js` always uses the original `screenPath` — the proxy is display-only.

## Capabilities

### New Capabilities

- `take-proxy-files`: Background generation, persistence, and lifecycle management of per-take proxy MP4 files used to accelerate editor playback and seeking.

### Modified Capabilities

- `take-file-cleanup`: The file staging/unstaging/cleanup operations must include `proxyPath` in addition to `screenPath`, `cameraPath`, and `mousePath`.

## Impact

- **New file**: `src/main/services/proxy-service.js` — ffmpeg proxy generation logic
- **Modified**: `src/main/ipc/register-handlers.js` — new IPC channels `proxy:generate`, forwarded progress events
- **Modified**: `src/main/services/project-service.js` — include `proxyPath` in take serialization / deserialization / staging
- **Modified**: `src/shared/domain/project.js` — `normalizeProjectData` passes through `proxyPath`
- **Modified**: `src/renderer/app.js` — `getOrCreateTakeVideos()` prefers proxy; `stopRecording()` fires proxy generation after take is saved; project-open path queues missing proxies
- **No change** to `src/main/services/render-service.js` — export always uses originals
- **Dependency**: `ffmpeg-static` already present; `libx264` included in bundled ffmpeg binary (verified in existing render flow)
