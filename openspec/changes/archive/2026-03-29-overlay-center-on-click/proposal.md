## Why

When working with media overlays, users frequently want to center an overlay on screen after importing it or repositioning it. Currently, centering requires manually dragging the overlay on the canvas until it looks centered — there's no quick "snap to center" action. The overlay size control in the action bar already has a "Size" label that users interact with, making it a natural place to add a one-click center action.

## What Changes

- **Click on "Size" label centers the selected overlay** on the canvas, relative to the current output mode (landscape 1920x1080 or reel 609x1080). Only the `editorOverlaySizeScrub` label element triggers centering on click; the `editorOverlaySizeValue` percentage text remains a drag-only handle.
- **Click vs drag detection**: The existing `initScrubDrag` handler on the "Size" label must distinguish between a click (mousedown + mouseup with minimal mouse movement) and a drag (mousedown + significant mousemove). Clicks trigger centering; drags continue to resize as before.
- **Both landscape and reel positions are updated** for the active mode only — the overlay's position in the current `outputMode` is centered while the other mode's position is unchanged.
- **Undo support**: Centering pushes an undo snapshot before modifying the overlay position.

## Capabilities

### New Capabilities
- `overlay-center-on-click`: Click the "Size" label in the overlay action bar to auto-center the selected overlay on the canvas for the current output mode.

### Modified Capabilities
<!-- No existing spec requirements change. The size drag behavior is unchanged. -->

## Impact

- **Renderer (`src/renderer/app.ts`)**: Add click detection to the "Size" scrub label's mouseup handler (distinguish click vs drag by checking mouse movement distance). Add a `centerSelectedOverlay()` function that computes centered position for the active output mode.
- **No type changes** — `OverlayPosition` already supports arbitrary x/y values.
- **No IPC changes** — centering is purely a renderer-side operation.
- **No new files** — all changes are in `src/renderer/app.ts`.
