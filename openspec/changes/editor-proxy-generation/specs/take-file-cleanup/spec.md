## MODIFIED Requirements

### Requirement: Stage unreferenced take files to .deleted/
When a take becomes unreferenced (last section deleted or unsaved), the system SHALL move its files (screenPath, cameraPath, mousePath if present, **and proxyPath if present**) to a `.deleted/` subfolder inside the project directory via IPC. The take SHALL be removed from `project.takes`. An overlay media file is unreferenced when no overlay segment's `mediaPath` points to it. The `stageTakeIfUnreferenced` pattern SHALL be extended to also support overlay media files via a parallel `stageOverlayFileIfUnreferenced(mediaPath)` function.

#### Scenario: Delete last section referencing a take
- **WHEN** user deletes the last section (unsaved) that references take A
- **THEN** take A's screen and camera files are moved to `<projectFolder>/.deleted/` and take A is removed from `project.takes`

#### Scenario: Take has camera file
- **WHEN** an unreferenced take has both screenPath and cameraPath
- **THEN** both files are moved to `.deleted/`

#### Scenario: Take has no camera file
- **WHEN** an unreferenced take has only screenPath (cameraPath is null)
- **THEN** only the screen file is moved to `.deleted/`

#### Scenario: Take with mouse trail file
- **WHEN** an unreferenced take has screenPath, cameraPath, and mousePath
- **THEN** all three files are moved to `.deleted/`

#### Scenario: Take without mouse trail (legacy)
- **WHEN** an unreferenced take has screenPath and cameraPath but no mousePath
- **THEN** only screen and camera files are moved (no error for missing mousePath)

#### Scenario: Take with proxy file
- **WHEN** an unreferenced take has a non-null proxyPath pointing to an existing file
- **THEN** the proxy file is also moved to `.deleted/` alongside the screen, camera, and mouse trail files

#### Scenario: Take without proxy file (legacy or proxy not yet generated)
- **WHEN** an unreferenced take has proxyPath null or the proxy file does not exist on disk
- **THEN** the staging operation proceeds for the other files without error

#### Scenario: Stage unreferenced overlay media file
- **WHEN** the last overlay segment referencing `overlay-media/img.png` is deleted
- **THEN** `overlay-media/img.png` is moved to `.deleted/overlay-media/img.png`

#### Scenario: Overlay media still referenced
- **WHEN** an overlay segment is deleted but another segment still references the same `mediaPath`
- **THEN** the media file is NOT staged for deletion

### Requirement: Unstage take files on undo
When an undo operation restores a section that was the last reference to a take, the system SHALL move the take's files back from `.deleted/` to the project directory and re-add the take to `project.takes`. **This includes the mouse trail file and proxy file if they were staged.** This SHALL apply to both take files and overlay media files.

#### Scenario: Undo restores unreferenced take
- **WHEN** user undoes a section delete that had triggered file staging
- **THEN** the take's files are moved back from `.deleted/` to the project directory and the take is restored to `project.takes`

#### Scenario: Undo restores take with mouse trail
- **WHEN** user undoes a section delete that had triggered file staging for a take with mousePath
- **THEN** the screen, camera, and mouse trail files are all restored from `.deleted/`

#### Scenario: Undo restores take with proxy file
- **WHEN** user undoes a section delete that had triggered file staging for a take with proxyPath
- **THEN** the proxy file is also restored from `.deleted/` to the project directory
- **AND** take.proxyPath remains valid after undo

#### Scenario: Unstage overlay media on undo
- **WHEN** an overlay deletion is undone and the media was staged
- **THEN** `overlay-media/img.png` is restored from `.deleted/overlay-media/` to `overlay-media/`
