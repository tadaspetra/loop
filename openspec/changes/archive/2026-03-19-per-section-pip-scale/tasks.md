## 1. Domain Model (src/shared/domain/project.js)

- [x] 1.1 Add `pipScale` to `normalizeKeyframes()`: normalize using `normalizePipScale()`, default to `DEFAULT_PIP_SCALE` (0.22)
- [x] 1.2 Add unit tests for keyframe `pipScale` normalization (valid, clamped, default fallback)

## 2. Editor Logic — Per-Section pipScale (src/renderer/app.js)

- [x] 2.1 Add `pipScale` to the default keyframe fallback in `getSectionAnchorKeyframe()`
- [x] 2.2 Add `pipScale` to `syncSectionAnchorKeyframes()` so it's synced to each section's anchor
- [x] 2.3 Add `pipScale` to `applyStyleToFutureSections()` so "Apply to Future" copies it
- [x] 2.4 Add `pipScale` to `buildSplitAnchorKeyframe()` in `keyframe-ops.js`
- [x] 2.5 Add `pipScale` to `getStateAtTime()`: include in default, interpolate during transitions, include in return object
- [x] 2.6 Compute `pipSize` from interpolated `pipScale` in the draw loop (replacing the global `editorState.pipSize`)

## 3. Editor UI — PIP Size Slider (src/renderer/app.js)

- [x] 3.1 Change PIP Size slider input handler to read/write the current section's anchor `pipScale` (instead of `editorState.pipScale`)
- [x] 3.2 Update slider display on section change: read `pipScale` from current section anchor and update slider value/label
- [x] 3.3 Re-snap PIP position when pipScale changes on a section (snap to nearest corner with new size)

## 4. Editor — Keyframe & Render Data (src/renderer/app.js)

- [x] 4.1 Add `pipScale` to `getRenderKeyframes()` minimal keyframe output
- [x] 4.2 Add `pipScale` to `getRenderSections()` section output
- [x] 4.3 Add `pipScale` to `getProjectTimelineSnapshot()` keyframe serialization

## 5. FFmpeg Render Pipeline (src/main/services/render-filter-service.js)

- [x] 5.1 Modify `buildFilterComplex()` to accept per-keyframe `pipScale` and compute animated PIP size expressions
- [x] 5.2 Build animated scale, corner radius, position, and alpha expressions using `pipScale` from keyframes
- [x] 5.3 Handle static case (all keyframes same pipScale): use fixed PIP size (no expression overhead)
- [x] 5.4 Add unit tests for animated PIP size in buildFilterComplex

## 6. Render Service (src/main/services/render-service.js)

- [x] 6.1 Pass per-keyframe `pipScale` through to `buildFilterComplex()` (already in keyframes array)
- [x] 6.2 Remove or deprecate the global `pipSize` parameter (use keyframe values instead)

## 7. Backward Compatibility

- [x] 7.1 When loading keyframes without `pipScale`, default to `settings.pipScale` (or 0.22)
- [x] 7.2 Ensure `enterEditor()` initialization seeds keyframe `pipScale` from project settings for legacy data

## 8. Verification

- [x] 8.1 Run `npm run check` — all tests pass, lint clean, typecheck clean
- [ ] 8.2 Manual test: adjust PIP size on one section, verify other sections unaffected
- [ ] 8.3 Manual test: transition between sections with different PIP sizes — smooth animation
- [ ] 8.4 Manual test: render video with varying PIP sizes — output matches editor
- [ ] 8.5 Manual test: load old project — PIP size defaults correctly across all sections
