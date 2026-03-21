## ADDED Requirements

### Requirement: Renderer cleanup on window close
The renderer SHALL stop all active media streams, close AudioContext, stop MediaRecorders, clear recording intervals, and close any open WebSocket connection when the window is about to close (`beforeunload`).

#### Scenario: Window closed while idle (not recording)
- **WHEN** the user closes the app window while not recording
- **THEN** the system stops all tracks on `screenStream`, `cameraStream`, and `audioStream`
- **AND** closes the `AudioContext` if open
- **AND** cancels any active `drawRAF` or editor draw loop

#### Scenario: Window closed while recording
- **WHEN** the user closes the app window while a recording is active
- **THEN** the system stops all `MediaRecorder` instances
- **AND** clears `screenRecInterval`
- **AND** stops all media stream tracks (`screenStream`, `cameraStream`, `audioStream`)
- **AND** closes the `AudioContext`
- **AND** closes the Scribe WebSocket if open
- **AND** disconnects the AudioWorklet node if connected

#### Scenario: Window closed after recording stopped
- **WHEN** the user closes the app window after recording has completed and the editor is open
- **THEN** the system stops all media stream tracks
- **AND** closes the `AudioContext`
- **AND** no errors are thrown for already-stopped resources

### Requirement: Main process cleanup on app quit
The main process SHALL clear the mouse trail capture timer when the app is quitting, regardless of whether the renderer sent a `stop-mouse-trail` message.

#### Scenario: App quit while mouse trail timer running
- **WHEN** the app quits (via Cmd+Q, window close, or process signal) while the mouse trail `setInterval` timer is active in the main process
- **THEN** the main process clears the timer via `clearInterval`
- **AND** releases the samples array

#### Scenario: App quit with no active timer
- **WHEN** the app quits and no mouse trail timer is running
- **THEN** the quit handler completes without error

### Requirement: Cleanup is idempotent
The cleanup function SHALL be safe to call multiple times without errors. Calling cleanup when resources are already stopped or null MUST NOT throw.

#### Scenario: Double cleanup call
- **WHEN** `cleanupAllMedia()` is called twice in succession
- **THEN** the second call completes without error
- **AND** no resources are double-stopped or double-closed

#### Scenario: Cleanup with null streams
- **WHEN** `cleanupAllMedia()` is called and `screenStream`, `cameraStream`, or `audioStream` is null
- **THEN** the function skips those streams without error

### Requirement: Lazy idle cleanup on view switch
When the user navigates away from the recording view (to timeline, home, or processing) and is not actively recording, the renderer SHALL start an idle timer. If the user does not return to the recording view before the timer fires, all media streams SHALL be cleaned up. If the user returns before the timer fires, the timer SHALL be cancelled and streams remain active.

#### Scenario: User switches to timeline and stays
- **WHEN** the user switches from recording view to timeline view
- **AND** no recording is active
- **AND** 30 seconds elapse without returning to the recording view
- **THEN** the system stops all media stream tracks (`screenStream`, `cameraStream`, `audioStream`)
- **AND** closes the `AudioContext`
- **AND** resets `mediaInitialized` so streams are re-acquired on next entry to recording view

#### Scenario: User switches to timeline and returns quickly
- **WHEN** the user switches from recording view to timeline view
- **AND** returns to recording view within 30 seconds
- **THEN** the idle timer is cancelled
- **AND** all streams remain active with no interruption to the preview

#### Scenario: User returns to recording after idle cleanup
- **WHEN** the user navigates to the recording view after streams were cleaned by the idle timer
- **THEN** the system re-acquires all media streams via `ensureMediaInitialized()`
- **AND** the live preview becomes available after stream acquisition (~500ms)

#### Scenario: Idle timer not started during active recording
- **WHEN** the user is actively recording and a view switch occurs
- **THEN** no idle timer is started
- **AND** streams remain active

### Requirement: Cleanup releases ScreenCaptureKit sessions
When media stream tracks are stopped via `.stop()`, the underlying ScreenCaptureKit capture session MUST be released by the Chromium/Electron runtime, preventing stale session accumulation in WindowServer across app restarts.

#### Scenario: Multiple app restarts without system reboot
- **WHEN** the app is started, records, stopped, and restarted 10+ times
- **THEN** each new recording session produces full frame-rate output
- **AND** no system restart is needed to recover recording functionality
