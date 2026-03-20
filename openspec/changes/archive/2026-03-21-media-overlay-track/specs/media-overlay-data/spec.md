## ADDED Requirements

### Requirement: Overlay segment data shape

Each overlay segment SHALL have the following structure:
- `id`: unique string identifier, format `overlay-{timestamp}-{counter}`
- `mediaPath`: project-relative path to the media file (e.g., `overlay-media/image-123.png`)
- `mediaType`: either `'image'` or `'video'`
- `startTime`: number, position on rendered timeline in seconds (>= 0)
- `endTime`: number, end position on rendered timeline in seconds (> startTime)
- `sourceStart`: number, for video — source playback start in seconds (>= 0). For images, SHALL be 0.
- `sourceEnd`: number, for video — source playback end in seconds (> sourceStart). For images, SHALL equal `endTime - startTime`.
- `landscape`: object `{ x, y, width, height }` — position/size in landscape canvas coordinates (1920×1080 space)
- `reel`: object `{ x, y, width, height }` — position/size in reel canvas coordinates (608×1080 space)

All numeric position/size values are pixel values. Values MAY exceed canvas boundaries (overflow is allowed).

#### Scenario: Valid overlay segment
- **WHEN** an overlay segment is created with all required fields and valid values
- **THEN** the segment is accepted and stored in the overlays array

#### Scenario: Overlay with overflow position
- **WHEN** an overlay segment has `landscape.x = -100` (partially off-screen left)
- **THEN** the segment is accepted — negative or oversized coordinates are valid

### Requirement: Overlay segment normalization

The system SHALL provide a `normalizeOverlays(rawOverlays)` function that:
- Returns an empty array for non-array input
- Filters out segments with invalid or missing `id`, `mediaPath`, or `mediaType`
- Clamps `startTime` and `endTime` to non-negative values
- Ensures `endTime > startTime` (removes segments with zero or negative duration)
- Ensures `sourceStart >= 0` and `sourceEnd > sourceStart` for video overlays
- Sets `sourceStart = 0` and `sourceEnd = endTime - startTime` for image overlays
- Validates `landscape` and `reel` objects have numeric `x, y, width, height` (defaults: `{ x: 0, y: 0, width: 400, height: 300 }`)
- Sorts segments by `startTime`
- Removes overlapping segments (later segment is trimmed or discarded)

#### Scenario: Normalize empty input
- **WHEN** `normalizeOverlays(null)` is called
- **THEN** an empty array is returned

#### Scenario: Normalize overlapping segments
- **WHEN** two segments overlap in time (segment A: 2-8s, segment B: 5-12s)
- **THEN** the later segment (B) has its `startTime` adjusted to 8s, or is discarded if that leaves zero duration

#### Scenario: Normalize video segment with missing sourceStart
- **WHEN** a video overlay segment has no `sourceStart` field
- **THEN** `sourceStart` defaults to 0 and `sourceEnd` defaults to `endTime - startTime`

#### Scenario: Normalize image segment sourceStart/sourceEnd
- **WHEN** an image overlay segment is normalized
- **THEN** `sourceStart` is set to 0 and `sourceEnd` is set to `endTime - startTime` regardless of input values

### Requirement: Overlay ID generation

The system SHALL provide a `generateOverlayId()` function that returns a unique string in the format `overlay-{timestamp}-{counter}` where timestamp is `Date.now()` and counter is a monotonically increasing integer. No two calls SHALL return the same ID within a session.

#### Scenario: Generate unique overlay IDs
- **WHEN** `generateOverlayId()` is called twice in rapid succession
- **THEN** two different IDs are returned

### Requirement: No overlay time overlap

The overlays array SHALL NOT contain two segments whose time ranges overlap. When adding or trimming an overlay, the system SHALL enforce that no two segments occupy the same time position.

#### Scenario: Attempt to add overlapping overlay
- **WHEN** the user adds an overlay at 5-10s and an existing overlay occupies 7-12s
- **THEN** the system prevents the overlap (either adjusts timing or rejects the add)

### Requirement: Overlay persistence in project timeline

Overlay segments SHALL be stored in `project.timeline.overlays` and persisted with the project. The `normalizeProjectData` function SHALL normalize the overlays array on project load. The `getProjectTimelineSnapshot` function SHALL include overlays in the saved payload.

#### Scenario: Project save includes overlays
- **WHEN** the project is saved with overlay segments in the editor state
- **THEN** the saved project JSON includes `timeline.overlays` with all overlay segment data

#### Scenario: Project load restores overlays
- **WHEN** a project is loaded that has `timeline.overlays` in its data
- **THEN** `normalizeProjectData` normalizes the overlays and they appear in the editor state

### Requirement: Default overlay position on creation

When an overlay segment is created, its default position SHALL be:
- **Landscape mode**: centered horizontally, centered vertically, width = 40% of 1920 = 768px, height derived from media aspect ratio
- **Reel mode**: centered horizontally within 608px canvas, centered vertically, width = 70% of 608 = 426px, height derived from media aspect ratio
- Both modes' positions are set simultaneously at creation time

#### Scenario: Create overlay with landscape defaults
- **WHEN** an image overlay (800×600 aspect ratio 4:3) is created in landscape mode
- **THEN** `landscape.width` = 768, `landscape.height` = 576, `landscape.x` = (1920-768)/2 = 576, `landscape.y` = (1080-576)/2 = 252
