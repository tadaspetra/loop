# Feature Inventory And Acceptance Matrix

This document captures the current product behavior before refactor so tests can assert user-visible outcomes instead of implementation details.

## A. Project Lifecycle

### A1. Create project

- User enters a project name, picks a location, app creates a project folder and `project.json`.
- If target folder exists and is non-empty, app creates a numbered sibling folder (e.g. `My Project 2`).

Acceptance criteria:

- Creating project returns a valid `projectPath` and normalized project payload.
- New project defaults:
  - settings: `screenFitMode=fill`, `hideFromRecording=true`
  - timeline: empty sections/keyframes, `duration=0`
  - `id`, `createdAt`, `updatedAt` present

### A2. Open project

- User opens an existing folder containing `project.json`.
- App loads project data, normalizes malformed/missing values, and restores absolute media paths.

Acceptance criteria:

- Opening invalid/missing project path returns an explicit error.
- Opening valid project updates recent/last project metadata.

### A3. Persist project

- App autosaves timeline/settings and manual save points after major actions.
- Paths are stored relative to project folder where possible.

Acceptance criteria:

- Save writes canonical JSON shape.
- Reloading saved data preserves semantic timeline/takes values.

### A4. Recent and last project list

- Home view shows recent projects and a “resume last project” action.

Acceptance criteria:

- Recent list deduplicates and caps at configured max.
- Missing/deleted project folders are automatically filtered out.

## B. Capture And Devices

### B1. Source enumeration

- App enumerates desktop/window sources from Electron and media input devices from browser APIs.

Acceptance criteria:

- Screen/camera/mic selectors populate with defaults when available.
- No-device scenarios do not crash; controls remain disabled safely.

### B2. Live preview

- Composite preview draws screen (fit/fill) and optional camera PiP.

Acceptance criteria:

- Preview loop starts only when stream exists.
- Switching source/fit mode updates preview without stale tracks.

### B3. Recording

- Recording captures screen (always) and optional camera streams, both with selected audio input.

Acceptance criteria:

- Record/stop toggles UI state, timer, selector locks, and output files.
- Screen capture uses stable 30fps canvas path.
- Output takes include media paths and duration.

## C. Transcript And Trim

### C1. Batch transcript

- After recording stops and the take's files are finalized and checkpointed for recovery, the app batch-transcribes the finalized mic audio (audio-only file, or audio extracted from the camera file via ffmpeg stream copy) with ElevenLabs Scribe in the main process, then groups word timestamps into speech segments.

Acceptance criteria:

- No transcription network call happens before the finalized files and the recovery take are on disk; a transcription failure or timeout never loses or blocks the recording (falls back to full-duration sections with a visible warning).
- Speech segments store `start/end/text`, with word timestamps mapped into recording time using the per-file recorder start offsets.
- Non-speech annotations (e.g. bracketed cues) are stripped from segment content.
- Recordings without mic audio skip transcription entirely (no network call).

### C3. Section computation

- App computes timeline sections from speech segments with padding and overlap merge.
- If compute fails/no speech, app falls back to full duration or local remap logic.

Acceptance criteria:

- Output sections are ordered, non-negative, and have positive duration.
- `trimmedDuration` equals last section end or `0`.

## D. Recovery

### D1. Pending take recovery

- App writes `.pending-recording.json` before timeline append completion.
- On project reopen, app attempts to recover and append unfinished take.

Acceptance criteria:

- Invalid/missing media paths invalidate and clear stale recovery payload.
- Recovered take is not duplicated if already present.
- Recovery file is cleared on successful append completion.

### D2. Quit guard while recording

- Closing the window mid-recording is intercepted; the renderer prompts
  "Recording in progress — stop and save before quitting?".
- On confirm, the recording is stopped and finalized to disk before the
  window actually closes; on cancel, recording continues.

Acceptance criteria:

- Window close is prevented only while a recording is active (renderer keeps
  main informed via `recording:set-active`).
- A stop/finalize failure still allows the close (bytes remain in `.part`
  files and are recoverable on next launch).
- If the renderer is unreachable, the close proceeds instead of wedging the
  window open.

## E. Timeline Editor

### E1. Enter/exit timeline

- App builds timeline from one or more takes, sections, and keyframes.

Acceptance criteria:

- Timeline duration equals end of last section.
- Section labels/indexes are contiguous and stable after mutations.

### E2. Playback

- Play/pause/seek across section boundaries and multiple takes.
- Sync optional camera playback to screen with soft/hard resync policy.
- Apply an optional per-project camera sync offset to advance or delay camera playback relative to screen/audio.

Acceptance criteria:

- Playback crosses section boundaries without visible dead frames.
- Camera sync offset affects seek/playback consistently across section switches.
- End-of-timeline pauses and resets controls safely.

### E3. Section editing

- User can trim section edges, split at playhead, delete sections.

Acceptance criteria:

- Section operations preserve non-overlap and positive durations.
- Keyframes are remapped consistently after delete/split.
- Undo/redo restores exact prior snapshots.

### E4. Camera keyframing

- Section anchor keyframes define camera style; user can toggle camera visibility/fullscreen and apply style to future sections.

Acceptance criteria:

- Camera state transitions remain deterministic at section boundaries.
- Applying style to future updates only forward sections from current selection.

## F. Render/Export

### F1. Composite render

- App renders timeline sections into final MP4 with ffmpeg:
  - trims source sections
  - concatenates audio/video
  - applies optional camera sync offset compensation before camera compositing
  - applies fit/fill and camera PiP/fullscreen keyframe transitions
  - outputs CFR stream

Acceptance criteria:

- No-section render request fails fast with explicit error.
- Takes referenced by sections must exist or render fails clearly.
- FPS probing chooses stable target fps and enforces CFR output.

## G. Cross-Cutting Behavior

### G1. Content protection

- “Invisible from recording” setting syncs with `setContentProtection`.

Acceptance criteria:

- Toggle updates UI state, persists in project settings, and applies to current window.

### G2. Robustness and data hygiene

- Input payloads may be partially malformed due to previous versions/manual edits.

Acceptance criteria:

- Project/timeline normalization defends against malformed values.
- Failures are explicit and non-destructive (no silent data loss for valid fields).
