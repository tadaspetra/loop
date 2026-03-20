## ADDED Requirements

### Requirement: Drag-and-drop media import

The user SHALL be able to import overlay media by dropping an image or video file onto the editor canvas. Supported formats: images (PNG, JPG, JPEG, GIF, WebP), videos (MP4, WebM, MOV). The file SHALL be copied to `{projectFolder}/overlay-media/` with a unique filename: `{originalName}-{timestamp}.{ext}`.

#### Scenario: Drop image file onto canvas
- **WHEN** the user drags a PNG file from their filesystem and drops it on the editor canvas
- **THEN** the file is copied to `overlay-media/`, an overlay segment is created with `mediaType: 'image'`, and the overlay appears on the canvas at the default position

#### Scenario: Drop video file onto canvas
- **WHEN** the user drags an MP4 file and drops it on the editor canvas
- **THEN** the file is copied to `overlay-media/`, an overlay segment is created with `mediaType: 'video'`, sourceStart=0, sourceEnd=video duration (or remaining timeline, whichever is shorter)

#### Scenario: Drop unsupported file type
- **WHEN** the user drops a .txt or .pdf file on the canvas
- **THEN** the drop is ignored (no overlay created, no file copied)

### Requirement: Overlay media stored in project folder

Imported overlay media files SHALL be copied to `{projectFolder}/overlay-media/` directory. The directory SHALL be created on first import if it does not exist. The `mediaPath` stored in overlay segments SHALL be the project-relative path (e.g., `overlay-media/screenshot-1711234567.png`).

#### Scenario: First media import creates directory
- **WHEN** the user imports the first overlay media and `overlay-media/` does not exist
- **THEN** the directory is created and the file is copied into it

#### Scenario: Media path is project-relative
- **WHEN** an overlay segment is created for file `screenshot.png`
- **THEN** `mediaPath` is stored as `overlay-media/screenshot-1711234567.png` (not an absolute path)

### Requirement: Duplicate media file detection

When importing a file that already exists in `overlay-media/` (same original name), the system SHALL reuse the existing file path rather than creating a duplicate copy. The new overlay segment SHALL reference the same `mediaPath`.

#### Scenario: Import same file twice
- **WHEN** the user drops `diagram.png` onto the canvas, and `overlay-media/diagram-1711234567.png` already exists with identical content
- **THEN** the new overlay segment references the existing `overlay-media/diagram-1711234567.png` without creating a new copy

#### Scenario: Import different file with same name
- **WHEN** the user drops a different `diagram.png` (different content) onto the canvas
- **THEN** a new copy is created with a different timestamp: `overlay-media/diagram-1711234999.png`

### Requirement: Overlay media reference counting

The system SHALL track how many overlay segments reference each media file. A media file is "referenced" if any overlay segment's `mediaPath` points to it.

#### Scenario: Two segments reference same file
- **WHEN** an overlay is split into two segments, both referencing `overlay-media/img.png`
- **THEN** the reference count for `img.png` is 2

#### Scenario: One reference deleted
- **WHEN** one of two segments referencing `overlay-media/img.png` is deleted
- **THEN** the reference count drops to 1, the file is NOT staged for deletion

### Requirement: Overlay media delete staging

When the last overlay segment referencing a media file is deleted, the media file SHALL be moved to the `.deleted/` staging folder using the same mechanism as take file staging. When an overlay delete is undone, the media file SHALL be unstaged (restored from `.deleted/`).

#### Scenario: Last reference deleted stages file
- **WHEN** the only overlay segment referencing `overlay-media/vid.mp4` is deleted
- **THEN** `vid.mp4` is moved from `overlay-media/` to `.deleted/`

#### Scenario: Undo restores staged file
- **WHEN** the user undoes the deletion of the last overlay referencing `overlay-media/vid.mp4`
- **THEN** `vid.mp4` is moved back from `.deleted/` to `overlay-media/`

### Requirement: Overlay media cleanup on project cleanup

When the project cleanup operation runs (removing `.deleted/` contents), staged overlay media files SHALL be permanently deleted along with staged take files.

#### Scenario: Project cleanup removes staged overlay files
- **WHEN** the user triggers project cleanup and `.deleted/` contains overlay media files
- **THEN** the overlay media files are permanently removed

### Requirement: IPC channel for overlay file import

A new IPC channel `import-overlay-media` SHALL be provided that accepts a source file path, copies it to the project's `overlay-media/` directory, and returns the project-relative `mediaPath`. The main process handles the file copy to ensure proper file system access.

#### Scenario: Import overlay via IPC
- **WHEN** the renderer sends `import-overlay-media` with source path `/Users/me/Desktop/diagram.png`
- **THEN** the main process copies the file to `{projectFolder}/overlay-media/diagram-{timestamp}.png` and returns `overlay-media/diagram-{timestamp}.png`
