## ADDED Requirements

### Requirement: pipScale project setting
The system SHALL support a `pipScale` project setting controlling the PIP camera overlay size as a fraction of the effective canvas width. The value range SHALL be 0.15 to 0.50. The default value SHALL be 0.22 (matching the current hardcoded `PIP_FRACTION`).

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
- **THEN** the `pipScale` value SHALL be included in the serialized project settings
- **AND** loading the project SHALL restore the same `pipScale` value

### Requirement: PIP size computed from pipScale and canvas width
The PIP pixel size SHALL be computed as `Math.round(effectiveCanvasW * pipScale)`, where `effectiveCanvasW` is 1920 in landscape mode or 608 (REEL_CANVAS_W) in reel mode. This replaces the current fixed `PIP_SIZE = Math.round(1920 * 0.22)` = 422.

#### Scenario: PIP size in landscape mode at default scale
- **WHEN** `outputMode` is `'landscape'` and `pipScale` is 0.22
- **THEN** PIP size SHALL be `round(1920 * 0.22)` = 422 pixels (same as current behavior)

#### Scenario: PIP size in reel mode at default scale
- **WHEN** `outputMode` is `'reel'` and `pipScale` is 0.22
- **THEN** PIP size SHALL be `round(608 * 0.22)` = 134 pixels

#### Scenario: PIP size in reel mode at increased scale
- **WHEN** `outputMode` is `'reel'` and `pipScale` is 0.35
- **THEN** PIP size SHALL be `round(608 * 0.35)` = 213 pixels

#### Scenario: PIP size passed to render pipeline
- **WHEN** `renderComposite()` is called
- **THEN** the `pipSize` parameter SHALL reflect the computed size from `pipScale` and the effective canvas width for the current `outputMode`

### Requirement: PIP size slider UI
The editor controls SHALL include a range slider for adjusting `pipScale`. The slider SHALL appear only when the project has camera footage.

#### Scenario: Slider visible with camera
- **WHEN** the editor has camera footage (`hasCamera` is true)
- **THEN** the PIP Size slider SHALL be visible in the controls bar

#### Scenario: Slider hidden without camera
- **WHEN** the editor has no camera footage
- **THEN** the PIP Size slider SHALL be hidden

#### Scenario: Adjusting PIP size
- **WHEN** the user moves the PIP Size slider
- **THEN** the PIP size SHALL update immediately in the preview
- **AND** the `pipScale` setting SHALL be updated
- **AND** a project save SHALL be scheduled

#### Scenario: PIP size change is undoable
- **WHEN** the user changes the PIP size via the slider
- **THEN** the change SHALL be pushed to the undo stack

### Requirement: PIP position re-clamping on mode change
When the output mode changes, existing PIP positions in keyframes SHALL be re-mapped to the new coordinate space to keep the camera in approximately the same visual position relative to the output frame.

#### Scenario: PIP position re-mapping on 16:9 to 9:16 switch
- **WHEN** the user switches from landscape to reel mode
- **AND** a keyframe has `pipX: 1478, pipY: 638` (bottom-right corner in 1920-space)
- **THEN** the keyframe's `pipX` SHALL be re-mapped to approximately `round(1478 * (608 / 1920))` and clamped to valid bounds within the 608-wide canvas
- **AND** `pipY` SHALL be re-clamped to valid bounds within the 1080-tall canvas

#### Scenario: PIP snaps to nearest corner after mode toggle
- **WHEN** the output mode is toggled
- **THEN** PIP positions SHALL be snapped to the nearest corner of the new canvas dimensions using `snapToNearestCorner()` with the effective canvas width/height

#### Scenario: PIP position re-mapping on 9:16 to 16:9 switch
- **WHEN** the user switches from reel to landscape mode
- **THEN** PIP positions SHALL be re-mapped back to the 1920x1080 coordinate space
- **AND** positions SHALL be snapped to nearest corner

### Requirement: Corner snapping uses effective canvas dimensions
The `snapToNearestCorner()` function SHALL use the effective canvas dimensions based on `outputMode` (1920x1080 for landscape, 608x1080 for reel) when determining snap positions.

#### Scenario: Corner snap in reel mode
- **WHEN** PIP is dragged and released in reel mode with effective canvas 608x1080
- **THEN** snap positions SHALL be calculated relative to the 608x1080 frame
- **AND** the four corners SHALL be: (margin, margin), (608-pipSize-margin, margin), (margin, 1080-pipSize-margin), (608-pipSize-margin, 1080-pipSize-margin)

#### Scenario: Corner snap in landscape mode
- **WHEN** PIP is dragged and released in landscape mode
- **THEN** snap positions SHALL use the existing 1920x1080 dimensions (no behavior change)

### Requirement: Default PIP position computed from effective canvas
The default PIP position (used for the first keyframe or when no anchor exists) SHALL be computed as `(effectiveCanvasW - pipSize - margin, effectiveCanvasH - pipSize - margin)` — the bottom-right corner of the effective canvas.

#### Scenario: Default PIP position in reel mode
- **WHEN** a default PIP position is needed in reel mode with `pipScale: 0.35` (pipSize = 213)
- **THEN** defaultPipX SHALL be `608 - 213 - 15` = 380
- **AND** defaultPipY SHALL be `1080 - 213 - 15` = 852

#### Scenario: Default PIP position in landscape mode
- **WHEN** a default PIP position is needed in landscape mode with `pipScale: 0.22` (pipSize = 422)
- **THEN** defaultPipX SHALL be `1920 - 422 - 20` = 1478 (same as current behavior)
- **AND** defaultPipY SHALL be `1080 - 422 - 20` = 638 (same as current behavior)

### Requirement: Camera fullscreen adapts to output mode
When `cameraFullscreen` is true, the camera SHALL fill the output frame dimensions. In reel mode, this means scaling to 608x1080. The camera source (typically 16:9) SHALL be scaled with `force_original_aspect_ratio=increase` then center-cropped to the output dimensions.

#### Scenario: Fullscreen camera in reel mode render
- **WHEN** rendering with `cameraFullscreen: true` and `outputMode: 'reel'`
- **THEN** the camera fullscreen filter SHALL scale to 608x1080 (not 1920x1080)
- **AND** the camera source SHALL be center-cropped to fit the 9:16 frame

#### Scenario: Fullscreen camera in reel mode preview
- **WHEN** the editor preview draws a fullscreen camera in reel mode
- **THEN** the fullscreen camera transition SHALL scale to the reel canvas dimensions (608x1080)
- **AND** the camera SHALL be drawn within the crop region boundaries

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
- **AND** the PIP SHALL NOT be draggable outside the crop region boundaries
