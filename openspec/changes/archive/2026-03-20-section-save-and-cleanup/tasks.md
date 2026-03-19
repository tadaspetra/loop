## 1. Data model and persistence

- [x] 1.1 Add `savedSections` to `editorState` initialization in `enterEditor()` (default `[]`).
- [x] 1.2 Add `normalizeSavedSections()` in `project.js` that normalizes a `savedSections` array (same fields as sections, plus `saved: true`).
- [x] 1.3 Update `normalizeProjectData()` in `project.js` to include `timeline.savedSections` using `normalizeSavedSections()`.
- [x] 1.4 Update `getProjectTimelineSnapshot()` in `app.js` to include `savedSections` in the snapshot.
- [x] 1.5 Update `snapshotTimeline()` and `restoreSnapshot()` to include `savedSections` for undo/redo.

## 2. IPC channels for file staging

- [x] 2.1 Add `stageTakeFiles(projectPath, filePaths)` function in `project-service.js` — creates `.deleted/` and moves files into it via `fs.renameSync`.
- [x] 2.2 Add `unstageTakeFiles(projectPath, fileNames)` function in `project-service.js` — moves files back from `.deleted/` to project folder.
- [x] 2.3 Add `cleanupDeletedFolder(projectPath)` function in `project-service.js` — recursively removes `.deleted/` folder.
- [x] 2.4 Register IPC handlers in `main.js`: `project:stageTakeFiles`, `project:unstageTakeFiles`, `project:cleanupDeleted`.
- [x] 2.5 Expose IPC channels in `preload.js`: `stageTakeFiles`, `unstageTakeFiles`, `cleanupDeleted`.

## 3. Take reference counting and staging logic

- [x] 3.1 Add `isTakeReferenced(takeId)` helper in `app.js` — checks if any section in `editorState.sections` or `editorState.savedSections` has the given `takeId`.
- [x] 3.2 Add `stageTakeIfUnreferenced(takeId)` async helper in `app.js` — if take is unreferenced, calls IPC to move files to `.deleted/` and removes take from `activeProject.takes`.
- [x] 3.3 Add `unstageTake(take)` async helper in `app.js` — calls IPC to move files back from `.deleted/` and re-adds take to `activeProject.takes`.

## 4. Section save (heart) toggle

- [x] 4.1 Add `saved` field handling to section objects — default `false`, preserve through split and reindex.
- [x] 4.2 Implement `toggleSectionSaved(sectionId)` in `app.js` — pushes undo, toggles `saved` flag on active sections, or unsaves+removes from `savedSections` (with take staging if unreferenced). Re-renders sidebar.

## 5. Delete section integration

- [x] 5.1 Update `deleteSelectedSection()` — when deleting a section with `saved: true`, move it to `editorState.savedSections` instead of discarding. When deleting an unsaved section, call `stageTakeIfUnreferenced()`.
- [x] 5.2 Handle the "last section deleted" edge case — if all active sections are deleted but savedSections remain, stay in editor with empty timeline (don't switch to recording view).

## 6. Re-add saved section

- [x] 6.1 Implement `readdSavedSection(sectionId)` in `app.js` — pushes undo, removes from `savedSections`, inserts into `sections` at correct time position, recalculates timeline, syncs anchors, re-renders.

## 7. Undo/redo file move side-effects

- [x] 7.1 Update `restoreSnapshot()` to diff `savedSections` before/after and trigger file staging/unstaging for takes that changed reference status.

## 8. Sidebar UI rendering

- [x] 8.1 Update `renderSectionTranscriptList()` — merge `sections` and `savedSections` sorted by `start` time. Active sections render with heart icon (outline/filled). Saved+removed sections render grayed out with filled heart and [+] button.
- [x] 8.2 Add click handlers for heart icon (calls `toggleSectionSaved`) and [+] button (calls `readdSavedSection`). Saved+removed rows do NOT trigger `selectEditorSection`.

## 9. Cleanup triggers

- [x] 9.1 Update `activateProject()` — call `cleanupDeleted` IPC on the incoming project path before loading.
- [x] 9.2 Update `switchProjectBtn` click handler — call `cleanupDeleted` IPC on `activeProjectPath` before switching to home screen.
- [x] 9.3 Add best-effort cleanup in `beforeunload` handler — call `cleanupDeleted` IPC.

## 10. Home screen Save & Clean button

- [x] 10.1 Add "Save & Clean" button to `projectHomeView` in `index.html`.
- [x] 10.2 Add click handler — calls `cleanupDeleted` IPC for the last-used project path, shows confirmation message via `showProjectHomeMessage()`.

## 11. Verification

- [ ] 11.1 Manual test: Heart toggle saves/unsaves sections, persists across save/load.
- [ ] 11.2 Manual test: Delete saved section → grayed out in sidebar with [+]. Delete unsaved section → disappears.
- [ ] 11.3 Manual test: [+] re-adds saved section to timeline at correct position.
- [ ] 11.4 Manual test: Undo/redo works for all operations (save, delete, re-add, unsave).
- [ ] 11.5 Manual test: Deleting last unsaved reference to a take moves files to `.deleted/`.
- [ ] 11.6 Manual test: Reopening project cleans up `.deleted/` folder.
- [ ] 11.7 Manual test: "Save & Clean" button on home screen cleans up files.
