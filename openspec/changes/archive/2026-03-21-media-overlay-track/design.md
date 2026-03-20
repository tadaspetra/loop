## Context

The Loop editor currently has two visual layers: the screen recording (background) and the PIP camera (foreground). The timeline has a single track of sections representing recorded segments. Users want to overlay external media (images, videos) on their recordings at specific time ranges to enhance presentations.

The app already has patterns for:
- **Free-placement interaction**: PIP drag with 9-point snap, reel crop drag
- **Per-mode state persistence**: `savedLandscape`/`savedReel` slots on keyframes
- **Smooth transitions**: `TRANSITION_DURATION` (0.3s) interpolation in `getStateAtTime` and ffmpeg expression builders
- **File lifecycle**: take files copied to project folder, `.delete` staging, reference tracking
- **Section-like timeline items**: sections with trim handles, split, selection, re-indexing
- **FFmpeg overlay compositing**: PIP overlay with animated position/size, alpha transitions

The media overlay feature follows all these established patterns. No new architectural concepts are introduced — only new instances of existing patterns.

## Goals / Non-Goals

**Goals:**
- Users can place images and videos over their screen recording at precise time ranges
- Overlay media is freely positionable and resizable on the editor canvas
- Each layout mode (landscape/reel) has independent overlay positioning
- Overlay segments can be split, trimmed, and deleted independently of sections
- Video overlays play in sync with the editor timeline
- Rendered output includes overlay media composited between screen and PIP
- File management follows existing take file patterns (copy, reference count, .delete staging)

**Non-Goals:**
- Multiple simultaneous overlays (single overlay track, no overlap)
- Audio from video overlays (muted by default; audio toggle is future work)
- Overlay animation presets (slide-in, bounce, etc. — future work)
- Overlay opacity/blend mode controls (future work)
- Real-time overlay during recording (overlays are post-production only)

## Decisions

### 1. Data model: overlay segments as flat array in timeline

**Decision**: Store overlays as `timeline.overlays[]` — a flat sorted array of overlay segment objects, similar to how `timeline.sections[]` stores sections.

**Why over keyframe-based approach**: Overlay segments may reference different parts of the same source video (`sourceStart`/`sourceEnd`). Keyframes on a single item can't express "show video from 0:05-0:15 here, then from 0:30-0:40 there." Segments are also consistent with the section model the user already understands.

**Overlay segment shape**:
```javascript
{
  id: string,                  // unique ID (overlay-{timestamp}-{counter})
  mediaPath: string,           // project-relative path to media file
  mediaType: 'image' | 'video',
  startTime: number,           // position on rendered timeline (seconds)
  endTime: number,             // end position on rendered timeline
  sourceStart: number,         // for video: source playback start (seconds)
  sourceEnd: number,           // for video: source playback end (seconds)
  landscape: { x, y, width, height },  // position/size in landscape canvas coords (1920x1080)
  reel: { x, y, width, height }        // position/size in reel canvas coords (608x1080)
}
```

### 2. Overlay position coordinates: absolute pixel values in canvas space

**Decision**: Store `x, y, width, height` as pixel values in the 1920×1080 (landscape) or 608×1080 (reel) canvas coordinate space.

**Why over normalized 0-1 values**: The editor canvas is always 1920×1080 or 608×1080. Pixel values are direct — no conversion needed for drawing. The PIP system already uses pixel coordinates (`pipX`, `pipY`). Overflow is allowed (values can exceed canvas bounds).

**Default placement on drop**: Center of visible canvas area, width = 40% of effective canvas width, height derived from media aspect ratio. For reel mode, constrained to reel crop region width.

### 3. Overlay track is independent of section track

**Decision**: The overlay timeline operates independently. Section operations (delete, trim, reorder) do NOT affect overlay items. Overlay items reference rendered timeline time, not source recording time.

**Why**: Overlays are supplementary content placed at specific moments in the final output. If a section is deleted and the timeline shortens, overlays that extend past the new end are simply not rendered beyond it — no data modification needed. This avoids complex coupling between tracks.

**Implication**: Overlays can span across section boundaries. An overlay at 5-15s continues playing even if the underlying sections change at 8s.

### 4. Transitions between consecutive same-media segments

**Decision**: When two adjacent overlay segments reference the same `mediaPath`, interpolate position/size over `TRANSITION_DURATION` (0.3s) before the boundary — identical to how PIP position interpolates between section keyframes.

**Why**: This gives smooth movement when the user splits an overlay and repositions the segments differently. It reuses the existing transition system (`getStateAtTime` pattern, `buildNumericExpr` for ffmpeg).

**For non-adjacent or different-media segments**: fade in (opacity 0→1) at `startTime` and fade out (1→0) at `endTime`, each over `TRANSITION_DURATION`.

### 5. File management follows take file patterns

**Decision**: Overlay media files are copied to `{projectFolder}/overlay-media/` on import. The `.delete` staging system is extended to track overlay file references alongside take references.

**File reference counting**: `projectService.stageOverlayFileIfUnreferenced(mediaPath)` counts how many overlay segments reference the file. If zero, the file moves to `.deleted/`. `unstageOverlayFile(mediaPath)` restores it.

**Why separate subfolder**: Keeps overlay media organized separately from recordings. The project folder structure becomes:
```
project-folder/
  recording-*-screen.webm
  recording-*-camera.webm
  overlay-media/
    imported-image-{timestamp}.png
    imported-video-{timestamp}.mp4
  .deleted/
    (staged files awaiting permanent deletion)
```

### 6. Canvas interaction: free drag + corner resize

**Decision**: Overlays are draggable to any position (no snap grid) and resizable by dragging corners. Aspect ratio is maintained during corner resize.

**Why no snap grid (unlike PIP)**: Overlays need precise positioning to highlight specific parts of the screen. A snap grid would be too restrictive. The PIP snap grid works because PIP is a small accent element, but overlays are content.

**Overflow handling**: The overlay can extend beyond canvas boundaries. In the editor, the out-of-bounds portion is drawn with reduced opacity (alpha 0.3). In the render, ffmpeg's overlay filter naturally clips.

**Hit testing priority**: When clicking on canvas, check overlay bounds first, then PIP bounds. The topmost interactive element wins. Only the currently-selected overlay segment responds to drag/resize.

### 7. Render pipeline: overlay composited between screen and PIP

**Decision**: In the ffmpeg filter chain, overlay media is composited after screen processing but before PIP overlay.

**Filter chain**:
```
screen → [fit/zoom/crop] → screen_base
                              ↓
overlay_media → [scale to target size] → [overlay on screen_base with enable='between(t,start,end)']
                                            ↓
                                  [overlay PIP on result] → output
```

**For images**: Use `-loop 1 -t {duration}` input with the image file.
**For videos**: Use standard `-i` input with trim to `sourceStart:sourceEnd`.
**Time-bounded**: `overlay=enable='between(t,{start},{end})'` with position/size.
**Fade**: Apply `fade=in:st={start}:d=0.3,fade=out:st={end-0.3}:d=0.3` on the overlay input before compositing.

### 8. Editor playback: third video element for video overlays

**Decision**: A single reusable `<video>` element for the currently-active video overlay. When the playhead enters an overlay's time range, set the video source and seek to the appropriate source time. When leaving, pause.

**Why single element**: Only one overlay is visible at a time (no overlap). Creating/destroying video elements per overlay would cause unnecessary allocations.

**Sync**: On `editorSeek(time)`, check if time falls within any overlay's `[startTime, endTime]`. If yes, compute `sourceTime = overlay.sourceStart + (time - overlay.startTime)`, set video src if changed, seek video to sourceTime. If no overlay active, hide overlay video element.

### 9. Selection model: overlay track has its own selection

**Decision**: The overlay track has an independent selection state (`editorState.selectedOverlayId`). When an overlay is selected, the section track selection dims. Actions like split, delete, trim apply to the selected overlay, not the section.

**Why**: This mirrors the user's expectation — click on an overlay in the timeline to select it, then perform operations. The section track and overlay track are independent interaction targets.

### 10. Undo/redo: overlay operations follow existing pattern

**Decision**: All overlay mutations (add, delete, split, move, resize, trim) call `pushUndo()` before modifying state. The undo stack captures the full `editorState` snapshot including overlays.

**Why**: This is the existing undo pattern. No new undo infrastructure needed.

## Risks / Trade-offs

**[Risk] FFmpeg filter complexity increases significantly** → Mitigation: Build overlay filter construction as a separate function (`buildOverlayFilter`) that returns a filter chain fragment. Keep it isolated from the existing screen/PIP filter logic. Test independently.

**[Risk] Video overlay seek latency in editor preview** → Mitigation: Preload overlay video when approaching its time range. Use `video.preload = 'auto'`. Accept that first-frame display may have a brief delay — this is acceptable for editor preview (render will be frame-accurate).

**[Risk] Large media files bloat project folder** → Mitigation: This is by design — the user consciously imports media. Future work could add file size warnings or compression options. For now, accept the tradeoff of portability over size.

**[Risk] Overlay timing drift after section operations** → Mitigation: By design, overlay timing is independent of sections. Overlays past the rendered timeline end are simply not rendered. This is the simplest correct behavior. The user can manually adjust overlay timing if they rearrange sections.

**[Trade-off] No multi-layer overlays** → Simplifies the data model, timeline UI, render pipeline, and interaction model considerably. Users who need multi-layer compositing can use dedicated video editors. This feature targets the 90% use case: one supplementary visual at a time.

**[Trade-off] Aspect ratio locked during resize** → Prevents distorted media which would look unprofessional. If users need non-proportional scaling, this can be added later with a modifier key (shift+drag).
