## Why

In reel mode (9:16), users may want to show more of their screen content than fits in the 608px-wide crop. Currently the zoom slider only goes 1x–3x (zoom in). Extending it below 1x ("zoom out") lets users shrink the content to fit more width, with the vertical letterbox bars filled by a darkened copy of the same content — a common pattern in social media reels that looks polished without being distracting.

## What Changes

- Extend the `backgroundZoom` range to support values below 1.0 (e.g. 0.5–1.0) when in reel mode, while keeping the 1.0–3.0 range in landscape mode
- When reel zoom < 1, the content is scaled to fit the crop width, leaving empty vertical space above and below
- The empty vertical space is filled with a darkened, scaled-up copy of the crop content (Option B: no blur, just heavy darkening to ~20–30% brightness)
- Both the editor preview canvas and the ffmpeg render pipeline produce the same visual result
- The zoom slider's min value becomes dynamic: 0.5 in reel mode, 1.0 in landscape mode

## Capabilities

### New Capabilities
- `reel-zoom-out`: Zoom-out (< 1x) support in reel mode with darkened background fill for letterbox bars

### Modified Capabilities

## Impact

- `src/renderer/app.js` — editor preview draw loop must render the darkened background + scaled content when zoom < 1 in reel mode; zoom slider range becomes mode-dependent
- `src/main/services/render-filter-service.js` — ffmpeg filter chain needs a split/overlay pipeline when reel zoom < 1: one branch for the darkened fill, one for the sharp content
- `src/shared/domain/project.js` — `normalizeBackgroundZoom` may need to accept values below 1.0 (or a new normalizer for reel zoom)
- `src/index.html` — zoom slider `min` attribute updated dynamically based on output mode
