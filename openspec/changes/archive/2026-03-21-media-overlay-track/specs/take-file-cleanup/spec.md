## MODIFIED Requirements

### Requirement: Stage unreferenced take files for deletion

The system SHALL move unreferenced media files to a `.deleted/` staging folder within the project directory. A take file is unreferenced when no active section uses its take ID. **An overlay media file is unreferenced when no overlay segment's `mediaPath` points to it.**

The `stageTakeIfUnreferenced` pattern SHALL be extended to also support overlay media files via a parallel `stageOverlayFileIfUnreferenced(mediaPath)` function that checks overlay segment references.

#### Scenario: Stage unreferenced take file
- **WHEN** a section referencing take A is deleted and no other section references take A
- **THEN** take A's screen and camera files are moved to `.deleted/`

#### Scenario: Stage unreferenced overlay media file
- **WHEN** the last overlay segment referencing `overlay-media/img.png` is deleted
- **THEN** `overlay-media/img.png` is moved to `.deleted/overlay-media/img.png`

#### Scenario: Overlay media still referenced
- **WHEN** an overlay segment is deleted but another segment still references the same `mediaPath`
- **THEN** the media file is NOT staged for deletion

### Requirement: Unstage take files on undo

The system SHALL restore staged files from `.deleted/` back to their original location when a delete operation is undone. **This SHALL apply to both take files and overlay media files.**

#### Scenario: Unstage take file on undo
- **WHEN** a section deletion is undone
- **THEN** the take's files are restored from `.deleted/` to the project folder

#### Scenario: Unstage overlay media on undo
- **WHEN** an overlay deletion is undone and the media was staged
- **THEN** `overlay-media/img.png` is restored from `.deleted/overlay-media/` to `overlay-media/`

### Requirement: Cleanup permanently deletes staged files

The cleanup operation SHALL permanently remove all files in the `.deleted/` folder, including both take files and overlay media files.

#### Scenario: Cleanup removes staged overlay media
- **WHEN** the project cleanup runs and `.deleted/overlay-media/img.png` exists
- **THEN** the file is permanently deleted
