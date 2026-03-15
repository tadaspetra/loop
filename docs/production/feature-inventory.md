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

### C1. Realtime transcript
- During recording, app sends PCM chunks to Scribe realtime websocket and displays partial + committed text.

Acceptance criteria:
- Committed transcript segments store `start/end/text`.
- Non-speech annotations (e.g. bracketed cues) are stripped from user-visible transcript and segment content.

### C2. Segment editing
- User can select transcript segments and toggle deletion with keyboard shortcuts.

Acceptance criteria:
- Deleted segments are excluded from trim input.
- Badge reflects active vs removed count.

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
