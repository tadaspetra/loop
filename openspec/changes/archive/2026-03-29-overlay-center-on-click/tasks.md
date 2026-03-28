## 1. Core Implementation

- [x] 1.1 Add a `centerSelectedOverlay()` function in `src/renderer/app.ts` that: gets the selected overlay from `editorState`, determines the active mode (landscape/reel), computes centered x/y (`Math.round((canvasW - pos.width) / 2)`, `Math.round((canvasH - pos.height) / 2)`), pushes undo, updates the position, and triggers a project save
- [x] 1.2 Add a click-detection mousedown/mouseup listener on `editorOverlaySizeScrub` that tracks horizontal displacement and calls `centerSelectedOverlay()` if displacement < 3px on mouseup

## 2. Verification

- [x] 2.1 Run `npm run check` and ensure all pass
- [x] 2.2 Manual smoke test: select an overlay, click "Size" label, verify overlay centers; drag "Size" label, verify resize still works; undo after center, verify position restores
