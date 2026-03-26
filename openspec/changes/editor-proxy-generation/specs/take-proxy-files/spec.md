## ADDED Requirements

### Requirement: Proxy generation after recording stops
After a recording finishes and the take is saved to disk, the main process SHALL start a background ffmpeg job to generate a proxy MP4 for the screen recording. The proxy job SHALL begin without blocking the renderer or the editor. The renderer SHALL NOT wait for proxy completion before entering the editor.

#### Scenario: Recording stops with a screen file
- **WHEN** `stopRecording()` completes and the take's `screenPath` is saved to disk
- **THEN** the renderer sends `proxy:generate` with `{ takeId, screenPath, projectFolder }`
- **AND** the main process starts an ffmpeg child process in the background
- **AND** the renderer enters the editor immediately without waiting for the proxy

#### Scenario: Recording stops without a screen file
- **WHEN** `stopRecording()` completes but `results.screen` is falsy
- **THEN** no `proxy:generate` IPC call is made

### Requirement: Proxy generation on project open
When a project is opened and activated, the main process SHALL queue background proxy generation for any take whose `proxyPath` is `null` or whose proxy file does not exist on disk. Generation SHALL be queued after the editor is entered, not before.

#### Scenario: Project opened with takes missing proxies
- **WHEN** a project is opened and one or more takes have `proxyPath: null`
- **THEN** for each such take, the renderer sends `proxy:generate` after the editor has been entered
- **AND** the editor opens immediately without waiting for proxy generation

#### Scenario: Project opened with all proxies present
- **WHEN** a project is opened and all takes have a valid `proxyPath` pointing to an existing file
- **THEN** no `proxy:generate` calls are made

#### Scenario: Project opened with a stale proxy path (file missing from disk)
- **WHEN** a project is opened and a take has a non-null `proxyPath` but the file does not exist on disk
- **THEN** the renderer treats this take as missing its proxy and sends `proxy:generate` for it

### Requirement: Proxy ffmpeg encoding settings
The proxy SHALL be encoded with the following settings to ensure fast seeking and lightweight decoding in the editor:

- **Codec**: libx264
- **Resolution**: 960×540 (half of the 1920×1080 source canvas)
- **CRF**: 23
- **Preset**: fast
- **Keyframe interval**: `-g 15` (one keyframe per 0.5 s at 30 fps)
- **Audio**: AAC, 64 kbps (so the proxy video element can serve as the audio source)
- **Container flags**: `-movflags +faststart` (moov atom at file head for instant browser load)
- **Output format**: `.mp4`

#### Scenario: Proxy file is generated for a 90-second screen recording
- **WHEN** proxy generation completes for a 90-second 1920×1080 VP9 `.webm`
- **THEN** the output is a valid `.mp4` file
- **AND** the output video resolution is 960×540
- **AND** the output video codec is H264
- **AND** the file can be loaded by an HTML5 `<video>` element immediately (moov atom at head)

### Requirement: Proxy output filename
The proxy file SHALL be named by replacing the source file's extension with `-proxy.mp4`.

#### Scenario: Standard screen filename
- **WHEN** the screen source is `recording-1710000000000-screen.webm`
- **THEN** the proxy output path is `recording-1710000000000-screen-proxy.mp4` in the same directory

### Requirement: Proxy completion updates take metadata
When the proxy ffmpeg job completes successfully, the main process SHALL notify the renderer via an IPC event. The renderer SHALL update the in-memory take's `proxyPath` and persist the project to disk.

#### Scenario: Proxy generation succeeds
- **WHEN** the ffmpeg proxy job exits with code 0
- **THEN** the main process sends `proxy:progress` with `{ takeId, status: 'done', proxyPath }`
- **AND** the renderer updates `take.proxyPath` in `activeProject.takes`
- **AND** the renderer calls `persistProjectNow()` to write the updated path to `project.json`

#### Scenario: Proxy generation fails
- **WHEN** the ffmpeg proxy job exits with a non-zero code
- **THEN** the main process sends `proxy:progress` with `{ takeId, status: 'error', error: <message> }`
- **AND** the renderer logs the error
- **AND** `take.proxyPath` remains `null`
- **AND** the editor continues using the original `.webm` without interruption

### Requirement: Editor uses proxy for screen video element
When `getOrCreateTakeVideos()` creates a video element for a take, it SHALL use the take's `proxyPath` as the `src` if `proxyPath` is a non-null string pointing to an existing file. If `proxyPath` is null or missing, it SHALL fall back to `screenPath`.

#### Scenario: Take has a valid proxy
- **WHEN** `getOrCreateTakeVideos(takeId)` is called and `take.proxyPath` is a non-null, valid file path
- **THEN** `screen.src` is set to `pathToFileUrl(take.proxyPath)`

#### Scenario: Take has no proxy yet
- **WHEN** `getOrCreateTakeVideos(takeId)` is called and `take.proxyPath` is null
- **THEN** `screen.src` is set to `pathToFileUrl(take.screenPath)`

#### Scenario: Proxy src used only for display
- **WHEN** the editor exports via `render-composite`
- **THEN** `render-service.js` reads from `take.screenPath` (the original `.webm`), never from `proxyPath`
- **AND** the exported video is full 1920×1080 quality

### Requirement: proxyPath persisted on take in project.json
The `proxyPath` field SHALL be stored on the take object in `project.json` as a project-relative path (using `toProjectRelativePath`). On project load, it SHALL be resolved to an absolute path (using `toProjectAbsolutePath`).

#### Scenario: Project saved after proxy completes
- **WHEN** proxy generation completes and `persistProjectNow()` is called
- **THEN** `project.json` contains `proxyPath` as a relative path string for that take

#### Scenario: Project loaded with existing proxy path
- **WHEN** a project is loaded via `normalizeProjectData`
- **THEN** `take.proxyPath` is resolved to an absolute path if it was stored as relative
- **AND** `take.proxyPath` is `null` if the field was absent in the JSON (legacy takes)

### Requirement: Proxy generation queue limits concurrency
The main process SHALL not run more than 2 concurrent ffmpeg proxy jobs. If more than 2 proxy generation requests arrive simultaneously (e.g. on project open with many takes), the excess requests SHALL be queued and started as prior jobs complete.

#### Scenario: Three takes queued simultaneously on project open
- **WHEN** a project opens with 3 takes missing proxies
- **THEN** at most 2 ffmpeg proxy processes run concurrently
- **AND** the third starts only after one of the first two completes

#### Scenario: Single take after recording
- **WHEN** a single recording completes and `proxy:generate` is called once
- **THEN** a single ffmpeg proxy process starts immediately (queue is empty)

### Requirement: Proxy written to temp path then renamed
The ffmpeg proxy job SHALL write output to a `.tmp` path first (`<proxyPath>.tmp`), then rename it to the final path on success. This prevents a partial/corrupt proxy file from being mistaken for a valid proxy.

#### Scenario: Proxy generation succeeds
- **WHEN** ffmpeg exits with code 0
- **THEN** the `.tmp` file is renamed to the final `.mp4` path
- **AND** the `.tmp` file no longer exists

#### Scenario: Proxy generation fails mid-encode
- **WHEN** ffmpeg exits with non-zero code
- **THEN** the `.tmp` file is deleted if it exists
- **AND** no partial `.mp4` file is left at the final proxy path
