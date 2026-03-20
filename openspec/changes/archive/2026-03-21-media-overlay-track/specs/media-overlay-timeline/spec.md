## ADDED Requirements

### Requirement: Overlay track rendered above section track

The timeline area SHALL render the overlay track as a distinct row positioned ABOVE the section track. The overlay track SHALL always be visible in the timeline, even when empty (as an empty drop target area).

#### Scenario: Empty overlay track visible
- **WHEN** the editor is active with no overlay segments
- **THEN** an empty overlay track row is visible above the section track in the timeline area

#### Scenario: Overlay track with items
- **WHEN** overlay segments exist at various time positions
- **THEN** colored bands appear in the overlay track at the corresponding timeline positions, visually distinct from section bands

### Requirement: Overlay segment rendering in timeline

Each overlay segment SHALL be rendered as a band in the overlay track, positioned at `(startTime / duration) * 100%` with width `((endTime - startTime) / duration) * 100%`. The band SHALL display:
- A thumbnail or icon indicating the media type (image icon for images, video icon for videos)
- A truncated filename label
- Visual distinction between selected and unselected segments

#### Scenario: Overlay band positioning
- **WHEN** an overlay segment spans 2-8s in a 20s timeline
- **THEN** the band starts at 10% and has width 30% of the track

#### Scenario: Selected overlay visual feedback
- **WHEN** an overlay segment is selected (clicked)
- **THEN** the segment band has a highlighted border/background distinct from unselected segments

### Requirement: Overlay segment selection

Clicking an overlay segment in the timeline SHALL select it, setting `editorState.selectedOverlayId` to the segment's ID. Selecting an overlay SHALL deselect any selected section (dim the section selection). Clicking a section SHALL deselect any selected overlay.

#### Scenario: Select overlay deselects section
- **WHEN** section 2 is selected and the user clicks an overlay segment
- **THEN** `selectedOverlayId` is set to the overlay's ID, the overlay is highlighted, and the section selection is dimmed

#### Scenario: Select section deselects overlay
- **WHEN** an overlay is selected and the user clicks a section in the section track
- **THEN** `selectedOverlayId` is set to null and the section is selected normally

### Requirement: Overlay trim handles

When an overlay segment is selected, trim handles SHALL appear on its left and right edges in the timeline. Dragging a trim handle SHALL adjust the overlay's `startTime` or `endTime`. For video overlays, trimming the left edge SHALL also adjust `sourceStart`, and trimming the right edge SHALL also adjust `sourceEnd`. For image overlays, only `startTime`/`endTime` change.

#### Scenario: Trim overlay right edge
- **WHEN** the user drags the right trim handle of a 5-10s overlay to the 8s position
- **THEN** the overlay's `endTime` becomes 8s. For video overlays, `sourceEnd` is also reduced by 2s.

#### Scenario: Trim overlay left edge for video
- **WHEN** the user drags the left trim handle of a video overlay from 5s to 7s
- **THEN** `startTime` becomes 7s and `sourceStart` increases by 2s (video starts later in source)

#### Scenario: Trim overlay left edge for image
- **WHEN** the user drags the left trim handle of an image overlay from 5s to 7s
- **THEN** `startTime` becomes 7s, `sourceStart` remains 0 (images have no source timeline)

### Requirement: Overlay split at playhead

When an overlay segment is selected and the user triggers split (same button/shortcut as section split), the overlay SHALL be split at the current playhead position into two segments. Both segments reference the same `mediaPath`. Each segment inherits the parent's position/size for both modes. For video overlays, `sourceEnd` of the first segment and `sourceStart` of the second segment are adjusted to the split point in source time.

#### Scenario: Split image overlay
- **WHEN** an image overlay (3-12s) is selected and playhead is at 7s, user triggers split
- **THEN** two segments are created: [3-7s] and [7-12s], both with same mediaPath, same position/size

#### Scenario: Split video overlay
- **WHEN** a video overlay (3-12s, sourceStart=0, sourceEnd=9) is selected and playhead is at 7s
- **THEN** segment 1: [3-7s, sourceStart=0, sourceEnd=4], segment 2: [7-12s, sourceStart=4, sourceEnd=9]

#### Scenario: Split fails when playhead outside overlay
- **WHEN** an overlay (5-10s) is selected but playhead is at 3s
- **THEN** split does nothing (playhead not within overlay time range)

### Requirement: Overlay delete

When an overlay segment is selected and the user triggers delete, the segment SHALL be removed from the overlays array. The associated media file SHALL be staged for deletion only if no other overlay segments reference the same `mediaPath`. Undo SHALL restore the deleted segment.

#### Scenario: Delete overlay with unique media
- **WHEN** the only overlay referencing `overlay-media/img1.png` is deleted
- **THEN** the segment is removed and `img1.png` is staged to `.deleted/`

#### Scenario: Delete overlay with shared media
- **WHEN** an overlay referencing `overlay-media/img1.png` is deleted, but another overlay also references it
- **THEN** the segment is removed but `img1.png` is NOT staged (still referenced)

#### Scenario: Undo overlay delete
- **WHEN** an overlay delete is undone
- **THEN** the segment is restored and the media file is unstaged from `.deleted/` if it was staged

### Requirement: No overlay overlap enforcement

When adding, trimming, or moving an overlay, the system SHALL prevent time overlap with any other overlay segment. If an operation would cause overlap, the system SHALL clamp the values to avoid it.

#### Scenario: Trim right edge into next overlay
- **WHEN** overlay A ends at 8s, overlay B starts at 10s, and the user drags A's right edge to 11s
- **THEN** A's endTime is clamped to 10s (cannot overlap B)
