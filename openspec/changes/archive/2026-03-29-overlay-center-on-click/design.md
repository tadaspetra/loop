## Context

The overlay size control in the editor action bar (`#editorOverlaySizeControl`) contains two drag-target elements:
- `#editorOverlaySizeScrub` — the "Size" text label
- `#editorOverlaySizeValue` — the percentage value (e.g., "100%")

Both are wired through `initScrubDrag()` (app.ts ~line 5961) which attaches mousedown → mousemove → mouseup listeners for horizontal drag-to-resize. The "Size" label will gain an additional click-to-center behavior.

The overlay position is stored per-mode on the `Overlay` object:
- `overlay.landscape: OverlayPosition` — `{ x, y, width, height }` in 1920x1080 canvas space
- `overlay.reel: OverlayPosition` — `{ x, y, width, height }` in 609x1080 canvas space

Centering means setting `x = (canvasW - width) / 2` and `y = (canvasH - height) / 2` for the active mode.

## Goals / Non-Goals

**Goals:**
- Click the "Size" label to center the selected overlay in the current output mode
- Preserve existing drag-to-resize behavior on both the label and value elements
- Support undo for the centering action

**Non-Goals:**
- Centering via keyboard shortcut
- Centering both modes simultaneously (only the active mode is affected)
- Auto-centering on overlay import (separate feature if needed)
- Adding a dedicated "Center" button to the UI

## Decisions

### 1. Click detection via mouse movement threshold

**Decision**: Track total mouse displacement during the mousedown → mouseup cycle. If displacement is < 3px, treat it as a click. Otherwise, it's a drag (existing behavior).

**Rationale**: This is the standard web pattern for distinguishing click from drag on an element that supports both. A 3px threshold accounts for minor hand movement during a click without interfering with intentional drags.

**Implementation**: Add click detection only to `editorOverlaySizeScrub` (the "Size" label). The `editorOverlaySizeValue` (percentage text) remains drag-only — no click action. This is done by adding a dedicated mousedown/mouseup listener on the label element rather than modifying `initScrubDrag`.

### 2. Center only the active mode's position

**Decision**: When centering, only modify `overlay[mode]` where mode is the current `editorState.outputMode`. The other mode's position is untouched.

**Rationale**: Consistent with how the size drag already works — it only modifies the active mode's position (app.ts line 6049). Users may have intentionally positioned the overlay differently in each mode.

### 3. Center computation

**Decision**:
```
canvasW = mode === 'reel' ? REEL_CANVAS_W : CANVAS_W
canvasH = CANVAS_H  (1080 for both modes)
pos.x = Math.round((canvasW - pos.width) / 2)
pos.y = Math.round((canvasH - pos.height) / 2)
```

Uses `Math.round` for pixel-perfect positioning, consistent with the existing size handler (app.ts line 6057).

## Risks / Trade-offs

**[Risk] Accidental centering during intended drag** → Mitigated by the 3px movement threshold. In practice, even a slight drag intention produces > 3px movement.

**[Trade-off] Only "Size" label centers, not the value** → Keeps a clean mental model: label = action button, value = drag handle. Could confuse users who expect both to behave identically, but the label is the more natural click target.
