## Context

Loop is an Electron desktop app for recording screen-based videos with AI-powered editing. The current architecture produces exclusively 16:9 (landscape) output at source resolution (typically 1920x1080). The rendering pipeline uses ffmpeg with a filter complex that chains: section trimming/concatenation, zoom/pan via `zoompan` filter, and camera PIP overlay via `overlay` filter.

**Current render pipeline flow:**
```
Source (16:9) → trim/concat → scale → zoompan → camera overlay → output (16:9)
```

**Key existing systems this change touches:**
- **Keyframe system** (`project.js`): Each keyframe has `{ time, pipX, pipY, pipVisible, cameraFullscreen, backgroundZoom, backgroundPanX, backgroundPanY, sectionId, autoSection }`. Keyframes are per-section anchors that define camera and zoom state. Transitions between keyframes use 0.3s linear interpolation.
- **FFmpeg expression builder** (`render-filter-service.js`): `buildNumericExpr()` generates nested `if(gte(...))` ffmpeg expressions for runtime interpolation of any numeric property across keyframes. This is the core of smooth animation during rendering.
- **Editor preview** (`app.js:getStateAtTime()`): JavaScript equivalent of the ffmpeg interpolation — computes the interpolated state at any given time for real-time canvas preview.
- **Canvas system**: Fixed 1920x1080 canvas. PIP positioned in absolute pixel coordinates within this space. Corner snapping on drag release.
- **Project persistence**: Full project state serialized to JSON. All keyframe properties and settings are round-tripped through normalizers (`normalizeKeyframes`, `normalizeProjectData`).

**Constraints:**
- AGENTS.md mandates test-first development and `npm run check` before completion
- Shared domain logic belongs in `src/shared/`, renderer features in `src/renderer/features/`
- Cross-platform behavior matters — no macOS-only assumptions

## Goals / Non-Goals

**Goals:**
- Users can export recordings as 9:16 vertical video for social media platforms
- The crop region is visually represented in the editor preview at all times
- Crop position is configurable per section with smooth animated transitions
- Camera PIP size is adjustable to fit the narrower 9:16 frame
- Camera fullscreen mode adapts to the 9:16 output dimensions
- Existing 16:9 workflow is completely unaffected (backward compatible)
- Existing zoom/pan features compose cleanly with the reel crop

**Non-Goals:**
- Auto-tracking mouse cursor or content detection for automatic crop positioning
- Arbitrary aspect ratios (only 16:9 and 9:16)
- Per-keyframe PIP size animation (v1 uses a global project setting)
- Vertical recording source support (source is always assumed 16:9)
- Mobile/web export — output is always a local MP4 file

## Decisions

### Decision 1: Reel crop as a new keyframe property (`reelCropX`)

**Choice:** Add a single `reelCropX` property (range -1 to +1, default 0) to the existing keyframe data model.

**Rationale:** The existing keyframe system already handles per-section anchored properties with smooth interpolation. `backgroundZoom`, `backgroundPanX`, `backgroundPanY` follow this exact pattern. Adding `reelCropX` to the same system means:
- Zero new interpolation logic — `buildNumericExpr()` handles it automatically for ffmpeg rendering
- Zero new preview logic — `getStateAtTime()` interpolation block handles it with the same `t` factor
- Undo/redo works automatically (keyframe mutations are already tracked)
- "Apply to Future" button copies it alongside other section properties
- Section splitting inherits it from the parent section

**Alternatives considered:**
- *Per-section property (not keyframe)*: Would require a separate interpolation system for smooth transitions. More work, less consistency.
- *Separate "crop keyframe" system*: Over-engineered. The existing keyframe system is designed for exactly this kind of property.

**Effect on the app:** Every code path that creates, copies, normalizes, or serializes keyframes needs to include `reelCropX`. This includes: `normalizeKeyframes()`, `getSectionAnchorKeyframe()`, `syncSectionAnchorKeyframes()`, `buildSplitAnchorKeyframe()`, `applyStyleToFutureSections()`, `getRenderKeyframes()`, `getRenderSections()`, `getProjectTimelineSnapshot()`.

---

### Decision 2: Crop applied AFTER zoom/pan in the ffmpeg pipeline

**Choice:** The reel crop filter is appended after the zoompan filter in the ffmpeg filter chain.

**Pipeline becomes:**
```
Source → scale → zoompan → CROP (9:16 strip) → camera overlay → output
```

**Rationale:** Zoom/pan operates on the full 16:9 frame, narrowing what the viewer sees. The reel crop then selects which vertical strip of that zoomed view to show. This composition is intuitive:
- Zoom focuses on a region of interest
- Reel crop frames it for vertical output
- They're independent controls that compose cleanly

**Implementation:** In `buildScreenFilter()`, when `outputMode === 'reel'`, append a `crop=REEL_W:REEL_H:X_EXPR:0` filter after the zoompan output (or after the base scale if no zoom animation exists). The `X_EXPR` is built using `buildNumericExpr(keyframes, 'reelCropX', ...)` converted to pixel coordinates via the formula: `((reelCropX + 1) / 2) * (sourceW - cropW)`.

**Crop math for 1920x1080 source:**
- Reel output: `outW = round(1080 * 9/16) = 608`, `outH = 1080`
- Crop region: 608px wide, 1080px tall
- Horizontal range: 0px to 1312px (= 1920 - 608)
- `reelCropX = -1` → pixel offset 0 (left edge)
- `reelCropX = 0` → pixel offset 656 (center)
- `reelCropX = +1` → pixel offset 1312 (right edge)

**Effect on the app:** `buildScreenFilter()` and `buildFilterComplex()` gain an `outputMode` parameter. The `resolveOutputSize()` function gains an `outputMode` parameter to return 608x1080 for reel mode. All callers of these functions must pass `outputMode` through.

---

### Decision 3: PIP coordinates relative to the crop region (not full canvas)

**Choice:** In reel mode, PIP `pipX`/`pipY` coordinates are relative to the 9:16 output frame (608x1080), not the full 16:9 canvas (1920x1080).

**Rationale:** PIP must always appear within the output frame. If coordinates were relative to the full 16:9 canvas, the PIP could be positioned outside the visible crop region. By using crop-relative coordinates:
- Corner snapping works naturally (snaps to corners of the 9:16 frame)
- PIP drag is bounded to the visible output area
- The ffmpeg overlay filter receives coordinates in output space, which is correct
- No need for complex "clamp PIP to crop region" logic

**Effect on the app:**
- `snapToNearestCorner()` must use different canvas dimensions based on output mode
- Default PIP position must be recalculated for reel mode
- When toggling 16:9 ↔ 9:16, existing PIP positions need re-clamping to the new coordinate space
- The editor preview must offset PIP drawing by the crop region's X position (since the preview canvas is still 1920x1080, but PIP coords are in 608-space)
- `buildFilterComplex()` scaling factor (`outW / canvasW`) automatically handles coordinate translation when `canvasW` reflects the reel canvas width

**Visualization of coordinate spaces:**
```
Full preview canvas (1920x1080):
┌──────────────────────────────────────────────┐
│░░░░░░║ cropX=200                    ║░░░░░░░│
│░░░░░░║                              ║░░░░░░░│
│░░░░░░║    PIP at (400, 800)         ║░░░░░░░│
│░░░░░░║    in 608-space              ║░░░░░░░│
│░░░░░░║    → drawn at (600, 800)     ║░░░░░░░│
│░░░░░░║    in preview canvas         ║░░░░░░░│
└──────────────────────────────────────────────┘

Preview PIP position = cropPixelOffset + pipX
Render PIP position  = pipX (directly in output space)
```

---

### Decision 4: PIP size as a global project setting (not per-keyframe)

**Choice:** Add a `pipScale` project setting (range 0.15 to 0.5, default 0.22) that controls PIP size as a fraction of the effective canvas width.

**Rationale:**
- Current PIP size is already a fixed constant (`PIP_FRACTION = 0.22`), not per-keyframe
- Making it per-keyframe would require adding `pipScale` to keyframe model, interpolation in `getStateAtTime()`, expression building in `buildNumericExpr()`, and ffmpeg filter changes for dynamic PIP scaling — significant complexity
- A global setting solves the primary problem: PIP at 22% of 1920 = 422px works for 16:9, but 22% of 608 = 134px is too small for 9:16. Users need a way to adjust this.
- Can be promoted to per-keyframe in a future iteration if demand exists

**Effect on the app:**
- New `pipScale` field in project settings (alongside `screenFitMode`, `cameraSyncOffsetMs`, etc.)
- `PIP_SIZE` becomes computed: `Math.round(effectiveCanvasW * pipScale)` instead of a constant
- The PIP size slider appears in the editor controls
- `renderComposite()` receives `pipSize` (already parameterized) — the renderer computes it from `pipScale` and canvas width
- `buildFilterComplex()` already takes `pipSize` as a parameter — no change needed there

---

### Decision 5: Editor preview shows full 16:9 with crop overlay

**Choice:** The editor canvas stays at 1920x1080 in all modes. In reel mode, the full 16:9 frame is rendered, then a semi-transparent dark overlay covers the area outside the 9:16 crop region, with dashed boundary lines.

**Rationale:**
- Users need spatial context to position the crop effectively
- Seeing the full frame helps when deciding where to place the crop region
- The crop region boundaries serve as visual guides
- Dragging the crop is more intuitive when you can see what's outside it
- The existing canvas drawing pipeline doesn't need restructuring

**Alternative considered:** Render only the 9:16 crop area in the preview. Rejected because it removes spatial context needed for crop positioning. Users can't see what's to the left or right of their crop.

**Effect on the app:**
- `editorDrawLoop()` gains a post-processing step: after drawing screen + camera, draw the crop overlay
- The overlay consists of: two semi-transparent black rectangles (left and right of crop), and a dashed white rectangle around the crop boundary
- This runs every frame of the editor draw loop — performance impact is negligible (two `fillRect` calls and one `strokeRect`)

---

### Decision 6: Output mode toggle placement and controls layout

**Choice:** Add the aspect ratio toggle (16:9 / 9:16) to the editor controls bar, along with a PIP Size slider. To avoid overflow, reorganize into context-sensitive groupings.

**Layout:**
```
[Undo] [Redo] [Play] [Split] [Camera] [Full] | [Zoom ━━━] [PIP Size ━━━] [16:9|9:16] | [Apply to Future]
```

The PIP Size slider appears only when a camera is present. The Crop X slider is NOT shown as a separate control — instead, the user positions the crop by **dragging the crop region directly on the preview canvas**. This keeps the controls clean and the interaction spatial.

**Rationale:** A crop slider would be redundant with direct canvas manipulation. Dragging is more intuitive for spatial positioning. The zoom slider stays because zoom range (1x-3x) is less spatially intuitive. PIP size slider stays because size adjustment is a scalar value, not a spatial position.

---

### Decision 7: Handling 16:9 ↔ 9:16 toggle transition

**Choice:** When switching output modes:

**16:9 → 9:16:**
- All sections' `reelCropX` defaults to 0 (center) if not previously set
- PIP positions are re-mapped: `newPipX = pipX * (REEL_CANVAS_W / CANVAS_W)`, clamped to reel bounds
- PIP size is recalculated using `pipScale * REEL_CANVAS_W`
- The crop overlay appears immediately

**9:16 → 16:9:**
- `reelCropX` values are preserved (not deleted) so toggling back doesn't lose work
- PIP positions are re-mapped back: `newPipX = pipX * (CANVAS_W / REEL_CANVAS_W)`, clamped
- PIP size is recalculated using `pipScale * CANVAS_W`
- The crop overlay disappears

**Rationale:** Preserving `reelCropX` on toggle-back prevents accidental data loss. Users may toggle back and forth while experimenting. The PIP position re-mapping ensures the camera stays in approximately the same visual position relative to the output frame.

---

### Decision 8: Camera fullscreen in reel mode

**Choice:** In reel mode, "fullscreen" camera fills the 9:16 output frame (608x1080). The camera feed (typically 16:9 from a webcam) is scaled with `force_original_aspect_ratio=increase` then cropped to 608x1080, showing the center of the face.

**Rationale:** This matches the existing fullscreen behavior pattern — camera fills the entire output frame. For a landscape camera source, the center-crop approach preserves the subject's face (which is typically centered).

**Effect on the app:** In `buildFilterComplex()`, the camera fullscreen scaling already uses `outW:outH`. Since `resolveOutputSize()` returns reel dimensions when in reel mode, this adapts automatically. The preview in `editorDrawLoop()` must also scale the fullscreen camera to reel dimensions — the `camW/camH` calculation uses the effective canvas size.

---

### Decision 9: Backward compatibility and project migration

**Choice:** No migration needed. Existing projects without `outputMode` or `reelCropX` default to `'landscape'` and `0` respectively through the normalizer functions.

**Rationale:** The normalizer pattern used throughout the project (`normalizeKeyframes`, `normalizeProjectData`) already handles missing fields gracefully. Adding new optional fields with sensible defaults is the established pattern (as was done for `backgroundZoom`, `backgroundPanX`, etc.).

**Effect:** `normalizeOutputMode(undefined)` returns `'landscape'`. `normalizeReelCropX(undefined)` returns `0`. No project file format versioning needed.

## Risks / Trade-offs

### Risk 1: Zoom + crop interaction confusion
Users might not understand that zoom operates on the full frame while crop selects within the zoomed result. **Mitigation:** The preview shows the composition visually — zoom changes the background, crop overlay adjusts on top. The visual feedback should make the interaction clear. If users report confusion, a future enhancement could add a tooltip or brief animation.

### Risk 2: PIP position drift on mode toggle
Re-mapping PIP coordinates between 1920→608 and back involves rounding. Multiple toggles could cause slight position drift. **Mitigation:** Clamp to nearest corner after toggle, which is the snap behavior already used on PIP drag release. This makes the position deterministic.

### Risk 3: FFmpeg filter complexity
Adding the crop filter increases the filter complex string length. For multi-section renders with many keyframes, the `reelCropX` interpolation expression could become long. **Mitigation:** The existing `buildNumericExpr()` already handles arbitrary-length keyframe lists for zoom/pan without issues. The crop expression is the same pattern.

### Risk 4: Preview performance
Drawing the crop overlay adds `fillRect` and `strokeRect` calls per frame. **Mitigation:** These are trivial 2D canvas operations. No measurable performance impact expected.

### Risk 5: PIP too small in 9:16 even with slider
At minimum `pipScale` (0.15), PIP in reel mode = `0.15 * 608 = 91px`. This may be too small for visibility. **Mitigation:** Set minimum `pipScale` differently per mode, or enforce a minimum absolute pixel size (e.g., 80px).
