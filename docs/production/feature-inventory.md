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
- Recorders prefer H.264 (`video/webm; codecs=h264`) so encoding stays
  hardware-accelerated at 4K: realtime software VP9 silently dropped camera
  output to ~9fps on 4K takes. VP9/VP8 remain as runtime fallbacks.
- Screen capture requests a 30fps floor (`minFrameRate`) on desktop sources.
- Camera capture demands a hard 30fps floor (`frameRate.min`) at up to 4K, so
  a camera that offers 4K only below 30fps negotiates down in resolution, not
  frame rate; if a device rejects the floor outright the camera reopens
  without it (capture beats quality, same policy as the mic).
- Output takes include media paths and duration.
- The mic is requested as mono (`channelCount: { ideal: 1 }`): stereo capture
  from a mic on an audio interface lands the voice on one channel and silence
  on the other, which plays in one ear and sounds quiet downstream.

## C. Transcript And Trim

### C1. On-demand Transcribe & Cut and Remove Bad Takes

- Stopping a recording puts the take on the timeline immediately as one full-length section — no transcription and no network call in the stop flow.
- The timeline toolbar's "Transcribe & Cut" button batch-transcribes the target take's mic audio (audio-only file, or audio extracted from the camera file via ffmpeg stream copy) with ElevenLabs Scribe in the main process, groups word timestamps into speech segments, and replaces the take's timeline sections with speech-cut (silence-removed) sections. It also stores the spoken word tokens on the take (`transcriptSegments`, persisted in `project.json`, recording-time coords) so bad-take detection and restore can run later without re-transcribing. It does not remove repeated takes.
- The separate "Remove Bad Takes" button detects bad takes in the stored transcript and removes their ranges from the take's current sections surgically — kept sections are only trimmed or split, so silence cuts and manual edits survive. Cut-created piece edges snap inward to the nearest protected content (words, in-session system-audio activity, or — for takes recorded in an earlier app session — audible ranges derived from the decoded system-audio waveform envelope) plus padding, so a kept piece never opens with the dead air that sat between a flub and its retry, and pieces that are pure inter-flub silence are dropped. With that complete protection set it also sweeps pre-existing silent slivers (word-less, sound-less sections ≤ 1.5s) left by earlier removals; longer silent sections stay, since a long pause may be deliberate. Only when a system-audio take has neither activity ranges nor a decoded envelope does the cleanup fall back to plain padded bounds, so screen sound is never trimmed on word evidence alone. It requires a prior Transcribe & Cut. Detection is the union of two deterministic local detectors plus an optional LLM pass:
  - the conservative exact-prefix repeated-take detector (unchanged, `mistake-detection.ts`);
  - a restart-cluster detector (`restart-detection.ts`) keyed on Scribe's cutoff markers (`--`, `...`): speech ending cut off contains a bad take when a nearby retry (silence hops up to 4s, other aborted attempts may sit between, and the retry may itself end cut off in a chained flub) restarts the same thought — at least 4 shared opening tokens (stutter repeats collapsed, fillers dropped) and at least 60% of the flubbed words reappearing in the retry, which must materially continue. The retry's opening is matched at every word position inside the cut-off unit and the rightmost match wins, so when a good final take of one section flows without a pause into a flubbed start of the next section, only the flubbed tail is removed (word-precise with word-level stored tokens; coarse legacy transcripts fall back to whole-unit removal). This catches rephrased retries, stutter restarts, and slower re-records that exact-prefix matching misses; because removal is an explicit, restorable action, it is deliberately more assertive than the conservative detector.
  - an LLM pass (`retake-llm-service.ts`, main process only, enabled by the optional `OPENAI_API_KEY` env var; model defaults to `gpt-5.6-sol`, override via `OPENAI_RETAKE_MODEL`): the stored words are grouped into sentence chunks (`retake-chunks.ts`, split at sentence punctuation, cutoff markers, and pauses) and only chunk index + text + pause length are sent — never media, file paths, or project metadata. The model returns indices of chunks it judges as entirely superseded — abandoned attempts whose content a later chunk re-delivers, even fully reworded; the prompt forbids flagging a chunk that contains both an attempt and its good retry. Indices are strictly validated, mapped back to word-precise times from our own chunk boundaries (the model can never invent a time range), and the take's final chunk is never removable. Missing key, request failure, or timeout falls back to the local detectors with a visible status note. The LLM pass is also skipped (with a "run Transcribe & Cut again" note) when the stored transcript is coarse pre-word-level data, because a coarse chunk mixing a flub with its good retry cannot be split and would be removed whole.
- The transcript panel header shows a "Restore all" button whenever any removed takes exist; it re-inserts every removed range across all takes as one undo step, for quickly resetting after an over-eager detection. Individual entries keep their per-entry Restore buttons.
- The target take for both buttons is the selected section's take, falling back to the most recent take still on the timeline.
- Removed bad takes stay visible in the section transcript list as dimmed, struck-through entries interleaved at their take position, each with a Restore button that puts that range back on the timeline as its own section (a single undo step). The removed list is derived from the stored utterances and the current sections — never persisted separately — so undo/redo and manual edits always keep it consistent. Silence cut-outs are not shown.
- Repeated-take removal is deterministic and conservative: words are grouped
  into fine-grained utterances (0.5s gap). A single earlier utterance is removed
  only when it is clearly incomplete and the immediately following utterance
  repeats a sufficiently long/distinctive normalized prefix after a short
  pause with material continuation. A bounded adjacent run may also collapse
  several progressively longer matching attempts, including tiny matching
  restart fragments, when at least three prior attempts and three distinct
  completion lengths make the final continuation unambiguous. Exact full
  repeats without that progression, vague/common prefixes, corrections, lists,
  quotes, long pauses, and intervening speech are retained. Survivors re-merge
  at the normal 1.5s gap. Media files are never modified.

Acceptance criteria:

- The recording view shows no transcript panel and no silence-cutting option; recorder failures surface on a compact notice line.
- The stop flow performs no transcription work; the finalized files and the recovery checkpoint are on disk before the take enters the timeline.
- Transcribe & Cut applies as a single undo step; failure, timeout, no-speech, or a timeline edit made while transcription was in flight leaves the timeline unchanged and reports a visible status.
- Remove Bad Takes and each Restore apply as single undo steps; running Remove Bad Takes without a stored transcript, or when nothing is detected, changes nothing and reports a visible status.
- Word timestamps map into take time using the per-file recorder start offsets; non-speech annotations are stripped; system-audio "keep" regions captured during the same app session are respected.
- Takes without mic audio report a visible message and trigger no network call.
- Utterances with fewer than 4 meaningful tokens are never independently
  classified as mistakes; only a matching micro-fragment inside an established
  multi-attempt staircase may be excluded. Punctuation, case, and at most two
  filler tokens may be normalized only when all other high-confidence restart
  evidence is present. When takes are removed the status line reports the
  count, and neighbors are never merged across a removed take so flub audio
  cannot survive inside a kept section.

### C3. Section computation

- App computes timeline sections from speech segments with padding and overlap merge.
- If compute fails/no speech, app falls back to full duration or local remap logic.

Acceptance criteria:

- Output sections are ordered, non-negative, and have positive duration.
- Padded and computed source ranges are clamped to the take duration, reflowed
  monotonically, and never overlap.
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

Acceptance criteria:

- Playback crosses section boundaries without visible dead frames.
- End-of-timeline pauses and resets controls safely.
- Opening a timeline creates media elements only for the active take and the
  immediate next distinct take; inactive neighbors use metadata-only preload.
- Paused editor compositing is invalidation-driven. Playback uses video-frame
  callbacks (with an animation-frame safety fallback), while seeks, media
  readiness, image loads, resize, and canvas interactions request one paused
  frame instead of running a permanent 24fps loop.
- Drag scrubbing updates the playhead for every pointer event, limits decoder
  seeks to 50ms intervals, and commits the exact release position before
  optionally resuming playback. Media play rejection is shown in the editor.
- Timeline waveform detail is derived from cached per-take peak envelopes and
  capped at 4,096 rendered buckets. Proxy decode failures retry canonical raw
  audio; loading, no-audio, partial, and unavailable states are visible, and a
  missing waveform never represents the take as proven silent.
- One-sided stereo takes (pre-mono-capture recordings with the mic on one
  channel) play centered: the decoded waveform buffer doubles as the
  channel-balance analysis, the waveform draws from the active channel, and
  the mic-owning media element is routed through a WebAudio splitter/merger
  so both ears hear the active channel. Balanced takes never touch WebAudio.

### E3. Section editing

- User can trim section edges, split at playhead, delete sections.

Acceptance criteria:

- Section operations preserve non-overlap and positive durations.
- Keyframes are remapped consistently after delete/split.
- Undo/redo restores exact prior snapshots.
- Trim dragging patches only the active section bands until pointer release;
  the full marker/transcript DOM, waveform, undo snapshot, and autosave state
  are finalized once after the drag.

### E4. Camera keyframing

- Section anchor keyframes define camera style; user can toggle camera visibility/fullscreen and apply style to future sections.

Acceptance criteria:

- Camera state transitions remain deterministic at section boundaries.
- Applying style to future updates only forward sections from current selection.

### E5. Screen layer placement (OBS-style)

- The editor canvas is a fixed 16:9 (1920×1080 authoring) frame. The screen
  recording keeps its native capture resolution and can be freely placed
  inside the frame: drag the screen layer to move it, drag a corner handle to
  resize (aspect-locked), double-click to reset to the plain Fill/Fit mode.
- The placement is stored as `settings.screenTransform` (`{x, y, scale}`:
  center in 1920×1080 authoring space, scale relative to the aspect-fit
  size); `null` keeps the legacy `screenFitMode` behavior.
- Selecting Fill/Fit in the Mode select clears the transform.
- Layer grabbing is disabled while a zoomed section uses drag-to-pan or while
  the camera is fullscreen over the frame.
- While dragging, the editor zooms out to a workspace view: the 16:9 frame
  reads by background contrast (black frame on a lighter workspace, no border
  lines) and content hanging outside it stays visible as a dimmed ghost
  (dimmed = cropped from output).
- Corner handles are clamped into the frame in the normal view, so an
  overflowing placement (e.g. Fill on a 16:10 capture) stays resizable even
  when its true corners sit off-frame; the workspace view shows true corners.
- Moving snaps the layer's edges/center to the frame edges and center lines
  (pink guide lines show engaged snaps); resizing snaps the dragged corner to
  the frame. Holding Alt disables snapping.

Acceptance criteria:

- Placement math is shared (`src/shared/domain/screen-layout.ts`) so editor
  preview, MP4 render, preview proxy, and Premiere export agree pixel-wise.
- Invalid/malformed transforms normalize to `null` (legacy behavior).
- MP4/preview renders reproduce the placement via a scale/crop/pad chain;
  legacy projects without a transform produce unchanged filter graphs.
- Premiere export expresses the placement as Basic Motion scale/center on the
  screen clip in the 1920×1080 sequence, composed with background zoom/pan.
- The camera PiP imports into Premiere with square corners (no rounding).
  Rounded-corner mattes via xmeml were attempted and intentionally reverted —
  see the Premiere xmeml notes in `AGENTS.md` before re-attempting.

## F. Render/Export

### F1. Composite render

- App renders timeline sections into final MP4 with ffmpeg:
  - trims source sections
  - concatenates audio/video
  - applies fit/fill and camera PiP/fullscreen keyframe transitions
  - outputs CFR stream
- Before building the filter graph, every audio-carrying input (mic-owning
  screen/camera/external file plus system-audio screen files) is probed with
  ffmpeg `astats` for per-channel RMS; one-sided stereo inputs get a `pan`
  rebalance prepended to each audio chain reading that input so the mic plays
  centered at recorded loudness instead of quiet in one ear.

Acceptance criteria:

- No-section render request fails fast with explicit error.
- Takes referenced by sections must exist or render fails clearly.
- FPS probing chooses stable target fps and enforces CFR output.
- Each audio-carrying input file is channel-probed once per render regardless
  of section count; balanced/mono inputs produce an unchanged filter graph.
- The rebalance runs before the trim/adelay/apad timing chain, leaving
  drift-clamping behavior byte-identical.
- A failed channel probe never fails the render — the file simply renders
  unrebalanced; probe aborts still cancel the render.

### F2. Premiere export audio fidelity

- Exported media must sound like the raw recordings: transcodes only convert
  format (AAC/PCM, 48 kHz stereo) and never apply creative processing.
- Before transcoding, every audio-carrying input (legacy mic-on-screen or
  system-audio screen files, mic-owning camera files, dedicated mic files) is
  probed with ffmpeg `astats` for per-channel RMS.
- One-sided stereo inputs (one channel active, the other digitally silent or
  ≥40 dB down) transcode with a `pan` filter that routes the active channel
  to both output channels at full level, so the audio is centered and at the
  recorded loudness in Premiere.

Acceptance criteria:

- Balanced stereo and mono inputs transcode without any pan filter.
- A failed channel probe never fails the export — the file simply transcodes
  unrebalanced; probe aborts still cancel the export.
- Repeated sections over one take probe and transcode that take's files once.

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
