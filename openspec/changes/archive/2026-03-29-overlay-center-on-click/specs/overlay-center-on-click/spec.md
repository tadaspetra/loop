## ADDED Requirements

### Requirement: Click on Size label centers the selected overlay

When the user clicks (mousedown + mouseup with < 3px total mouse displacement) on the `editorOverlaySizeScrub` element ("Size" label), the system SHALL center the currently selected overlay on the canvas for the active output mode. Centering SHALL set `pos.x = Math.round((canvasW - pos.width) / 2)` and `pos.y = Math.round((canvasH - pos.height) / 2)` where `canvasW` is `REEL_CANVAS_W` (609) for reel mode or `CANVAS_W` (1920) for landscape mode, and `canvasH` is `CANVAS_H` (1080) for both modes.

#### Scenario: Center overlay in landscape mode
- **WHEN** the user clicks the "Size" label with a selected overlay in landscape mode, overlay width=400, height=300
- **THEN** the overlay's landscape position is set to x=760, y=390 (centered in 1920x1080)

#### Scenario: Center overlay in reel mode
- **WHEN** the user clicks the "Size" label with a selected overlay in reel mode, overlay width=200, height=150
- **THEN** the overlay's reel position is set to x=205 (round((609-200)/2)), y=465 (round((1080-150)/2))

#### Scenario: No overlay selected
- **WHEN** the user clicks the "Size" label with no overlay selected
- **THEN** nothing happens (the size control is hidden when no overlay is selected, so this is a no-op guard)

### Requirement: Click vs drag distinction on Size label

The system SHALL distinguish between a click and a drag on the "Size" label using a mouse displacement threshold of 3 pixels. If the total horizontal displacement between mousedown and mouseup is less than 3px, the interaction SHALL be treated as a click (triggering center). If the displacement is 3px or more, the interaction SHALL be treated as a drag (triggering the existing resize behavior).

#### Scenario: Small mouse movement treated as click
- **WHEN** the user presses and releases on the "Size" label with 2px horizontal mouse movement
- **THEN** the overlay is centered (click behavior)

#### Scenario: Significant mouse movement treated as drag
- **WHEN** the user presses on the "Size" label and drags 10px horizontally before releasing
- **THEN** the overlay is resized (drag behavior), not centered

### Requirement: Only the active mode position is centered

Clicking the "Size" label SHALL only modify the overlay position for the currently active output mode (`editorState.outputMode`). The overlay's position in the other mode SHALL remain unchanged.

#### Scenario: Center in landscape preserves reel position
- **WHEN** the user centers an overlay while in landscape mode
- **THEN** `overlay.landscape` is updated to centered coordinates and `overlay.reel` remains unchanged

#### Scenario: Center in reel preserves landscape position
- **WHEN** the user centers an overlay while in reel mode
- **THEN** `overlay.reel` is updated to centered coordinates and `overlay.landscape` remains unchanged

### Requirement: Centering supports undo

Centering an overlay SHALL push an undo snapshot before modifying the position, so the user can undo the centering with Ctrl+Z / Cmd+Z.

#### Scenario: Undo after centering
- **WHEN** the user centers an overlay and then presses Ctrl+Z
- **THEN** the overlay returns to its previous position

### Requirement: Percentage value element remains drag-only

The `editorOverlaySizeValue` element (percentage text) SHALL NOT trigger centering on click. It SHALL continue to function exclusively as a drag handle for resizing.

#### Scenario: Click on percentage value does not center
- **WHEN** the user clicks on the "100%" value text without dragging
- **THEN** no centering occurs; the overlay position remains unchanged
