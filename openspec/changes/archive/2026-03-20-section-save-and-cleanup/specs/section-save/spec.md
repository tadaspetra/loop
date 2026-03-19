## ADDED Requirements

### Requirement: Heart toggle on section items
Each section item in the sidebar transcript list SHALL display a heart icon. Clicking the heart SHALL toggle the section's `saved` state. An outline heart indicates unsaved; a filled heart indicates saved. The toggle SHALL push an undo point before changing state.

#### Scenario: User saves a section
- **WHEN** user clicks the heart icon on an active section
- **THEN** the heart becomes filled, and the section's `saved` flag is set to `true`

#### Scenario: User unsaves an active section
- **WHEN** user clicks the filled heart on an active saved section
- **THEN** the heart becomes outline, and the section's `saved` flag is set to `false`

### Requirement: Saved section survives timeline deletion
When a section with `saved: true` is deleted from the timeline, the system SHALL move it to `savedSections` instead of discarding it. The section SHALL appear grayed out in the sidebar at its original time position.

#### Scenario: Delete a saved section
- **WHEN** user deletes a section that has `saved: true`
- **THEN** the section is removed from `editorState.sections`, added to `editorState.savedSections`, and appears grayed out in the sidebar with a [+] button

#### Scenario: Delete an unsaved section
- **WHEN** user deletes a section that has `saved: false` or no saved flag
- **THEN** the section is removed from `editorState.sections` and disappears from the sidebar entirely

### Requirement: Saved+removed section display
Saved sections not in the timeline SHALL render in the sidebar with reduced opacity, no click-to-select behavior, and a [+] re-add button. They SHALL be interleaved with active sections sorted by `start` time.

#### Scenario: Sidebar shows mixed active and saved sections
- **WHEN** the sidebar renders with 3 active sections and 2 saved+removed sections
- **THEN** all 5 items appear sorted by their `start` time, active sections at full opacity, saved sections at reduced opacity with [+] button

#### Scenario: Saved section is not selectable
- **WHEN** user clicks on a saved+removed section row (not the [+] button)
- **THEN** nothing happens — the section is not selected and the playhead does not move

### Requirement: Re-add saved section to timeline
Clicking [+] on a saved+removed section SHALL move it from `savedSections` back to `sections` at the position matching its `start` time. The section SHALL remain saved (hearted). An undo point SHALL be pushed before the operation.

#### Scenario: Re-add a saved section
- **WHEN** user clicks [+] on a saved+removed section
- **THEN** the section is removed from `savedSections`, inserted into `sections` at the correct time position, timeline is recalculated, and the section appears at full opacity with a filled heart

### Requirement: Unsaving a removed section deletes it
When a user toggles the heart off on a saved+removed section, the section SHALL be removed from `savedSections` entirely. If the section's take has no other references (in `sections` or `savedSections`), the take's files SHALL be staged for deletion.

#### Scenario: Unsave a removed section (take still referenced)
- **WHEN** user clicks the filled heart on a saved+removed section whose take is still referenced by another section
- **THEN** the section disappears from the sidebar, the take files are NOT staged for deletion

#### Scenario: Unsave a removed section (take unreferenced)
- **WHEN** user clicks the filled heart on a saved+removed section whose take has no other references
- **THEN** the section disappears from the sidebar, and the take files are moved to `.deleted/`

### Requirement: Saved sections persistence
Saved sections SHALL be stored in `timeline.savedSections` in project.json. The `normalizeProjectData` function SHALL preserve and normalize this array on load.

#### Scenario: Save and reload project with saved sections
- **WHEN** a project with saved+removed sections is saved and reopened
- **THEN** the saved sections appear grayed out in the sidebar at their original positions

### Requirement: Undo/redo support for save operations
All save-related operations (toggle heart, delete saved section, re-add section, unsave removed section) SHALL be fully undoable and redoable. The undo snapshot SHALL include `savedSections`.

#### Scenario: Undo delete of saved section
- **WHEN** user deletes a saved section (it becomes grayed out) then presses undo
- **THEN** the section returns to the timeline as an active saved section

#### Scenario: Undo unsave of removed section
- **WHEN** user unsaves a removed section (it disappears) then presses undo
- **THEN** the section reappears as a saved+removed section in the sidebar, and any staged take files are moved back
