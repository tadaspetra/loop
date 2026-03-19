## ADDED Requirements

### Requirement: reelCropX keyframe property
The keyframe data model SHALL include a `reelCropX` property representing the horizontal position of the 9:16 crop region within the 16:9 source frame. The value range SHALL be -1.0 (left edge) to +1.0 (right edge), with 0.0 representing center. The default value SHALL be 0.

#### Scenario: Normalizing valid reelCropX values
- **WHEN** a keyframe is normalized with `reelCropX` set to a number within [-1, 1]
- **THEN** `normalizeReelCropX()` SHALL return the value unchanged

#### Scenario: Normalizing out-of-range reelCropX
- **WHEN** a keyframe is normalized with `reelCropX` set to -2.5
- **THEN** `normalizeReelCropX()` SHALL return -1 (clamped to minimum)

#### Scenario: Normalizing out-of-range positive reelCropX
- **WHEN** a keyframe is normalized with `reelCropX` set to 3.0
- **THEN** `normalizeReelCropX()` SHALL return 1 (clamped to maximum)

#### Scenario: Normalizing missing reelCropX
- **WHEN** a keyframe is normalized with `reelCropX` set to undefined, null, NaN, or a non-numeric string
- **THEN** `normalizeReelCropX()` SHALL return 0 (default center)

#### Scenario: reelCropX included in normalized keyframes
- **WHEN** `normalizeKeyframes()` processes an array of raw keyframes
- **THEN** each output keyframe SHALL include a normalized `reelCropX` property

### Requirement: reelCropX in section input normalization
The `normalizeSectionInput()` function in render-service SHALL normalize `reelCropX` on each section alongside existing `backgroundZoom`, `backgroundPanX`, `backgroundPanY`.

#### Scenario: Section with reelCropX
- **WHEN** a section with `reelCropX: 0.5` is normalized
- **THEN** the output section SHALL include `reelCropX: 0.5`

#### Scenario: Section without reelCropX
- **WHEN** a section without `reelCropX` is normalized
- **THEN** the output section SHALL include `reelCropX: 0` (default)

### Requirement: Crop overlay in editor preview
When `outputMode` is `'reel'`, the editor preview canvas SHALL display a crop overlay consisting of:
1. Semi-transparent dark rectangles covering the area outside the 9:16 crop region (left and right of crop)
2. A dashed white border around the crop region boundary

The crop region width SHALL be `round(CANVAS_H * 9 / 16)` = 608 pixels within the 1920x1080 canvas. The crop region height SHALL be the full canvas height (1080).

#### Scenario: Crop overlay visible in reel mode
- **WHEN** the editor is in reel mode (`outputMode === 'reel'`)
- **THEN** the editor preview SHALL show semi-transparent dark areas outside the 9:16 crop region
- **AND** a dashed white rectangle SHALL outline the crop boundary

#### Scenario: Crop overlay hidden in landscape mode
- **WHEN** the editor is in landscape mode (`outputMode === 'landscape'`)
- **THEN** no crop overlay SHALL be drawn on the preview canvas

#### Scenario: Crop overlay reflects current reelCropX
- **WHEN** the current section's `reelCropX` is -1 (left edge)
- **THEN** the crop region SHALL be positioned at the left edge of the canvas
- **AND** only the right side SHALL have a dark overlay

#### Scenario: Crop overlay updates during playback transitions
- **WHEN** the timeline plays across a keyframe boundary where `reelCropX` changes
- **THEN** the crop overlay SHALL smoothly animate to the new position using the same 0.3s transition duration as other keyframe properties

### Requirement: Draggable crop region
In reel mode, the user SHALL be able to drag the crop region horizontally on the editor preview canvas to reposition it. Dragging SHALL update the `reelCropX` property of the current section's anchor keyframe.

#### Scenario: Dragging crop region
- **WHEN** the user clicks inside the crop region and drags horizontally
- **THEN** the crop region SHALL follow the mouse movement horizontally
- **AND** the active section's anchor keyframe `reelCropX` SHALL be updated to reflect the new position
- **AND** the value SHALL be clamped to the [-1, 1] range

#### Scenario: Drag push to undo stack
- **WHEN** the user begins dragging the crop region
- **THEN** the state before the drag SHALL be pushed to the undo stack

#### Scenario: Drag does not work in landscape mode
- **WHEN** the editor is in landscape mode
- **THEN** horizontal drag on the preview canvas SHALL NOT trigger crop region movement

### Requirement: Smooth animated crop transitions during rendering
When keyframes have different `reelCropX` values, the ffmpeg render pipeline SHALL produce smooth animated transitions between crop positions using the same 0.3s `TRANSITION_DURATION` as other keyframe properties.

#### Scenario: Animated crop in ffmpeg filter
- **WHEN** two consecutive keyframes have `reelCropX` values of -0.5 and 0.5
- **THEN** the ffmpeg filter chain SHALL include a `crop` filter with a dynamic X expression built by `buildNumericExpr()` that interpolates between the corresponding pixel offsets over the 0.3s transition window

#### Scenario: Static crop position
- **WHEN** all keyframes have the same `reelCropX` value of 0
- **THEN** the ffmpeg crop filter SHALL use a static X offset (no interpolation needed)

#### Scenario: Crop filter placement in pipeline
- **WHEN** the render pipeline builds the screen filter for reel mode
- **THEN** the crop filter SHALL be placed AFTER the zoompan filter (or after the base scale if no zoom animation exists)
- **AND** the crop SHALL output at `REEL_W x REEL_H` resolution

### Requirement: Smooth animated crop transitions in editor preview
The `getStateAtTime()` function SHALL interpolate `reelCropX` between keyframes using the same transition logic as other properties (linear blend over 0.3s when approaching the next keyframe).

#### Scenario: Preview interpolation of reelCropX
- **WHEN** the playhead is within 0.3s before a keyframe that changes `reelCropX`
- **THEN** `getStateAtTime()` SHALL return an interpolated `reelCropX` value blending between the current and next keyframe values

#### Scenario: No transition when values match
- **WHEN** adjacent keyframes have the same `reelCropX` value
- **THEN** no interpolation SHALL occur for `reelCropX`

### Requirement: reelCropX in render keyframes and sections
The `getRenderKeyframes()` and `getRenderSections()` functions SHALL include `reelCropX` in their output, alongside existing `backgroundZoom`, `backgroundPanX`, `backgroundPanY`.

#### Scenario: Render keyframes include reelCropX
- **WHEN** `getRenderKeyframes()` is called
- **THEN** each keyframe in the output SHALL include a `reelCropX` property clamped to [-1, 1]

#### Scenario: Render sections include reelCropX
- **WHEN** `getRenderSections()` is called
- **THEN** each section in the output SHALL include a `reelCropX` property from its anchor keyframe

### Requirement: reelCropX propagation in section operations
Section operations that copy or create keyframe properties SHALL include `reelCropX`:

#### Scenario: Section split inherits reelCropX
- **WHEN** a section is split at the playhead
- **THEN** the new section's anchor keyframe SHALL inherit `reelCropX` from the parent section's anchor

#### Scenario: Apply to future copies reelCropX
- **WHEN** the user clicks "Apply to Future"
- **THEN** all future sections' anchor keyframes SHALL receive the current section's `reelCropX` value

#### Scenario: Default anchor keyframe includes reelCropX
- **WHEN** a new section anchor keyframe is created as a fallback (no existing anchor)
- **THEN** it SHALL include `reelCropX: 0` (center default)

### Requirement: Crop pixel offset calculation
The conversion from `reelCropX` (-1 to +1) to pixel X offset SHALL follow the formula: `pixelOffset = ((reelCropX + 1) / 2) * (sourceWidth - cropWidth)`, clamped to `[0, sourceWidth - cropWidth]`.

#### Scenario: Center crop calculation
- **WHEN** `reelCropX` is 0 and source is 1920px wide with 608px crop
- **THEN** pixel offset SHALL be `((0 + 1) / 2) * (1920 - 608)` = 656

#### Scenario: Left edge crop calculation
- **WHEN** `reelCropX` is -1
- **THEN** pixel offset SHALL be `((-1 + 1) / 2) * (1920 - 608)` = 0

#### Scenario: Right edge crop calculation
- **WHEN** `reelCropX` is 1
- **THEN** pixel offset SHALL be `((1 + 1) / 2) * (1920 - 608)` = 1312

### Requirement: reelCropX persisted in project save
The `reelCropX` property SHALL be included in keyframe serialization via `getProjectTimelineSnapshot()` and round-tripped through `normalizeKeyframes()` on load.

#### Scenario: Save and reload preserves reelCropX
- **WHEN** a project with keyframes containing `reelCropX: 0.75` is saved and reloaded
- **THEN** the loaded keyframes SHALL contain `reelCropX: 0.75`
