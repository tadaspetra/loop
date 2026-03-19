## ADDED Requirements

### Requirement: Per-section PIP scale

The system SHALL store `pipScale` as a per-keyframe property on section anchor keyframes, with values clamped to [0.15, 0.50] and a default of 0.22.

#### Scenario: PIP size varies between sections

- **WHEN** section A has `pipScale` 0.22 and section B has `pipScale` 0.40
- **THEN** the PIP overlay in section A SHALL be 22% of the effective canvas width, and in section B SHALL be 40%

#### Scenario: Smooth PIP size transition

- **WHEN** transitioning from a section with `pipScale` 0.22 to one with `pipScale` 0.40
- **THEN** the PIP size SHALL animate linearly over the 0.3s transition window

#### Scenario: PIP Size slider controls current section

- **WHEN** the user adjusts the PIP Size slider while a section is selected
- **THEN** only that section's anchor keyframe `pipScale` SHALL be updated

#### Scenario: Apply to Future Sections includes pipScale

- **WHEN** the user applies style to future sections
- **THEN** `pipScale` SHALL be copied alongside zoom, pan, cropX, and other section properties

### Requirement: PIP position re-snap on scale change

When `pipScale` changes for a section, the PIP position SHALL be re-snapped to the nearest corner using the new size, maintaining proper margins from the edges.

#### Scenario: Resize re-snaps position

- **WHEN** a section's `pipScale` changes from 0.22 to 0.40
- **THEN** the PIP's `pipX` and `pipY` SHALL be recalculated to snap to the nearest corner with the new size

### Requirement: FFmpeg render with animated PIP size

The FFmpeg render pipeline SHALL support per-keyframe `pipScale` values, producing animated PIP size transitions in the output video.

#### Scenario: Rendered output matches editor preview

- **WHEN** rendering a video with sections having different `pipScale` values
- **THEN** the PIP size in the output video SHALL match the editor preview at each point in time

#### Scenario: Static PIP size (all sections same)

- **WHEN** all sections have the same `pipScale`
- **THEN** the render pipeline SHALL use a fixed PIP size (no expression overhead)

### Requirement: Backward compatibility

Existing projects without per-keyframe `pipScale` SHALL use the project-level `settings.pipScale` as the default value for all keyframes. Behavior is identical to before this change.

#### Scenario: Legacy project loaded

- **WHEN** a project saved before this change is loaded (keyframes have no `pipScale`)
- **THEN** all sections SHALL use `settings.pipScale` (or 0.22 if absent) as their `pipScale`
