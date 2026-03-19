## Design Decisions

### Decision 1: pipScale as a keyframe property

**Choice**: Add `pipScale` to keyframe objects alongside `backgroundZoom`, `reelCropX`, etc.

**Rationale**: Follows the exact same pattern as other per-section properties. Each section anchor keyframe stores a `pipScale` value. The `getStateAtTime()` function interpolates between values during the 0.3s transition window. This is consistent with how zoom, pan, and crop already work.

**Data flow**: `keyframe.pipScale` → `getStateAtTime()` interpolation → `editorState.pipSize = computePipSize(pipScale, effectiveW)` → draw loop uses size → render receives per-keyframe values

### Decision 2: Keep pipScale in project settings as the default

**Choice**: Keep `settings.pipScale` as the default/initial value for new keyframes. Remove it from being the authoritative runtime value.

**Rationale**: When creating a new project or adding new sections, the default pipScale comes from settings. Existing projects without per-keyframe pipScale values fall back to the project-level default. This preserves backward compatibility — old projects work unchanged.

### Decision 3: PIP Size slider controls current section anchor

**Choice**: The PIP Size slider reads/writes the current section's anchor keyframe `pipScale`, matching how the zoom slider works.

**Rationale**: Consistent UX — every per-section property uses the same control pattern. The slider updates the anchor keyframe, pushes undo, and schedules a project save.

### Decision 4: Animated PIP size in FFmpeg render

**Choice**: Build animated PIP size expressions in `buildFilterComplex()` using the same `buildNumericExpr()` approach as zoom.

**Rationale**: The PIP size needs to smoothly animate between sections in the rendered output. Using the existing expression builder keeps the FFmpeg pipeline consistent. The PIP scale filter expression, corner radius, alpha mask, and overlay position all need to use the animated size.

### Decision 5: Re-snap PIP position on pipScale change

**Choice**: When pipScale changes for a section, automatically re-snap the PIP position to the nearest corner using the new size.

**Rationale**: Changing PIP size without adjusting position would cause the PIP to overlap edges. The existing `snapToNearestCorner()` function handles this. This matches the current behavior when the global PIP size slider is adjusted.
