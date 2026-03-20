## ADDED Requirements

### Requirement: Image overlay display at playhead

When the playhead is within an image overlay's time range `[startTime, endTime]`, the system SHALL draw the image on the editor canvas at the overlay's current-mode position and size. The image SHALL be loaded once and cached for the duration of the editor session.

#### Scenario: Playhead enters image overlay range
- **WHEN** the playhead moves from 4s to 6s and an image overlay exists at 5-10s
- **THEN** the image appears on the canvas at the overlay's position/size

#### Scenario: Playhead exits image overlay range
- **WHEN** the playhead moves from 9s to 11s and an image overlay exists at 5-10s
- **THEN** the image disappears from the canvas

### Requirement: Video overlay playback sync

When the playhead is within a video overlay's time range, the system SHALL display the video frame corresponding to `sourceStart + (playheadTime - startTime)`. A single reusable `<video>` element SHALL be used for overlay video playback.

#### Scenario: Seek into video overlay
- **WHEN** the user seeks to 7s and a video overlay exists at 5-12s with sourceStart=2
- **THEN** the overlay video displays the frame at source time 4s (2 + (7-5))

#### Scenario: Playback through video overlay
- **WHEN** playback is running and enters a video overlay at startTime=5, sourceStart=0
- **THEN** the overlay video starts playing from source time 0s, advancing in sync with the timeline

#### Scenario: Video overlay source time boundary
- **WHEN** the overlay video reaches sourceEnd during playback
- **THEN** the video frame freezes at the last frame (does not loop)

### Requirement: Overlay fade transitions

Overlays SHALL fade in over `TRANSITION_DURATION` (0.3s) at their `startTime` and fade out over `TRANSITION_DURATION` at their `endTime`. The fade is an opacity transition from 0→1 (in) and 1→0 (out).

#### Scenario: Overlay fade in
- **WHEN** playhead is at `startTime + 0.15s` (halfway through transition)
- **THEN** the overlay is drawn at approximately 50% opacity

#### Scenario: Overlay fully visible
- **WHEN** playhead is at `startTime + 0.5s` (well past transition)
- **THEN** the overlay is drawn at 100% opacity

#### Scenario: Overlay fade out
- **WHEN** playhead is at `endTime - 0.1s` (within exit transition)
- **THEN** the overlay is drawn at approximately 33% opacity

### Requirement: Position interpolation between consecutive same-media segments

When two adjacent overlay segments reference the same `mediaPath` and the time gap between them is 0 (end of first = start of second), the system SHALL interpolate position and size over `TRANSITION_DURATION` (0.3s) before the boundary — identical to PIP keyframe interpolation.

#### Scenario: Smooth position transition between split segments
- **WHEN** segment A (5-10s, position 100,100) and segment B (10-15s, position 500,300) share the same mediaPath
- **THEN** at time 9.85s (0.15s before boundary), the overlay position is interpolated 50% between A and B: approximately (300, 200)

#### Scenario: No interpolation for different media
- **WHEN** segment A (5-10s, image1.png) and segment B (10-15s, image2.png) are adjacent
- **THEN** segment A fades out at 10s and segment B fades in at 10s (no position interpolation)

### Requirement: Overlay state computation function

The system SHALL provide a function `getOverlayStateAtTime(time, overlays, outputMode)` that returns the current overlay state: `{ active: boolean, overlayId, mediaPath, mediaType, x, y, width, height, opacity, sourceTime }`. This function handles fade transitions, position interpolation between same-media segments, and mode-specific positioning.

#### Scenario: No overlay active
- **WHEN** no overlay covers the given time
- **THEN** the function returns `{ active: false }`

#### Scenario: Overlay active with fade-in
- **WHEN** time is within the fade-in window of an overlay
- **THEN** the function returns `active: true` with `opacity` between 0 and 1

#### Scenario: Overlay active at full opacity
- **WHEN** time is well within an overlay's range (past fade-in, before fade-out)
- **THEN** the function returns `active: true` with `opacity: 1`, and position/size from the current mode's slot
