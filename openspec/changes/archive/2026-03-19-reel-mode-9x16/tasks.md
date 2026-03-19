## 1. Domain Model (src/shared/domain/project.js)

- [x] 1.1 Add `normalizeReelCropX()` function (clamp to [-1, 1], default 0), export constants `MIN_REEL_CROP_X`, `MAX_REEL_CROP_X`
- [x] 1.2 Add `normalizeOutputMode()` function (return `'landscape'` or `'reel'`), export constants `OUTPUT_MODE_LANDSCAPE`, `OUTPUT_MODE_REEL`
- [x] 1.3 Add `normalizePipScale()` function (clamp to [0.15, 0.50], default 0.22), export constants `MIN_PIP_SCALE`, `MAX_PIP_SCALE`, `DEFAULT_PIP_SCALE`
- [x] 1.4 Extend `normalizeKeyframes()` to include `reelCropX` property on each keyframe
- [x] 1.5 Extend `createDefaultProject()` to include `outputMode: 'landscape'` and `pipScale: 0.22` in settings
- [x] 1.6 Extend `normalizeProjectData()` to hydrate `outputMode` and `pipScale` in settings

## 2. Domain Model Unit Tests (tests/unit/project-domain.test.js)

- [x] 2.1 Add tests for `normalizeReelCropX`: valid values, out-of-range clamping, invalid input defaults to 0
- [x] 2.2 Add tests for `normalizeOutputMode`: `'reel'` returns `'reel'`, invalid/missing returns `'landscape'`
- [x] 2.3 Add tests for `normalizePipScale`: valid values, clamping, invalid defaults to 0.22
- [x] 2.4 Add tests for `normalizeKeyframes` including `reelCropX` preservation
- [x] 2.5 Add tests for `createDefaultProject` including `outputMode` and `pipScale` in settings
- [x] 2.6 Add tests for `normalizeProjectData` hydrating `outputMode` and `pipScale`

## 3. Render Filter Service (src/main/services/render-filter-service.js)

- [x] 3.1 Modify `resolveOutputSize()` to accept `outputMode` parameter and return 9:16 dimensions for `'reel'`
- [x] 3.2 Modify `buildScreenFilter()` to accept `outputMode` parameter; when `'reel'`, append `crop=REEL_W:REEL_H:X_EXPR:0` filter after zoompan using `buildNumericExpr()` for animated `reelCropX`
- [x] 3.3 Modify `buildFilterComplex()` to accept `outputMode` parameter and pass through to `resolveOutputSize()` and `buildScreenFilter()`; PIP scaling uses reel output dimensions automatically

## 4. Render Filter Service Unit Tests (tests/unit/render-filter-service.test.js)

- [x] 4.1 Add tests for `resolveOutputSize()` with `'reel'` mode: 1920x1080 → 608x1080, 2560x1440 → 810x1440
- [x] 4.2 Add tests for `resolveOutputSize()` backward compatibility: no `outputMode` param returns landscape dimensions
- [x] 4.3 Add tests for `buildScreenFilter()` with reel mode: output contains `crop=608:1080` in filter string
- [x] 4.4 Add tests for `buildScreenFilter()` with reel mode and animated `reelCropX`: filter contains interpolation expression
- [x] 4.5 Add tests for `buildFilterComplex()` with reel mode: correct output dimensions in filter, PIP scaling correct

## 5. Render Service (src/main/services/render-service.js)

- [x] 5.1 Import `normalizeReelCropX` and `normalizeOutputMode` from shared domain
- [x] 5.2 Extend `normalizeSectionInput()` to include `reelCropX` field
- [x] 5.3 Extend `renderComposite()` to read `outputMode` from opts and pass to `buildFilterComplex()` and `buildScreenFilter()`
- [x] 5.4 Fix camera black fallback to use reel dimensions when `outputMode === 'reel'` (line 259: `color=black:s=...`)

## 6. Render Service Unit Tests (tests/unit/render-service.test.js)

- [x] 6.1 Add tests for `normalizeSectionInput()` normalizing `reelCropX` on sections
- [x] 6.2 Add tests for `renderComposite()` passing `outputMode` through to filter builders (verify via mock/spy)

## 7. Editor HTML (src/index.html)

- [x] 7.1 Add output mode toggle buttons (16:9 / 9:16) in the editor controls bar after the Zoom control
- [x] 7.2 Add PIP Size slider (`input[type=range]` min=0.15 max=0.50 step=0.01) in the controls bar, visible only when camera is present

## 8. Editor Logic — State & Controls (src/renderer/app.js)

- [x] 8.1 Add reel-mode constants: `REEL_CANVAS_W = Math.round(CANVAS_H * 9 / 16)`, `REEL_CANVAS_H = CANVAS_H`
- [x] 8.2 Add DOM refs for new HTML elements (mode toggle buttons, PIP size slider)
- [x] 8.3 Implement `setOutputMode(mode)`: toggle state, recalculate PIP defaults, re-map PIP positions, snap to corner, push undo, schedule save, update UI
- [x] 8.4 Implement mode toggle button event listeners
- [x] 8.5 Implement `updateOutputModeUI()`: toggle active/inactive button styles, show/hide reel-specific controls
- [x] 8.6 Implement PIP size slider: event handler updates `pipScale` setting, recalculates `pipSize`, updates PIP defaults, pushes undo, schedules save
- [x] 8.7 Modify `snapToNearestCorner()` to accept effective canvas dimensions (or derive from `editorState.outputMode`)

## 9. Editor Logic — Keyframe & Section Integration (src/renderer/app.js)

- [x] 9.1 Extend `getStateAtTime()`: add `reelCropX` to default keyframe, interpolate during transitions, include in return object
- [x] 9.2 Extend `getRenderKeyframes()`: include `reelCropX` in minimal keyframe output
- [x] 9.3 Extend `getRenderSections()`: include `reelCropX` from section anchor keyframe
- [x] 9.4 Extend render call (`renderComposite` invocation): pass `outputMode: editorState.outputMode`
- [x] 9.5 Extend `getSectionAnchorKeyframe()` fallback: include `reelCropX: 0`
- [x] 9.6 Extend `syncSectionAnchorKeyframes()`: include `reelCropX` in synced properties
- [x] 9.7 Extend `applyStyleToFutureSections()`: copy `reelCropX` to future section anchors
- [x] 9.8 Extend `buildSplitAnchorKeyframe()` in `keyframe-ops.js`: include `reelCropX` from parent

## 10. Editor Logic — Preview & Interaction (src/renderer/app.js)

- [x] 10.1 Modify `editorDrawLoop()`: after drawing screen + camera, if reel mode, draw semi-transparent dark overlay outside crop region and dashed crop boundary
- [x] 10.2 Modify `editorDrawLoop()`: in reel mode, offset PIP drawing by crop region's pixel X position (PIP coords are in reel-space, preview is in full canvas space)
- [x] 10.3 Implement crop region drag handling: mousedown detects drag start within crop region, mousemove updates `reelCropX` of active section's anchor keyframe, mouseup finalizes
- [x] 10.4 Modify PIP drag handling: in reel mode, constrain drag to effective canvas dimensions (608x1080) and offset mouse coordinates by crop pixel offset
- [x] 10.5 Modify fullscreen camera preview: in reel mode, scale fullscreen camera transition to reel canvas dimensions

## 11. Editor Logic — Project Persistence (src/renderer/app.js)

- [x] 11.1 Extend `getProjectTimelineSnapshot()`: include `reelCropX` in keyframe serialization
- [x] 11.2 Extend `buildProjectSavePayload()`: include `outputMode` and `pipScale` in settings
- [x] 11.3 Extend editor initialization (`openEditor`/`loadProject`): restore `outputMode` and `pipScale` from loaded project, compute effective canvas dimensions and PIP size

## 12. Verification

- [x] 12.1 Run `npm run check` — all tests pass, lint clean, typecheck clean
- [ ] 12.2 Manual test: record a short clip, switch to 9:16, adjust crop per section, render, verify output is vertical 608x1080 MP4 with smooth crop transitions
- [ ] 12.3 Manual test: verify PIP size slider works in both modes, PIP stays within crop bounds in reel mode
- [ ] 12.4 Manual test: verify toggle 16:9 ↔ 9:16 preserves crop positions and re-maps PIP correctly
- [ ] 12.5 Manual test: verify existing 16:9 workflow is completely unaffected (backward compatibility)
