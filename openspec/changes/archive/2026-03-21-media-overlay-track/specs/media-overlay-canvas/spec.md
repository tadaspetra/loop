## ADDED Requirements

### Requirement: Overlay drawn between screen and PIP in z-order

When the playhead is within an overlay segment's time range, the overlay media SHALL be drawn on the editor canvas AFTER the screen recording and BEFORE the PIP camera. Z-order from back to front: screen → overlay → PIP.

#### Scenario: Overlay visible during its time range
- **WHEN** playhead is at 6s and an overlay exists at 5-10s
- **THEN** the overlay image/video frame is drawn on top of the screen recording but behind the PIP camera

#### Scenario: Overlay not visible outside time range
- **WHEN** playhead is at 3s and the nearest overlay starts at 5s
- **THEN** no overlay is drawn on the canvas

### Requirement: Overlay position and size reflect current mode

The overlay SHALL be drawn at the position and size stored in the current output mode's slot. In landscape mode, `overlay.landscape.{x, y, width, height}` is used. In reel mode, `overlay.reel.{x, y, width, height}` is used, offset by the reel crop position.

#### Scenario: Landscape mode overlay positioning
- **WHEN** output mode is landscape and overlay has `landscape: { x: 200, y: 100, width: 500, height: 300 }`
- **THEN** the overlay is drawn at (200, 100) with dimensions 500×300 on the 1920×1080 canvas

#### Scenario: Reel mode overlay positioning
- **WHEN** output mode is reel and overlay has `reel: { x: 50, y: 200, width: 300, height: 200 }`
- **THEN** the overlay is drawn at (50 + cropPixelX, 200) accounting for the reel crop offset

### Requirement: Overlay overflow visualization

When an overlay extends beyond the canvas boundaries, the out-of-bounds portion SHALL be drawn with reduced opacity (alpha 0.3) in the editor. This provides visual feedback that the overflow region will be clipped in the render output.

#### Scenario: Overlay partially off-screen right
- **WHEN** an overlay is positioned at x=1700, width=400 (extends to x=2100, beyond 1920)
- **THEN** the portion from x=1700 to x=1920 is drawn at full opacity, the portion from x=1920 to x=2100 is drawn at alpha 0.3

#### Scenario: Overlay fully within canvas
- **WHEN** an overlay is positioned entirely within 0-1920 horizontally and 0-1080 vertically
- **THEN** the entire overlay is drawn at full opacity

### Requirement: Overlay free-placement drag

When the user clicks on a visible overlay on the canvas (and the overlay's segment is selected in the timeline), mouse drag SHALL move the overlay freely. The overlay position updates in real-time during drag. The position is stored in the current mode's slot (`landscape` or `reel`). `pushUndo()` SHALL be called before the first position change.

#### Scenario: Drag overlay in landscape mode
- **WHEN** a selected overlay is dragged from (200, 100) to (500, 300) in landscape mode
- **THEN** `overlay.landscape.x` = 500, `overlay.landscape.y` = 300

#### Scenario: Drag overlay in reel mode
- **WHEN** a selected overlay is dragged in reel mode
- **THEN** `overlay.reel.x` and `overlay.reel.y` are updated (reel coordinates, relative to crop region)

#### Scenario: Drag overlay beyond canvas boundary
- **WHEN** the user drags an overlay to x=-50
- **THEN** the position is accepted (no clamping). The overflow portion is shown at reduced opacity.

### Requirement: Overlay corner resize with aspect ratio lock

When the user clicks near a corner of a visible selected overlay (within 20px hit area), mouse drag SHALL resize the overlay from that corner while maintaining the original aspect ratio. The opposite corner stays anchored. `pushUndo()` SHALL be called before the first size change. Minimum size SHALL be 50×50 pixels.

#### Scenario: Resize overlay from bottom-right corner
- **WHEN** the user drags the bottom-right corner of a 400×300 overlay outward by 100px horizontally
- **THEN** width becomes 500, height becomes 375 (maintaining 4:3 aspect ratio)

#### Scenario: Resize overlay below minimum
- **WHEN** the user drags a corner inward making the overlay smaller than 50px
- **THEN** the overlay size is clamped to minimum 50px on the smaller dimension (aspect ratio maintained)

### Requirement: Overlay hit-testing priority

When the user clicks on the editor canvas, hit-testing SHALL check overlay bounds BEFORE PIP bounds. If the click lands on both an overlay and the PIP, the overlay interaction takes priority. Only the currently-selected overlay segment's corresponding canvas region responds to drag/resize.

#### Scenario: Click on overlapping overlay and PIP
- **WHEN** an overlay and PIP occupy the same canvas area and the user clicks that area
- **THEN** the overlay drag interaction starts (not PIP drag)

#### Scenario: Click on overlay that is not selected
- **WHEN** the user clicks on an overlay's canvas region but that overlay segment is not selected in the timeline
- **THEN** the click does NOT start overlay drag (falls through to PIP or background interaction)

### Requirement: Per-mode overlay position persistence

When the user switches output mode (landscape ↔ reel), each overlay segment's position/size for the previous mode SHALL be preserved. The overlay is drawn at the new mode's stored position. If a mode slot has never been set, the default position (from creation) is used.

#### Scenario: Switch from landscape to reel
- **WHEN** an overlay has been positioned at (200, 100) in landscape and the user switches to reel
- **THEN** the overlay is drawn at its reel position (which may differ), and `landscape: { x: 200, y: 100, ... }` is preserved

#### Scenario: First switch to reel mode
- **WHEN** an overlay was created in landscape mode and the user switches to reel for the first time
- **THEN** the overlay uses its reel default position (set at creation time)
