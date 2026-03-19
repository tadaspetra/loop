## Why

Loop currently only exports 16:9 (landscape) video. Content creators increasingly need vertical 9:16 output for Instagram Reels, TikTok, and YouTube Shorts. Today, users must use external tools to crop and reframe their recordings for vertical platforms — breaking the single-tool workflow Loop promises. Adding native reel mode lets users produce vertical content directly from the same recording, with the same smooth animated transitions Loop already provides.

## What Changes

- Add an **output aspect ratio toggle** (16:9 / 9:16) in the editor controls
- In 9:16 mode, display a **crop overlay** on the editor preview showing the visible vertical strip within the 16:9 source, with the area outside the crop grayed out
- The crop region is **draggable** horizontally — the user positions it per section via keyframe anchors
- Crop positions **animate smoothly** between sections using the existing 0.3s transition system
- Add a **PIP size slider** to control the camera overlay size (essential since the default 422px PIP is ~70% of the 608px reel width)
- The **camera fullscreen** mode adapts to fill the 9:16 output frame
- The **ffmpeg render pipeline** produces 9:16 output (608x1080 for 1920x1080 source) by cropping after zoom/pan
- Existing zoom/pan controls continue to work, composing with the reel crop

## Capabilities

### New Capabilities
- `reel-crop`: Crop overlay system for selecting a 9:16 vertical strip from 16:9 source, including draggable positioning, per-section keyframe anchors, smooth animated transitions, and ffmpeg crop filter generation
- `pip-size-control`: Adjustable PIP (picture-in-picture) camera overlay size via a project-level slider, replacing the fixed 422px constant
- `output-aspect-ratio`: Project-level output mode toggle between 16:9 (landscape) and 9:16 (reel), affecting render pipeline output dimensions and editor preview

### Modified Capabilities

## Impact

- **Data model** (`src/shared/domain/project.js`): New keyframe property `reelCropX`, new project settings `outputMode` and `pipScale`
- **Render pipeline** (`src/main/services/render-filter-service.js`, `render-service.js`): New crop filter in ffmpeg chain, modified output resolution logic, PIP size parameterization
- **Editor UI** (`src/index.html`, `src/renderer/app.js`): New controls, crop overlay drawing, drag handling, coordinate space changes for PIP in reel mode
- **Project persistence**: New fields serialized/deserialized in project JSON
- **Tests**: New unit tests for domain normalizers, render filter builders, and section input normalization
