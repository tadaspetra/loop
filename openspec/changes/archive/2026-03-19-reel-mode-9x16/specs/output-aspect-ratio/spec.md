## ADDED Requirements

### Requirement: Project output mode setting
The system SHALL support an `outputMode` project setting with two values: `'landscape'` (16:9) and `'reel'` (9:16). The default value SHALL be `'landscape'`. This setting is stored in `project.settings.outputMode` and persisted with the project JSON.

#### Scenario: Default output mode for new projects
- **WHEN** a new project is created via `createDefaultProject()`
- **THEN** the project's `settings.outputMode` SHALL be `'landscape'`

#### Scenario: Normalizing invalid output mode values
- **WHEN** project data is loaded with an invalid or missing `outputMode` value (undefined, null, empty string, arbitrary string)
- **THEN** `normalizeOutputMode()` SHALL return `'landscape'`

#### Scenario: Normalizing valid reel mode
- **WHEN** project data is loaded with `outputMode` set to `'reel'`
- **THEN** `normalizeOutputMode()` SHALL return `'reel'`

#### Scenario: Persisting output mode
- **WHEN** the user changes the output mode and the project is saved
- **THEN** the `outputMode` value SHALL be included in the serialized project settings JSON
- **AND** loading the project SHALL restore the same `outputMode` value

### Requirement: Output mode toggle UI
The editor controls SHALL include a toggle button group allowing the user to switch between 16:9 (landscape) and 9:16 (reel) output modes. The toggle SHALL be placed in the editor playback controls bar alongside existing controls.

#### Scenario: Toggling to reel mode
- **WHEN** the user clicks the 9:16 toggle button
- **THEN** the editor SHALL set `outputMode` to `'reel'`
- **AND** the crop overlay SHALL appear on the preview canvas
- **AND** the PIP size SHALL be recalculated for the narrower canvas
- **AND** a project save SHALL be scheduled

#### Scenario: Toggling to landscape mode
- **WHEN** the user clicks the 16:9 toggle button while in reel mode
- **THEN** the editor SHALL set `outputMode` to `'landscape'`
- **AND** the crop overlay SHALL disappear
- **AND** existing `reelCropX` keyframe values SHALL be preserved (not deleted)
- **AND** a project save SHALL be scheduled

#### Scenario: Toggle is undoable
- **WHEN** the user toggles the output mode
- **THEN** the change SHALL be pushed to the undo stack
- **AND** pressing undo SHALL restore the previous output mode

### Requirement: Output resolution for reel mode
When `outputMode` is `'reel'`, the `resolveOutputSize()` function SHALL return dimensions in 9:16 aspect ratio, calculated as: `outW = round(sourceHeight * 9 / 16)` (ensured even), `outH = sourceHeight` (ensured even).

#### Scenario: Reel mode output dimensions for 1920x1080 source
- **WHEN** `resolveOutputSize(1920, 1080, 'reel')` is called
- **THEN** it SHALL return `{ outW: 608, outH: 1080 }` (note: 1080 * 9/16 = 607.5, rounded to 608, already even)

#### Scenario: Reel mode output dimensions for 2560x1440 source
- **WHEN** `resolveOutputSize(2560, 1440, 'reel')` is called
- **THEN** it SHALL return `{ outW: 810, outH: 1440 }` (1440 * 9/16 = 810, already even)

#### Scenario: Landscape mode output dimensions unchanged
- **WHEN** `resolveOutputSize(1920, 1080, 'landscape')` is called
- **THEN** it SHALL return `{ outW: 1920, outH: 1080 }` (existing behavior, no regression)

#### Scenario: Default mode is landscape
- **WHEN** `resolveOutputSize(1920, 1080)` is called without an `outputMode` parameter
- **THEN** it SHALL return landscape dimensions (backward compatible)

### Requirement: Render pipeline passes output mode
The `renderComposite()` function SHALL accept `outputMode` in its options and pass it through to `buildFilterComplex()` and `buildScreenFilter()`. The ffmpeg output SHALL match the dimensions returned by `resolveOutputSize()` for the given mode.

#### Scenario: Rendering in reel mode
- **WHEN** `renderComposite()` is called with `outputMode: 'reel'` and source dimensions 1920x1080
- **THEN** the output MP4 SHALL have dimensions 608x1080

#### Scenario: Rendering in landscape mode
- **WHEN** `renderComposite()` is called with `outputMode: 'landscape'` (or no outputMode)
- **THEN** the output MP4 SHALL have dimensions matching the existing 16:9 behavior

#### Scenario: Camera black fallback uses correct dimensions
- **WHEN** a section has no camera and `outputMode` is `'reel'`
- **THEN** the black color fallback filter SHALL use reel dimensions (608x1080), not 1920x1080
