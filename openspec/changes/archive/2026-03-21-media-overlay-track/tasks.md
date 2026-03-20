## 1. Data Model & Persistence (media-overlay-data)

- [x] 1.1 Add overlay segment constants and `generateOverlayId()` to `src/shared/domain/project.js` — ID format `overlay-{timestamp}-{counter}`, supported media types, default position/size values
- [x] 1.2 Add `normalizeOverlayPosition(pos)` helper that validates `{ x, y, width, height }` objects with numeric defaults `{ x: 0, y: 0, width: 400, height: 300 }`
- [x] 1.3 Add `normalizeOverlays(rawOverlays)` function — validates, filters, sorts by startTime, enforces no-overlap, normalizes image vs video sourceStart/sourceEnd
- [x] 1.4 Extend `normalizeProjectData()` to normalize `timeline.overlays` using `normalizeOverlays()`
- [x] 1.5 Add unit tests for `normalizeOverlays` — empty input, valid segments, overlapping segments, missing fields, image sourceStart reset, video sourceStart defaults
- [x] 1.6 Add unit tests for `generateOverlayId` uniqueness
- [x] 1.7 Add `overlays` to `getProjectTimelineSnapshot()` in `src/renderer/app.js` so overlays persist with project saves
- [x] 1.8 Add `overlays` to `enterEditor()` so overlays are loaded from project data into `editorState.overlays`
- [x] 1.9 Add `selectedOverlayId: null` to `editorState` initialization

## 2. File Import & Management (media-overlay-files)

- [x] 2.1 Add `import-overlay-media` IPC handler in main process — accepts source file path, copies to `{projectFolder}/overlay-media/` with unique timestamped name, returns project-relative mediaPath
- [x] 2.2 Add `import-overlay-media` to `src/preload.js` bridge
- [x] 2.3 Add duplicate file detection in import handler — compares file size + content against existing overlay-media/ files, reuses path if identical
- [x] 2.4 Add `stageOverlayFileIfUnreferenced(mediaPath)` to `project-service.js` — counts overlay segment references, stages to `.deleted/` if zero references
- [x] 2.5 Add `unstageOverlayFile(mediaPath)` to `project-service.js` — restores from `.deleted/` to overlay-media/
- [x] 2.6 Add IPC channels for `stage-overlay-file` and `unstage-overlay-file` in preload.js
- [x] 2.7 Extend `cleanupDeletedFolder()` to include overlay media files in `.deleted/overlay-media/` (already works — rmSync recursive)
- [x] 2.8 Add integration tests for overlay file import, staging, unstaging, and cleanup

## 3. Timeline UI (media-overlay-timeline)

- [x] 3.1 Add overlay track DOM container in timeline HTML — a new row above the section markers track
- [x] 3.2 Add CSS for overlay track — height, background, positioning above section track
- [x] 3.3 Implement `renderOverlayMarkers()` — renders overlay segment bands at correct timeline positions with type icon and filename label
- [x] 3.4 Add overlay segment selection — click handler sets `editorState.selectedOverlayId`, highlights selected overlay band, dims section selection
- [x] 3.5 Add mutual exclusion: clicking section deselects overlay (`selectedOverlayId = null`), clicking overlay deselects section
- [x] 3.6 Add overlay trim handles — appear on selected overlay's left/right edges, similar to section trim handles
- [x] 3.7 Implement overlay trim drag — left handle adjusts startTime (+ sourceStart for video), right handle adjusts endTime (+ sourceEnd for video), with no-overlap clamping
- [x] 3.8 Implement overlay split at playhead — when overlay is selected and playhead is within its range, split into two segments with correct sourceStart/sourceEnd division
- [x] 3.9 Implement overlay delete — remove selected overlay, stage media file if last reference, push undo
- [x] 3.10 Integrate overlay operations with undo/redo — all overlay mutations call pushUndo(), undo/redo restores overlay state

## 4. Drag-and-Drop Import (media-overlay-files + media-overlay-data)

- [x] 4.1 Add dragover/drop event handlers on editor canvas — detect file drop, filter supported image/video extensions
- [x] 4.2 On valid drop: call `import-overlay-media` IPC, create overlay segment with default position/size (centered, 40% width landscape / 70% width reel), add to `editorState.overlays`, place at current playhead time
- [x] 4.3 Determine video duration on drop (probe via ffmpeg or video element) to set initial endTime and sourceEnd (default 5s for video, adjustable via trim)
- [x] 4.4 Determine image dimensions on drop (via Image element) to compute correct aspect ratio for default size
- [x] 4.5 Enforce no-overlap on drop — adjust startTime/endTime to fit in available gap at playhead position

## 5. Canvas Drawing & Playback (media-overlay-canvas + media-overlay-playback)

- [x] 5.1 Add `getOverlayStateAtTime(time, overlays, outputMode)` function — returns active overlay info with position, size, opacity (fade transitions), sourceTime for video
- [x] 5.2 Add position interpolation in `getOverlayStateAtTime` for consecutive same-media segments
- [x] 5.3 Create overlay image cache — `Map<mediaPath, HTMLImageElement>`, load images on overlay creation, cache for session
- [x] 5.4 Create single reusable `<video>` element for overlay video playback — managed alongside existing screen/camera video elements
- [x] 5.5 Draw overlay in editor draw loop — after screen drawing, before PIP drawing. Use `getOverlayStateAtTime()` for position/opacity. Draw image from cache or video frame from overlay video element.
- [x] 5.6 Implement overflow visualization — clip canvas to draw in-bounds portion at full opacity, then draw out-of-bounds portion at alpha 0.3
- [x] 5.7 Sync overlay video on seek — when playhead enters video overlay range, set video src (if changed), seek to computed sourceTime
- [x] 5.8 Sync overlay video during playback — start/pause overlay video as playhead enters/exits overlay range
- [x] 5.9 Add reel mode offset — apply reel crop offset to overlay position when drawing in reel mode

## 6. Canvas Interaction (media-overlay-canvas)

- [x] 6.1 Add overlay hit-testing in canvas mousedown — check if click is within active overlay bounds (with priority over PIP), start drag if selected overlay clicked
- [x] 6.2 Implement overlay free-drag — update current mode's {x, y} on mousemove, no clamping (overflow allowed), pushUndo on first move
- [x] 6.3 Add corner hit-testing for resize — detect clicks within 20px of overlay corners
- [x] 6.4 Implement corner resize with aspect ratio lock — scale from anchored opposite corner, maintain original aspect ratio, enforce 50px minimum size, pushUndo on first resize
- [x] 6.5 Store drag/resize results in correct mode slot — landscape.{x,y,width,height} or reel.{x,y,width,height} based on current outputMode
- [x] 6.6 Add visual resize handles — draw small squares at corners of selected overlay during draw loop
- [x] 6.7 Update cursor style — show move cursor when hovering overlay, resize cursor when hovering corners

## 7. Per-Mode State (media-overlay-canvas)

- [x] 7.1 Set both landscape and reel default positions at overlay creation time (centered, mode-appropriate widths)
- [x] 7.2 On output mode switch, read overlay position from the new mode's slot — no save/restore needed since both slots exist from creation
- [x] 7.3 Verify overlay position persistence survives project save/load cycle — both mode slots round-trip through normalizeOverlays

## 8. Render Pipeline (media-overlay-render)

- [x] 8.1 Add `buildOverlayFilter(overlays, canvasW, canvasH, outW, outH, targetFps)` function in `render-filter-service.js` — returns filter chain fragment for all overlay segments
- [x] 8.2 Implement image overlay filter — scale input, apply fade in/out, overlay with enable expression and position
- [x] 8.3 Implement video overlay filter — trim to sourceStart/sourceEnd, scale, apply fade, overlay with enable and position
- [x] 8.4 Implement position interpolation in render — for adjacent same-media segments, use animated position/size expressions with eval=frame over TRANSITION_DURATION
- [x] 8.5 Handle reel mode overlay rendering — use reel position slot, scale to reel output dimensions, composite after reel crop
- [x] 8.6 Add unit tests for `buildOverlayFilter` — no overlays (empty), single image, single video, multiple overlays, reel mode, position interpolation between segments
- [x] 8.7 Integrate overlay inputs into `buildInputPlan()` in `render-service.js` — add overlay media files as additional ffmpeg inputs
- [x] 8.8 Integrate overlay filter into render pipeline in `render-service.js` — insert overlay filter between screen_base and PIP overlay
- [x] 8.9 Add integration test for render with overlay — verify ffmpeg args include overlay input, filter, and correct positioning

## 9. Final Verification

- [x] 9.1 Run `npm run check` — all tests pass, lint clean, typecheck clean
- [x] 9.2 Manual test: drop image onto canvas, verify it appears, drag/resize, split, trim, delete, undo
- [x] 9.3 Manual test: drop video onto canvas, verify playback syncs, trim, split
- [x] 9.4 Manual test: render landscape output with overlay, verify correct positioning and fade
- [x] 9.5 Manual test: render reel output with overlay, verify reel-mode positioning
- [x] 9.6 Manual test: switch between landscape and reel modes, verify per-mode overlay positions are independent
- [x] 9.7 Manual test: save project, close, reopen — verify overlays persist with correct positions
