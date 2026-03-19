## Why

Deleting a section from the timeline removes it from the project data but leaves the take's recording files (.webm) on disk, causing unbounded storage waste. Users need a way to preserve useful takes for future use while cleaning up unwanted ones, with full undo support and reliable file cleanup.

## What Changes

- **Section "save" (heart) toggle**: Each section item in the sidebar gets a heart icon. Clicking it marks the section as `saved`. Saved sections survive deletion from the timeline — they appear grayed out in the sidebar with a [+] button to re-add them to the timeline.
- **Three section states**: Active (in timeline, full opacity), Saved+Removed (not in timeline but hearted, grayed out with [+]), Deleted (gone entirely).
- **Take file cleanup on section delete**: When a section is deleted from the timeline, check if its take is still referenced by any remaining active or saved section. If no references remain, move the take's files to a `.deleted/` staging folder inside the project directory.
- **Undo/redo support**: Deleting a saved section (which grays it out) and re-adding via [+] are both fully undoable. File moves to/from `.deleted/` are reversed on undo.
- **`.deleted/` cleanup triggers**: The `.deleted/` folder is permanently removed on project open (stale from previous session), project switch, and via a "Save & Clean" button on the home screen.
- **Saved sections persistence**: Saved sections are stored in `timeline.savedSections` array in project.json, preserving them across save/load.
- **Sidebar rendering**: Both active and saved sections appear in the sidebar, sorted by time order (interleaved). Active sections have full opacity; saved sections are grayed out with [+] to re-add.
- **Home screen "Save & Clean" button**: Explicit user action to flush `.deleted/` and remove unused takes from `project.takes`.

## Capabilities

### New Capabilities
- `section-save`: Heart toggle on section items, saved sections list, grayed-out sidebar display with re-add, and persistence in project.json.
- `take-file-cleanup`: Automatic take file cleanup when unreferenced, `.deleted/` staging folder, multi-trigger permanent deletion, and "Save & Clean" button on home screen.

### Modified Capabilities
_None — existing specs (reel-mode, pip-overlay, etc.) are unaffected._

## Impact

- `src/renderer/app.js`: Sidebar rendering, delete logic, undo/redo, save/restore, home screen button.
- `src/index.html`: Heart icon on section items, [+] re-add button, "Save & Clean" button on home screen.
- `src/shared/domain/project.js`: `normalizeKeyframes` and new `normalizeSavedSections` for persistence.
- `src/main/services/project-service.js` or `src/main/main.js`: File move/delete operations via IPC (`.deleted/` management).
- `src/preload.js`: New IPC channel(s) for file staging/cleanup.
- `src/main/infra/file-system.js`: Possible new helpers for move-to-deleted and cleanup.
