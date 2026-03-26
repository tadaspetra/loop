## Context

The editor currently plays back raw `.webm` recordings (VP9/VP8) directly in HTML5 `<video>` elements. For recordings over ~1 minute, two problems compound:

1. **Seek latency**: VP9 WebM stores keyframes every 2–5 seconds. Seeking requires the browser to locate the nearest prior keyframe and software-decode every frame up to the target. For a 3-second keyframe interval at 30 fps, a single seek can decode 90 frames before showing the result.
2. **Decode + canvas throughput**: `editorDrawLoop` runs on every video frame callback, reading a 1920×1080 VP9 frame and blitting it through an intermediate `editorZoomBuffer` canvas before compositing onto the final `editorCtx`. VP9 has limited hardware acceleration in Electron on macOS, so this saturates the renderer thread.

The existing infrastructure (ffmpeg-static bundled, `runFfmpeg()` utility, `take.screenPath`/`cameraPath`/`mousePath` pattern, relative-path serialization in project.json) provides a clean foundation to add proxy generation with minimal new surface area.

## Goals / Non-Goals

**Goals:**
- Generate a lightweight proxy `.mp4` per take in the background immediately after recording stops.
- On project open, queue proxy generation for any takes that lack a proxy (backward-compatible with existing projects).
- The editor `<video>` element uses the proxy when available, falling back to the original `.webm` while the proxy is being built.
- Proxy path is persisted on the take in `project.json` (relative path, same pattern as screenPath).
- Proxy files are staged/unstaged/cleaned as part of the existing file-lifecycle mechanism.
- Export (`render-service.js`) is never touched — it always reads from the original `.webm`.

**Non-Goals:**
- Proxy for the camera video — camera recordings are smaller and already hardware-friendly (lower resolution, short duration). Camera continues to use its original file.
- Quality preview / pre-rendered composite — this is a separate problem (Option B from exploration). This change is purely a source-file proxy.
- Proxy regeneration after source file is edited — proxies represent the raw capture, not the edit state.
- UI progress bar for proxy generation — a simple console log is sufficient for the first iteration. Can be enhanced later.

## Decisions

### Decision 1: Proxy codec and encoding settings

**Chosen**: `libx264`, 960×540, CRF 23, preset `fast`, `-g 15`, AAC 64 kbps, `-movflags +faststart`

| Setting | Value | Rationale |
|---|---|---|
| Codec | libx264 | Hardware-acceleratable in Chromium/Electron; universally supported; excellent random-seek via keyframe index |
| Resolution | 960×540 | Half of 1920×1080 in each dimension → 4× less pixel data per frame to decode and blit; visually sharp enough for editing |
| CRF | 23 | Default quality point for H264; good visual fidelity; proxy is not the export |
| Preset | fast | ~3–5× realtime encode speed on typical Mac; a 90-second recording proxies in ~20–30 s |
| Keyframe interval | `-g 15` | At 30 fps → keyframe every 0.5 s → worst-case seek decodes 15 frames, not 90 |
| Audio | AAC 64 kbps | The screen video element is the audio source in the editor; keeping audio in the proxy avoids splitting video/audio between two elements |
| faststart | `-movflags +faststart` | Moves the moov atom to the file head; browser can start playing without fully downloading the file |

**Alternatives considered:**
- **VP9 with lower CRF**: Still slow to seek, and hardware acceleration is unreliable in Electron.
- **No-encode remux to MP4**: Preserves VP9 but doesn't fix keyframe spacing or resolution; seek improvement is marginal.
- **Half-res ProRes / lossless**: Excellent quality, terrible file size, not needed for a display proxy.

### Decision 2: When proxy generation is triggered

**Chosen**: Two trigger points, both fire-and-forget:
1. **After `stopRecording()`** — immediately after the take is saved to disk and `persistProjectNow()` returns, the renderer sends `proxy:generate` for the new take's `screenPath`.
2. **On project open** — `activateProject()` inspects all takes; for any take where `proxyPath` is null or the proxy file does not exist on disk, it queues a `proxy:generate` call.

**Rationale**: Both triggers ensure the proxy is always available for any take the user might edit. The post-recording trigger covers the common case; the open-project trigger handles backward compatibility.

**Alternatives considered:**
- **On first scrub/play in editor** (lazy): Avoids generating proxies for takes the user never edits, but means the first interaction is always slow.
- **Explicit "Optimize for editing" button**: Good UX affordance, but adds friction and requires users to know about it.

### Decision 3: Where to store the proxy file

**Chosen**: Alongside the source file in the project folder.
- Filename: derived from the screen source filename with `-proxy` suffix and `.mp4` extension.
- Example: `recording-1710000000000-screen.webm` → `recording-1710000000000-screen-proxy.mp4`

**Rationale**: Project folders are self-contained. Moving, copying, or archiving a project folder keeps all its proxies with it. The existing path-relative serialization (`toProjectRelativePath` / `toProjectAbsolutePath`) works without modification.

### Decision 4: IPC design

**Chosen**: `proxy:generate` is a fire-and-forget `ipcMain.handle` that starts the ffmpeg process and returns immediately (returns the expected proxy output path). Progress and completion are communicated back to the renderer via `event.sender.send('proxy:progress', { takeId, status, proxyPath })` — matching the pattern used by `render-composite-progress`.

**Rationale**: Blocking the renderer on proxy generation would freeze the editor. The renderer can start editing against the original `.webm` immediately and transparently switch to the proxy when the `proxy:progress` event carries `status: 'done'`.

**On completion**: The renderer updates `take.proxyPath` in the in-memory `activeProject.takes` array and calls `persistProjectNow()` to write it to disk. The next `getOrCreateTakeVideos()` call (which happens on seek or section switch) picks up the proxy automatically.

### Decision 5: Fallback behavior while proxy is being built

**Chosen**: `getOrCreateTakeVideos()` checks `take.proxyPath` first. If it exists and the file is present on disk, it uses it. Otherwise it uses `take.screenPath`. The fallback is silent — the user sees normal (potentially slower) behavior until the proxy is ready, then the next seek or section switch uses it.

**No mid-session hot-swap of the active video element**: Swapping `src` on a playing `<video>` causes a momentary stall. The proxy takes effect on the next element creation (section switch or re-open). This is acceptable since proxy generation is fast (~20–30 s) and the user typically starts editing after the recording is processed.

### Decision 6: Data model — proxyPath on take

**Chosen**: Add `proxyPath` as an optional field on the take object, alongside `screenPath`, `cameraPath`, and `mousePath`.
- In memory: absolute path (or `null`)
- In `project.json`: relative path (or `null`), via existing `toProjectRelativePath` / `toProjectAbsolutePath`
- `normalizeProjectData` in `shared/domain/project.js` reads `take.proxyPath` through the same path-resolution logic

**Rationale**: Consistent with existing take data model. The proxy path persists across sessions — if the proxy already exists on disk when the project is opened, no regeneration is needed.

### Decision 7: Proxy cleanup

**Chosen**: The existing `project:stageTakeFiles` / `project:unstageTakeFiles` IPC calls are extended to include `proxyPath` in their file list. No new IPC channel is needed.

**Rationale**: The staging mechanism already handles any number of file paths for a take. Adding the proxy path to the array keeps the logic centralized.

## Risks / Trade-offs

- **Disk space**: Each 1-minute proxy is ~20–40 MB (H264 960×540). For projects with many takes this adds up. Mitigation: proxies can be deleted and regenerated at any time from the source `.webm`.
- **libx264 availability**: The bundled `ffmpeg-static` binary includes libx264 on all platforms (verified by the existing export path which uses `libx264` with CRF 12). No risk.
- **Race condition — app quit during proxy generation**: The ffmpeg child process may be orphaned if the app quits mid-proxy. Mitigation: the output file will be incomplete; on next project open the proxy existence check (`fs.existsSync(proxyPath)`) will fail (since ffmpeg writes to a temp path then renames, or the partial file will fail to load), so the take will be re-queued. Alternatively, write to a `.tmp` path first and rename on success.
- **Multiple takes on project open**: If a project has 10 takes all missing proxies, 10 ffmpeg processes could start simultaneously. Mitigation: use a simple queue (sequential or max-2 concurrent) in the main process.

## Migration Plan

1. Ship the change. Existing projects open normally — all takes have `proxyPath: null`.
2. On first open, any take missing a proxy is queued for background generation.
3. No user action required. Proxies are built silently.
4. Rollback: deleting proxy `.mp4` files from project folders reverts behavior to original — no data loss.

## Open Questions

- Should a visible "Optimizing for editing..." status indicator be shown in the editor header while proxies are generating? (Can be deferred to a follow-up polish pass.)
- Should proxies be capped at the source video's native resolution if the source is already ≤960×540? (Edge case — screen recordings are typically ≥1080p.)
