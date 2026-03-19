## Context

The app records video takes (screen + camera .webm files) stored in a project folder. Takes are referenced by sections in the timeline. Deleting a section removes it from the data model but leaves take files on disk. Over time, dozens of unused takes accumulate (observed: 40 unused takes, ~3.5GB wasted in a single project).

Users also want to keep some takes for future use even after removing them from the timeline. Currently there is no mechanism for this.

Key existing structures:
- `editorState.sections` — active timeline sections, each with a `takeId`
- `activeProject.takes` — all recorded takes with file paths
- `snapshotTimeline()` / `restoreSnapshot()` — undo/redo via shallow-copied arrays
- `renderSectionTranscriptList()` — sidebar section items (buttons with label + transcript)
- `scheduleProjectSave()` / `flushScheduledProjectSave()` — debounced auto-save
- `clearEditorState()` — cleanup on project switch/close (clears undo stack)
- `safeUnlink()` in `file-system.js` — safe file deletion helper

## Goals / Non-Goals

**Goals:**
- Allow users to "save" sections (heart toggle) so their takes survive deletion from timeline
- Saved+removed sections appear grayed out in sidebar, sorted by time, with [+] to re-add
- Unused take files are moved to `.deleted/` staging folder for safe cleanup
- `.deleted/` is permanently cleaned on project open, project switch, and via "Save & Clean" button
- Full undo/redo support for save toggle, delete, and re-add operations
- Saved sections persist across save/load (stored in `timeline.savedSections`)

**Non-Goals:**
- Restoring files from OS Trash (not reliably possible programmatically)
- Editing saved sections while they're not in the timeline
- Take-level UI (takes remain invisible to users — interaction is through sections)
- Batch operations on saved sections

## Decisions

### D1: Saved sections stored in `timeline.savedSections` array

Saved sections live in a new `savedSections` array in the project timeline, separate from `sections`. Each saved section stores the same fields as a regular section plus `saved: true`.

**Rationale:** Keeps the active timeline clean. `sections` remains the source of truth for playback/export. Saved sections are display-only in the sidebar.

**Alternative considered:** A `saved` flag on sections within the same array. Rejected because it would require filtering everywhere sections are iterated (playback, export, keyframe sync, reindex, split, waveform, etc.).

### D2: Take reference counting via sections + savedSections

A take is "referenced" if any section in `sections` OR `savedSections` has a matching `takeId`. When a section is deleted (not saved), check if the take has zero remaining references. If so, move its files to `.deleted/`.

**Rationale:** Simple reference counting. No separate bookkeeping needed.

### D3: `.deleted/` staging folder inside project directory

Files are moved (fs.rename) to `<projectFolder>/.deleted/` rather than deleted immediately. This allows the undo stack to restore files by moving them back. The `.deleted/` folder is permanently removed (rm -rf) at safe points when undo is no longer possible.

**Rationale:** `fs.rename` within the same filesystem is atomic and fast. Moving back on undo is equally fast. Permanent deletion only happens when undo stack is cleared (project switch/close).

### D4: Cleanup triggers (multi-layered)

1. **On project open** (`activateProject`): If `.deleted/` exists, remove it (stale from previous session, undo stack is empty).
2. **On project switch** (`switchProjectBtn` click → before `setWorkspaceView('home')`): Remove `.deleted/` for the current project before switching.
3. **"Save & Clean" button on home screen**: User-triggered cleanup. Also prunes `project.takes` of unreferenced takes.
4. **Best-effort on `beforeunload`**: Attempt cleanup via IPC, may not complete.

**Rationale:** Multi-trigger ensures cleanup eventually happens even if one path fails.

### D5: IPC for file operations

File move/delete operations happen in the main process via new IPC channels:
- `project:stageTakeFiles` — moves take files to `.deleted/`
- `project:unstageTakeFiles` — moves files back from `.deleted/` (for undo)
- `project:cleanupDeleted` — permanently removes `.deleted/` folder
- `project:cleanupUnusedTakes` — removes unused takes from `project.takes` and cleans files (for "Save & Clean")

**Rationale:** Renderer can't access filesystem directly. IPC is the established pattern.

### D6: Undo/redo includes savedSections

`snapshotTimeline()` includes `savedSections` in the snapshot. `restoreSnapshot()` restores it. File staging/unstaging is triggered as a side-effect of restore when the snapshot differs from current state.

**Alternative considered:** Tracking file moves in the undo stack. Rejected as overly complex — diffing savedSections before/after restore and triggering moves is simpler.

### D7: Heart icon and [+] button placement

In the sidebar transcript list, each section row gets:
- **Heart icon** (right side of meta line): Toggle saved state. Outline (♡) when unsaved, filled (♥) when saved.
- **[+] button** (right side of meta line, only on saved+removed sections): Re-adds the section to the timeline at its original time position.

Saved+removed sections render with reduced opacity (`opacity-50`) and no click-to-select behavior (they're not in the timeline).

### D8: Re-add inserts at natural time position

When [+] is clicked on a saved section, it's removed from `savedSections` and inserted into `sections` at the position matching its `start` time. The `saved` flag is preserved (stays hearted). Timeline positions are recalculated, anchor keyframes synced.

## Risks / Trade-offs

- **[Risk] `fs.rename` fails across filesystem boundaries** → Mitigation: Project folder and `.deleted/` are on the same filesystem (`.deleted/` is a subfolder). This is guaranteed.
- **[Risk] Undo after many deletes could trigger many file moves** → Mitigation: File moves within same filesystem are near-instant (metadata-only operation).
- **[Risk] `beforeunload` cleanup may not complete** → Mitigation: Cleanup also runs on next project open, so at worst `.deleted/` persists one extra session.
- **[Trade-off] savedSections adds a new array to project.json** → Acceptable: It's a small addition, and `normalizeProjectData` handles unknown fields gracefully.
