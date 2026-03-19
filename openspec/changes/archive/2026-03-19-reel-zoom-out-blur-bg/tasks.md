## 1. Domain Model (src/shared/domain/project.js)

- [x] 1.1 Add `MIN_REEL_BACKGROUND_ZOOM = 0.5` constant and export it
- [x] 1.2 Extend `normalizeBackgroundZoom` to accept an optional `outputMode` parameter: when `'reel'`, clamp to [0.5, 3]; otherwise keep [1, 3]
- [x] 1.3 Add unit tests for `normalizeBackgroundZoom` with reel mode: 0.5 returns 0.5, 0.3 returns 0.5, 0.7 returns 0.7, null returns 0.5

## 2. Editor Logic — Zoom Range (src/renderer/app.js)

- [x] 2.1 Make `clampSectionZoom()` mode-aware: use min 0.5 when `editorState.outputMode === 'reel'`, otherwise min 1.0
- [x] 2.2 Update `updateOutputModeUI()` to set zoom slider `min` attribute to `0.5` in reel mode, `1` in landscape mode
- [x] 2.3 Update `setOutputMode()`: when switching from reel to landscape, clamp all keyframe `backgroundZoom` values below 1.0 up to 1.0
- [x] 2.4 Update zoom slider display format to show values < 1 properly (e.g. `0.70x`)

## 3. Editor Preview — Zoom-Out Drawing (src/renderer/app.js)

- [x] 3.1 Modify `drawEditorScreenWithZoom()` to handle zoom < 1 in reel mode: draw black fill, then darkened scaled-to-fill content at ~20% opacity, then sharp zoomed-out content centered vertically
- [x] 3.2 In the reel crop overlay section of `editorDrawLoop()`, ensure the darkened background is drawn within the crop region bounds (not outside it)
- [x] 3.3 Ensure pan values are visually ignored when zoom < 1 (content always centered)

## 4. FFmpeg Render Pipeline (src/main/services/render-filter-service.js)

- [x] 4.1 Modify `buildScreenFilter()`: when reel mode and any keyframe has zoom < 1, build a split/overlay pipeline — one branch darkened fill, one branch sharp content, composited together
- [x] 4.2 Handle animated zoom that crosses the 1.0 boundary: the darkened background should fade based on zoom level expression
- [x] 4.3 Handle static zoom < 1 case (no animation): simpler filter with fixed scale + overlay
- [x] 4.4 Ensure zoom >= 1 in reel mode is completely unchanged (backward compatibility)

## 5. Render Filter Tests (tests/unit/render-filter-service.test.js)

- [x] 5.1 Add test: `buildScreenFilter` with reel mode and static zoom 0.7 produces split/overlay filter with darkened fill
- [x] 5.2 Add test: `buildScreenFilter` with reel mode and animated zoom crossing 1.0 produces correct expressions
- [x] 5.3 Add test: `buildScreenFilter` with reel mode and zoom >= 1 remains unchanged
- [x] 5.4 Add test: `resolveOutputSize` behavior unchanged

## 6. Domain Model Tests (tests/unit/project-domain.test.js)

- [x] 6.1 Add tests for `normalizeBackgroundZoom` with reel outputMode parameter
- [x] 6.2 Add tests verifying backward compatibility: calls without outputMode unchanged

## 7. Verification

- [x] 7.1 Run `npm run check` — all tests pass, lint clean, typecheck clean
- [ ] 7.2 Manual test: in reel mode, drag zoom slider below 1.0 — content shrinks with dark background fill
- [ ] 7.3 Manual test: render a reel video with zoom-out sections — output shows darkened background
- [ ] 7.4 Manual test: switch from reel with zoom 0.7 to landscape — zoom snaps to 1.0
- [ ] 7.5 Manual test: landscape mode and reel mode with zoom >= 1 completely unaffected
