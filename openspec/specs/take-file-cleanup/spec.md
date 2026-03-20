## ADDED Requirements

### Requirement: Take reference counting
A take SHALL be considered "referenced" if any section in `timeline.sections` OR `timeline.savedSections` has a matching `takeId`. A take with zero references SHALL be eligible for file cleanup.

#### Scenario: Take with one active section
- **WHEN** a take has one section in the timeline and none in savedSections
- **THEN** the take is referenced and its files are kept

#### Scenario: Take with only saved sections
- **WHEN** a take has zero sections in the timeline but one in savedSections
- **THEN** the take is referenced and its files are kept

#### Scenario: Take with no references
- **WHEN** a take has zero sections in both timeline and savedSections
- **THEN** the take is unreferenced and eligible for cleanup

### Requirement: Stage unreferenced take files to .deleted/
When a take becomes unreferenced (last section deleted or unsaved), the system SHALL move its files (screenPath, cameraPath) to a `.deleted/` subfolder inside the project directory via IPC. The take SHALL be removed from `project.takes`. An overlay media file is unreferenced when no overlay segment's `mediaPath` points to it. The `stageTakeIfUnreferenced` pattern SHALL be extended to also support overlay media files via a parallel `stageOverlayFileIfUnreferenced(mediaPath)` function.

#### Scenario: Delete last section referencing a take
- **WHEN** user deletes the last section (unsaved) that references take A
- **THEN** take A's screen and camera files are moved to `<projectFolder>/.deleted/` and take A is removed from `project.takes`

#### Scenario: Take has camera file
- **WHEN** an unreferenced take has both screenPath and cameraPath
- **THEN** both files are moved to `.deleted/`

#### Scenario: Take has no camera file
- **WHEN** an unreferenced take has only screenPath (cameraPath is null)
- **THEN** only the screen file is moved to `.deleted/`

#### Scenario: Stage unreferenced overlay media file
- **WHEN** the last overlay segment referencing `overlay-media/img.png` is deleted
- **THEN** `overlay-media/img.png` is moved to `.deleted/overlay-media/img.png`

#### Scenario: Overlay media still referenced
- **WHEN** an overlay segment is deleted but another segment still references the same `mediaPath`
- **THEN** the media file is NOT staged for deletion

### Requirement: Unstage take files on undo
When an undo operation restores a section that was the last reference to a take, the system SHALL move the take's files back from `.deleted/` to the project directory and re-add the take to `project.takes`. This SHALL apply to both take files and overlay media files.

#### Scenario: Undo restores unreferenced take
- **WHEN** user undoes a section delete that had triggered file staging
- **THEN** the take's files are moved back from `.deleted/` to the project directory and the take is restored to `project.takes`

#### Scenario: Unstage overlay media on undo
- **WHEN** an overlay deletion is undone and the media was staged
- **THEN** `overlay-media/img.png` is restored from `.deleted/overlay-media/` to `overlay-media/`

### Requirement: Cleanup .deleted/ on project open
When a project is opened via `activateProject()`, the system SHALL check for and permanently remove any `.deleted/` folder in the project directory. This handles stale files from a previous session.

#### Scenario: Open project with stale .deleted/ folder
- **WHEN** a project is opened and a `.deleted/` folder exists in the project directory
- **THEN** the `.deleted/` folder and all its contents are permanently removed before the editor loads

### Requirement: Cleanup .deleted/ on project switch
When the user switches away from a project (via the Projects button), the system SHALL permanently remove the `.deleted/` folder for the current project before showing the home screen.

#### Scenario: Switch projects with pending .deleted/ files
- **WHEN** user clicks the Projects button to return to the home screen
- **THEN** the current project's `.deleted/` folder is permanently removed

### Requirement: Save & Clean button on home screen
The home screen SHALL display a "Save & Clean" button. Clicking it SHALL permanently remove the `.deleted/` folder and remove unreferenced takes from `project.takes` for the last-used project (or all recent projects).

#### Scenario: User clicks Save & Clean
- **WHEN** user clicks "Save & Clean" on the home screen
- **THEN** the system removes `.deleted/` folders and prunes unreferenced takes from recent projects, and displays a confirmation message

### Requirement: IPC channels for file staging
The main process SHALL expose IPC channels for file staging operations: staging take files to `.deleted/`, unstaging files back from `.deleted/`, permanently cleaning up `.deleted/`, and pruning unused takes. The `.deleted/` folder SHALL be created automatically when first needed.

#### Scenario: Stage files via IPC
- **WHEN** renderer sends `project:stageTakeFiles` with project path and file paths
- **THEN** main process creates `.deleted/` if needed and moves the specified files into it

#### Scenario: Unstage files via IPC
- **WHEN** renderer sends `project:unstageTakeFiles` with project path and file names
- **THEN** main process moves the specified files from `.deleted/` back to the project folder

#### Scenario: Cleanup via IPC
- **WHEN** renderer sends `project:cleanupDeleted` with project path
- **THEN** main process removes the `.deleted/` folder and all its contents, including both take files and overlay media files
