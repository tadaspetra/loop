## Why

Users recording screen presentations often need to show supplementary visual content — images, diagrams, or video clips — while narrating. Currently the only visual layers are the screen recording and the PIP camera. There is no way to overlay external media onto the recording timeline. Adding a media overlay track lets users drop images and videos on top of their screen recording at precise time ranges, positioned and sized freely, creating richer and more informative content.

## What Changes

- **New overlay track in the timeline UI** — a second track rendered above the section track, where users can place, trim, split, and select overlay media items.
- **Drag-and-drop media import** — users drop image or video files onto the editor canvas to add them. Files are copied into the project folder and tracked with the existing `.delete` staging system.
- **Free-placement overlay on canvas** — overlay media is draggable and corner-resizable on the editor canvas, drawn between the screen recording and the PIP camera in z-order. Overflow beyond canvas boundaries is allowed (grayed in editor, clipped in render).
- **Per-mode overlay positioning** — each overlay segment stores independent position/size for landscape and reel modes, following the `savedLandscape`/`savedReel` pattern.
- **Overlay segment splitting** — overlays can be split at the playhead (like sections), creating two segments referencing the same source file. Each segment has independent position/size, with smooth transitions between consecutive same-media segments.
- **Video overlay playback** — video overlays play in sync with the timeline, using a third `<video>` element. Video segments have `sourceStart`/`sourceEnd` to control which part of the source plays.
- **Smooth enter/exit and movement transitions** — overlays fade in/out at their time boundaries and interpolate position/size between split segments, using the same `TRANSITION_DURATION` (0.3s) system.
- **FFmpeg render support** — the render pipeline adds overlay media as an additional input with time-bounded, positioned overlay filters, composited between the screen base and the PIP camera.
- **Reference-counted file management** — same media file can be used by multiple overlay segments without duplication. Files are staged to `.deleted/` only when all references are removed. Undo/redo support.
- **Overlay audio is muted by default** — video overlay audio is not included in the output.

## Capabilities

### New Capabilities

- `media-overlay-data`: Data model for overlay items — structure, normalization, validation, persistence in project timeline. Covers overlay segment shape, media file references, per-mode position/size state, sourceStart/sourceEnd for video.
- `media-overlay-timeline`: Timeline UI for the overlay track — rendering overlay segments above the section track, selection/highlighting, trim handles, split at playhead, drag-to-reorder timing.
- `media-overlay-canvas`: Editor canvas interaction for overlays — free-placement drag, corner-resize, overflow visualization (grayed outside bounds), z-order between screen and PIP, per-mode state save/restore.
- `media-overlay-playback`: Editor playback of overlay media — syncing image/video display to timeline position, video element management, fade in/out transitions, position/size interpolation between segments.
- `media-overlay-render`: FFmpeg render pipeline for overlays — adding overlay inputs, time-bounded overlay filters with position/scale, compositing between screen base and PIP camera, handling both image and video sources.
- `media-overlay-files`: File lifecycle for overlay media — drag-and-drop import, copy to project folder, reference counting across segments, `.delete` staging integration, cleanup on project operations.

### Modified Capabilities

- `take-file-cleanup`: The `.delete` staging and cleanup system must now also track overlay media files alongside take files. The `stageTakeIfUnreferenced` / `unstageTakeById` pattern extends to overlay media references.

## Impact

- **`src/shared/domain/project.js`** — new overlay normalization functions, data shape, constants, exports. Extension of `normalizeProjectData` to include overlay track.
- **`src/renderer/app.js`** — new overlay track state in `editorState`, overlay timeline rendering, canvas drag/resize handlers, overlay draw loop in editor, drop event handling, per-mode state for overlays, split/delete/trim operations.
- **`src/main/services/render-filter-service.js`** — new overlay filter construction (image/video overlay between screen_base and PIP), time-bounded enable expressions, position/scale filters.
- **`src/main/services/render-service.js`** — overlay inputs in `buildInputPlan`, overlay file paths in ffmpeg args, overlay data passed to filter builder.
- **`src/main/services/project-service.js`** — overlay file staging/unstaging, reference counting for overlay media, cleanup integration.
- **`src/preload.js`** — possible new IPC channels for overlay file import (copy to project folder).
- **Timeline CSS** — new track row above section track.
- **No external dependencies** — uses existing ffmpeg-static, existing video element APIs, existing file management infra.
