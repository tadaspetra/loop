## Context

The reel mode (9:16) feature is implemented. In reel mode, a 608px-wide vertical crop is taken from the 1920px-wide landscape canvas. The existing `backgroundZoom` (1x–3x) zooms into the source before cropping. Users want to zoom OUT — show more than 608px of content width by shrinking the content, with the resulting letterbox bars (top/bottom) filled attractively.

Current zoom range: `MIN_BACKGROUND_ZOOM=1` to `MAX_BACKGROUND_ZOOM=3` in `src/shared/domain/project.js`. The zoom is applied via ffmpeg `zoompan` filter and the editor's `drawEditorScreenWithZoom()`.

## Goals / Non-Goals

**Goals:**
- Allow zoom values < 1.0 in reel mode to "zoom out" and show more content width
- Fill the vertical letterbox bars with a darkened scaled copy of the content (Option B — no blur, just darken to ~20-30% brightness)
- Consistent visual between editor preview and ffmpeg render output
- Minimal performance impact in the editor draw loop

**Non-Goals:**
- Real-time Gaussian blur in the preview (too expensive)
- Zoom-out in landscape mode (no letterbox bars to fill in 16:9)
- Animated background fill transitions (the darkened background just follows the content)

## Decisions

### 1. Zoom range is mode-dependent

In landscape mode, zoom stays 1.0–3.0. In reel mode, zoom extends to 0.5–3.0. The minimum of 0.5 means showing up to ~1216px of source width in the 608px frame — content occupies ~50% of the frame height, which is the practical limit before the content becomes too small.

**In the domain model:** `normalizeBackgroundZoom` keeps its current 1.0–3.0 range. A new `normalizeReelBackgroundZoom` (or a mode-aware variant) clamps to 0.5–3.0. The editor's `clampSectionZoom` becomes mode-aware so the slider and keyframe system use the right bounds.

**Alternative considered:** A separate "reel zoom" property. Rejected because it's conceptually the same axis — how much of the source is visible. Reusing `backgroundZoom` with an extended range is simpler and integrates automatically with existing keyframe interpolation.

### 2. Zoom slider range updates dynamically

When switching to reel mode, the HTML slider's `min` attribute changes from `1` to `0.5`. When switching back to landscape, it reverts to `1` and any zoom values < 1 are clamped up to 1. This happens in `updateOutputModeUI()` and `setOutputMode()`.

### 3. Editor preview: darkened scaled copy (no blur)

When zoom < 1 in reel mode, the draw loop:
1. Draws the screen content into the crop region at the zoomed-out scale (centered vertically)
2. For the background, takes the same content, scales it to fill the full crop area (608x1080), draws it at very low opacity (~0.2) over a black background

Implementation in `editorDrawLoop`:
- Draw black fill for the crop region
- Draw the crop-region content scaled to fill → draw with `globalAlpha = 0.2`
- Draw the actual zoomed-out content centered over it at full opacity

This is just 2 extra `drawImage` calls per frame — negligible cost.

### 4. FFmpeg pipeline: split + overlay

When any keyframe has zoom < 1 in reel mode, the filter chain adds:
1. After the crop, split the stream
2. One branch: scale to fill 608x1080 + darken via `colorlevels=rimax=0.3:gimin=0:bimin=0`
3. Other branch: scale to fit within 608x1080 (preserving aspect), pad with transparent to 608x1080
4. Overlay the sharp content on the dark fill

If zoom is animated (transitions between zoom-out and zoom-in), the scale expressions need to be dynamic. This adds complexity to `buildScreenFilter` but follows the existing `buildNumericExpr` pattern.

### 5. Pan behavior during zoom-out

When zoom < 1, the content is smaller than the frame width, so horizontal pan has no effect (the content is fully visible). The pan controls should be disabled or ignored when zoom < 1. Vertical centering is fixed (content is centered in the 608x1080 frame).

## Risks / Trade-offs

- **Zoom transitions crossing 1.0**: Animating from zoom 0.7 to zoom 1.5 crosses the boundary where the darkened background appears/disappears. The background opacity should fade smoothly rather than popping in/out. → Mitigation: Interpolate background opacity based on zoom level near the 1.0 boundary.
- **Existing projects with zoom=1**: No impact — zoom ≥ 1 follows the existing pipeline unchanged. The new code path only activates when zoom < 1 in reel mode.
- **FFmpeg filter complexity**: The split/overlay adds filter nodes but only when zoom < 1 is actually used. No impact on landscape renders or reel renders with zoom ≥ 1.
