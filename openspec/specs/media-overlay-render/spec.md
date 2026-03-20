## ADDED Requirements

### Requirement: Overlay included in ffmpeg filter chain

When overlay segments exist in the render data, the ffmpeg filter chain SHALL composite overlay media between the screen base and the PIP camera overlay. The compositing order SHALL be: screen_base → overlay media → PIP camera.

#### Scenario: Render with image overlay
- **WHEN** rendering a project with one image overlay at 5-10s
- **THEN** the ffmpeg command includes the image as an input and an overlay filter with `enable='between(t,5,10)'`

#### Scenario: Render with no overlays
- **WHEN** rendering a project with no overlay segments
- **THEN** the ffmpeg filter chain is unchanged from the existing screen + PIP pipeline

### Requirement: Image overlay input format

Image overlay inputs SHALL use `-loop 1 -t {duration}` flags to create a video stream from a static image. The duration SHALL be the overlay's visible time range (`endTime - startTime`). The image SHALL be scaled to the target `width × height` from the current output mode's position data.

#### Scenario: Image overlay ffmpeg input
- **WHEN** an image overlay spans 5-10s (5 second duration) at 400×300 pixels
- **THEN** the ffmpeg input is: `-loop 1 -t 5 -i {imagePath}` and the filter includes `scale=400:300`

### Requirement: Video overlay input format

Video overlay inputs SHALL use standard `-i {videoPath}` input with trim to the overlay's source time range. The video SHALL be trimmed from `sourceStart` to `sourceEnd` and scaled to the target `width × height`.

#### Scenario: Video overlay ffmpeg input
- **WHEN** a video overlay has sourceStart=2, sourceEnd=8, width=500, height=300
- **THEN** the ffmpeg filter includes `trim=start=2:end=8,setpts=PTS-STARTPTS` on the overlay input, followed by `scale=500:300`

### Requirement: Overlay position in render output

The overlay SHALL be positioned in the render output using the ffmpeg `overlay` filter with `x` and `y` parameters matching the output mode's stored coordinates, scaled from canvas coordinates to output coordinates (using the same `outW/canvasW` and `outH/canvasH` ratios used for PIP positioning).

#### Scenario: Overlay position scaling
- **WHEN** canvas is 1920×1080 and output is 1440×810, overlay at canvas position (384, 216)
- **THEN** overlay render position is scaled: x=384*(1440/1920)=288, y=216*(810/1080)=162

### Requirement: Time-bounded overlay with enable expression

The overlay filter SHALL use `enable='between(t,{startTime},{endTime})'` to restrict the overlay to its time range within the rendered timeline. The time values SHALL be in rendered timeline seconds (after section concatenation).

#### Scenario: Overlay visible only during its time range
- **WHEN** an overlay exists at 5-10s in the rendered timeline
- **THEN** the overlay filter includes `enable='between(t,5.000,10.000)'`

### Requirement: Overlay fade in render

The overlay input SHALL have fade-in and fade-out filters applied before compositing. Fade-in SHALL occur over 0.3s starting at the overlay's `startTime`. Fade-out SHALL occur over 0.3s ending at the overlay's `endTime`.

#### Scenario: Overlay with fade filters
- **WHEN** an overlay spans 5-10s
- **THEN** the overlay input chain includes `fade=in:st=0:d=0.3,fade=out:st=4.7:d=0.3` (times relative to the overlay input's own timeline, where 0 = startTime and 4.7 = duration - 0.3)

### Requirement: Position interpolation between segments in render

When two adjacent overlay segments share the same `mediaPath` with no time gap, the overlay position and size SHALL be interpolated over `TRANSITION_DURATION` (0.3s) before the segment boundary. This SHALL use animated `x`, `y`, `w`, `h` expressions in the overlay filter (with `eval=frame`).

#### Scenario: Smooth movement between split segments
- **WHEN** segment A (5-10s, position 100,100, size 400×300) and segment B (10-15s, position 500,300, size 600×400) share the same mediaPath
- **THEN** the overlay filter uses expressions that interpolate position/size during t=9.7 to t=10.0

#### Scenario: No interpolation for separate media
- **WHEN** two adjacent overlays use different media files
- **THEN** each overlay has independent fade-in/fade-out, no position interpolation

### Requirement: Reel mode overlay rendering

In reel mode, the overlay position SHALL be relative to the reel output dimensions. The overlay's `reel.{x, y, width, height}` values SHALL be used and scaled to the reel output resolution (as determined by `resolveOutputSize` for reel mode). The overlay is composited after the reel crop, within the 9:16 frame.

#### Scenario: Overlay in reel render
- **WHEN** rendering in reel mode with source 1920×1080, overlay at reel position (50, 200, 300, 200)
- **THEN** the overlay position is scaled from 608×1080 canvas to the actual reel output dimensions

### Requirement: Multiple overlays in single render

When multiple non-overlapping overlay segments exist, the render pipeline SHALL handle them correctly. Each overlay segment is a separate time-bounded overlay filter. Segments are chained sequentially — the output of one overlay becomes the input for the next.

#### Scenario: Three overlays in render
- **WHEN** three non-overlapping overlays exist at 2-5s, 8-12s, and 15-20s
- **THEN** three overlay filters are applied in sequence, each with its own enable expression, position, and input

### Requirement: Build overlay filter function

A `buildOverlayFilter(overlays, canvasW, canvasH, outputMode, sourceWidth, sourceHeight)` function SHALL be provided that returns the ffmpeg filter chain fragment for all overlays. This function SHALL be independent of the screen and PIP filter logic, returning a composable filter string.

#### Scenario: No overlays
- **WHEN** `buildOverlayFilter` is called with an empty overlays array
- **THEN** an empty string is returned (no filter modification)

#### Scenario: Single image overlay
- **WHEN** called with one image overlay at 5-10s, position (200, 100, 400, 300)
- **THEN** returns a filter string that scales the image input, applies fade, and overlays with enable and position expressions
