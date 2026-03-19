## Requirements

### Requirement: pipScale normalization
The system SHALL support a `pipScale` value controlling the PIP camera overlay size as a fraction of the effective canvas width. The value range SHALL be 0.15 to 0.50. The default value SHALL be 0.22.

#### Scenario: Default pipScale for new projects
- **WHEN** a new project is created via `createDefaultProject()`
- **THEN** the project's `settings.pipScale` SHALL be 0.22

#### Scenario: Normalizing valid pipScale
- **WHEN** project data is loaded with `pipScale` set to 0.35
- **THEN** `normalizePipScale()` SHALL return 0.35

#### Scenario: Normalizing out-of-range low pipScale
- **WHEN** project data is loaded with `pipScale` set to 0.05
- **THEN** `normalizePipScale()` SHALL return 0.15 (clamped to minimum)

#### Scenario: Normalizing out-of-range high pipScale
- **WHEN** project data is loaded with `pipScale` set to 0.8
- **THEN** `normalizePipScale()` SHALL return 0.50 (clamped to maximum)

#### Scenario: Normalizing missing pipScale
- **WHEN** project data is loaded with `pipScale` set to undefined, null, or NaN
- **THEN** `normalizePipScale()` SHALL return 0.22 (default)

#### Scenario: Persisting pipScale
- **WHEN** the user changes the PIP size and the project is saved
- **THEN** the `pipScale` value SHALL be included in the serialized project settings and keyframes
- **AND** loading the project SHALL restore the same `pipScale` values

### Requirement: Per-section PIP scale
The system SHALL store `pipScale` as a per-keyframe property on section anchor keyframes, allowing each section to have an independent PIP size.

#### Scenario: PIP size varies between sections
- **WHEN** section A has `pipScale` 0.22 and section B has `pipScale` 0.40
- **THEN** the PIP overlay in section A SHALL be 22% of the effective canvas width, and in section B SHALL be 40%

#### Scenario: Smooth PIP size transition
- **WHEN** transitioning from a section with `pipScale` 0.22 to one with `pipScale` 0.40
- **THEN** the PIP size SHALL animate linearly over the 0.3s transition window

#### Scenario: Apply to Future Sections includes pipScale
- **WHEN** the user applies style to future sections
- **THEN** `pipScale` SHALL be copied alongside zoom, pan, cropX, and other section properties

#### Scenario: Section split inherits pipScale
- **WHEN** a section is split at the playhead
- **THEN** the new section's anchor keyframe SHALL inherit `pipScale` from the parent section's anchor

#### Scenario: Backward compatibility
- **WHEN** a project saved before per-section pipScale is loaded (keyframes have no `pipScale`)
- **THEN** all sections SHALL use `settings.pipScale` (or 0.22 if absent) as their `pipScale`

### Requirement: PIP size computed from pipScale and canvas width
The PIP pixel size SHALL be computed as `Math.round(effectiveCanvasW * pipScale)`, where `effectiveCanvasW` is 1920 in landscape mode or 608 (REEL_CANVAS_W) in reel mode.

#### Scenario: PIP size in landscape mode at default scale
- **WHEN** `outputMode` is `'landscape'` and `pipScale` is 0.22
- **THEN** PIP size SHALL be `round(1920 * 0.22)` = 422 pixels

#### Scenario: PIP size in reel mode at default scale
- **WHEN** `outputMode` is `'reel'` and `pipScale` is 0.22
- **THEN** PIP size SHALL be `round(608 * 0.22)` = 134 pixels

#### Scenario: PIP size in reel mode at increased scale
- **WHEN** `outputMode` is `'reel'` and `pipScale` is 0.35
- **THEN** PIP size SHALL be `round(608 * 0.35)` = 213 pixels

### Requirement: PIP size slider UI
The editor controls SHALL include a range slider for adjusting `pipScale`. The slider SHALL appear only when the project has camera footage. The slider controls the current section's anchor keyframe `pipScale`.

#### Scenario: Slider visible with camera
- **WHEN** the editor has camera footage (`hasCamera` is true)
- **THEN** the PIP Size slider SHALL be visible in the controls bar

#### Scenario: Slider hidden without camera
- **WHEN** the editor has no camera footage
- **THEN** the PIP Size slider SHALL be hidden

#### Scenario: Adjusting PIP size
- **WHEN** the user moves the PIP Size slider while a section is selected
- **THEN** only that section's anchor keyframe `pipScale` SHALL be updated
- **AND** the PIP size SHALL update immediately in the preview
- **AND** a project save SHALL be scheduled

#### Scenario: PIP size change is undoable
- **WHEN** the user changes the PIP size via the slider
- **THEN** the change SHALL be pushed to the undo stack

#### Scenario: Slider updates on section change
- **WHEN** the user selects a different section
- **THEN** the PIP Size slider SHALL update to reflect that section's `pipScale` value

### Requirement: PIP position re-snap on scale change
When `pipScale` changes for a section, the PIP position SHALL be re-snapped to the nearest corner using the new size, maintaining proper margins from the edges.

#### Scenario: Resize re-snaps position
- **WHEN** a section's `pipScale` changes from 0.22 to 0.40
- **THEN** the PIP's `pipX` and `pipY` SHALL be recalculated to snap to the nearest corner with the new size

### Requirement: PIP position re-clamping on mode change
When the output mode changes, existing PIP positions in keyframes SHALL be re-mapped to the new coordinate space to keep the camera in approximately the same visual position relative to the output frame.

#### Scenario: PIP position re-mapping on 16:9 to 9:16 switch
- **WHEN** the user switches from landscape to reel mode
- **AND** a keyframe has `pipX: 1478, pipY: 638` (bottom-right corner in 1920-space)
- **THEN** the keyframe's `pipX` SHALL be re-mapped and clamped to valid bounds within the 608-wide canvas
- **AND** positions SHALL be snapped to nearest corner

#### Scenario: PIP position re-mapping on 9:16 to 16:9 switch
- **WHEN** the user switches from reel to landscape mode
- **THEN** PIP positions SHALL be re-mapped back to the 1920x1080 coordinate space
- **AND** positions SHALL be snapped to nearest corner

### Requirement: Corner snapping uses effective canvas dimensions
The `snapToNearestCorner()` function SHALL use the effective canvas dimensions based on `outputMode` (1920x1080 for landscape, 608x1080 for reel) when determining snap positions.

#### Scenario: Corner snap in reel mode
- **WHEN** PIP is dragged and released in reel mode with effective canvas 608x1080
- **THEN** snap positions SHALL be calculated relative to the 608x1080 frame

#### Scenario: Corner snap in landscape mode
- **WHEN** PIP is dragged and released in landscape mode
- **THEN** snap positions SHALL use the existing 1920x1080 dimensions (no behavior change)

### Requirement: Default PIP position computed from effective canvas
The default PIP position SHALL be computed as `(effectiveCanvasW - pipSize - margin, effectiveCanvasH - pipSize - margin)` — the bottom-right corner of the effective canvas.

#### Scenario: Default PIP position in reel mode
- **WHEN** a default PIP position is needed in reel mode with `pipScale: 0.35` (pipSize = 213)
- **THEN** defaultPipX SHALL be `608 - 213 - 15` = 380
- **AND** defaultPipY SHALL be `1080 - 213 - 15` = 852

#### Scenario: Default PIP position in landscape mode
- **WHEN** a default PIP position is needed in landscape mode with `pipScale: 0.22` (pipSize = 422)
- **THEN** defaultPipX SHALL be `1920 - 422 - 20` = 1478
- **AND** defaultPipY SHALL be `1080 - 422 - 20` = 638

### Requirement: Camera fullscreen adapts to output mode
When `cameraFullscreen` is true, the camera SHALL fill the output frame dimensions. In reel mode, this means scaling to 608x1080. The camera source (typically 16:9) SHALL be scaled with `force_original_aspect_ratio=increase` then center-cropped to the output dimensions.

#### Scenario: Fullscreen camera in reel mode render
- **WHEN** rendering with `cameraFullscreen: true` and `outputMode: 'reel'`
- **THEN** the camera fullscreen filter SHALL scale to 608x1080 (not 1920x1080)
- **AND** the camera source SHALL be center-cropped to fit the 9:16 frame

#### Scenario: Fullscreen camera in landscape mode unchanged
- **WHEN** rendering or previewing with `cameraFullscreen: true` and `outputMode: 'landscape'`
- **THEN** behavior SHALL be identical to current implementation (camera fills 1920x1080)

### Requirement: PIP drawn relative to crop region in preview
In reel mode, the editor preview SHALL draw the PIP at position `(cropPixelOffset + pipX, pipY)` on the 1920x1080 canvas, where `pipX`/`pipY` are in the 608x1080 reel coordinate space and `cropPixelOffset` is the crop region's left edge in canvas pixels.

#### Scenario: PIP preview position in reel mode
- **WHEN** reel mode is active with `reelCropX: 0` (cropPixelOffset = 656) and `pipX: 380`
- **THEN** the PIP SHALL be drawn at canvas position `(656 + 380, pipY)` = `(1036, pipY)`

#### Scenario: PIP preview position in landscape mode
- **WHEN** landscape mode is active with `pipX: 1478`
- **THEN** the PIP SHALL be drawn at canvas position `(1478, pipY)` (no offset, current behavior)

#### Scenario: PIP drag bounded to crop region
- **WHEN** the user drags PIP in reel mode
- **THEN** the drag SHALL be constrained to positions within the 608x1080 effective canvas

### Requirement: FFmpeg render with animated PIP size
The FFmpeg render pipeline SHALL support per-keyframe `pipScale` values, producing animated PIP size transitions in the output video using a two-stage scale approach.

#### Scenario: Rendered output matches editor preview
- **WHEN** rendering a video with sections having different `pipScale` values
- **THEN** the PIP size in the output video SHALL match the editor preview at each point in time

#### Scenario: Static PIP size (all sections same)
- **WHEN** all sections have the same `pipScale`
- **THEN** the render pipeline SHALL use a fixed PIP size (no expression overhead)

#### Scenario: Two-stage scale for animated PIP
- **WHEN** sections have different `pipScale` values
- **THEN** the pipeline SHALL first scale to the max pip size (fixed), apply format/geq for round corners, then apply an animated `scale(eval=frame)` to the target size
