## Why

PIP (camera overlay) size is currently a global project setting — every section uses the same `pipScale`. Users need the ability to vary PIP size per section, exactly like they already control zoom, pan, and crop position per section. This enables emphasizing the speaker in some sections and shrinking the overlay in others.

## What Changes

- Move `pipScale` from a global project setting to a per-keyframe property on section anchor keyframes
- Add `pipScale` to keyframe interpolation so transitions between sections animate the PIP size smoothly (0.3s linear, same as other properties)
- The existing PIP Size slider in the editor now controls the current section's `pipScale` (same pattern as the zoom slider)
- "Apply to Future Sections" copies `pipScale` along with other section properties
- The FFmpeg render pipeline receives per-section `pipScale` and builds animated PIP size expressions
- PIP position auto-snaps to nearest corner when `pipScale` changes (existing behavior preserved)

## Capabilities

### New Capabilities
- `per-section-pip-scale`: Per-section PIP sizing with interpolated transitions and render pipeline support

### Modified Capabilities

## Impact

- `src/shared/domain/project.js` — Add `pipScale` to keyframe normalization, remove from project settings (or keep as default)
- `src/renderer/app.js` — Move pipScale to keyframe anchors, update slider to control per-section value, interpolate in `getStateAtTime()`, re-snap PIP on size change
- `src/main/services/render-filter-service.js` — Animate PIP size in `buildFilterComplex()` using expressions
- `src/main/services/render-service.js` — Pass per-section pipScale through the pipeline
- `tests/unit/project-domain.test.js` — Update keyframe normalization tests
- `tests/unit/render-filter-service.test.js` — Add animated PIP size tests
