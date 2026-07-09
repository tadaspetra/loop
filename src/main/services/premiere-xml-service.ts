import type { AudioSource, Keyframe, ScreenTransform } from '../../shared/domain/project';
import { computeScreenPlacement } from '../../shared/domain/screen-layout';
import { panToFocusCoord, TRANSITION_DURATION } from './render-filter-service';

export { TRANSITION_DURATION };

export interface PremiereTake {
  id: string;
  screenPath: string;
  cameraPath: string | null;
  // Dedicated audio-only file path, populated when audioSource === 'external'.
  audioPath: string | null;
  // Which file physically owns the mic for this take. Legacy takes default to
  // 'screen' (mic muxed into screen webm). New takes with a camera report
  // 'camera'; screen-only recordings report 'external'. null means no audio.
  audioSource: AudioSource | null;
  // True when the screen file carries a system/desktop audio track separate
  // from the mic (the mic routes via `audioSource`). Drives a second audio
  // track in the Premiere XML so editors can balance the two manually.
  hasSystemAudio: boolean;
  screenDurationSec: number;
  cameraDurationSec: number;
  screenWidth: number;
  screenHeight: number;
  cameraWidth: number | null;
  cameraHeight: number | null;
}

export interface PremiereSection {
  takeId: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface PremiereXmlInput {
  projectName: string;
  canvasW: number;
  canvasH: number;
  fps: number;
  pipSize: number;
  takes: PremiereTake[];
  sections: PremiereSection[];
  keyframes: Keyframe[];
  hasCamera: boolean;
  // Free placement of the screen recording inside the 16:9 sequence
  // (OBS-style). When absent the screen keeps the legacy cover behavior.
  screenTransform?: ScreenTransform | null;
}

const AUTHORING_CANVAS_W = 1920;
const AUTHORING_CANVAS_H = 1080;

export interface ClipLocalKeyframe {
  frame: number;
  pipX: number;
  pipY: number;
  pipVisible: boolean;
  cameraFullscreen: boolean;
  backgroundZoom: number;
  backgroundPanX: number;
  backgroundPanY: number;
}

interface SectionRange {
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = withRoot
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : ''))
    .join('/');
  return `file://${encoded}`;
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

function interpolate(prev: Keyframe | null, next: Keyframe | null, time: number): Keyframe {
  if (!prev && !next) {
    return {
      time,
      pipX: 0,
      pipY: 0,
      pipVisible: true,
      cameraFullscreen: false,
      backgroundZoom: 1,
      backgroundPanX: 0,
      backgroundPanY: 0,
      sectionId: null,
      autoSection: false
    };
  }
  if (!prev) return { ...(next as Keyframe), time };
  if (!next) return { ...prev, time };
  if (next.time <= prev.time) return { ...next, time };

  const ratio = Math.max(0, Math.min(1, (time - prev.time) / (next.time - prev.time)));
  const lerp = (a: number, b: number) => a + (b - a) * ratio;

  return {
    time,
    pipX: lerp(prev.pipX, next.pipX),
    pipY: lerp(prev.pipY, next.pipY),
    pipVisible: ratio < 0.5 ? prev.pipVisible : next.pipVisible,
    cameraFullscreen: ratio < 0.5 ? prev.cameraFullscreen : next.cameraFullscreen,
    backgroundZoom: lerp(prev.backgroundZoom ?? 1, next.backgroundZoom ?? 1),
    backgroundPanX: lerp(prev.backgroundPanX ?? 0, next.backgroundPanX ?? 0),
    backgroundPanY: lerp(prev.backgroundPanY ?? 0, next.backgroundPanY ?? 0),
    sectionId: null,
    autoSection: false
  };
}

function valueAtTime(sorted: Keyframe[], time: number): Keyframe {
  if (sorted.length === 0) {
    return interpolate(null, null, time);
  }
  if (time <= sorted[0].time) return { ...sorted[0], time };
  if (time >= sorted[sorted.length - 1].time) {
    return { ...sorted[sorted.length - 1], time };
  }
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const prev = sorted[index];
    const next = sorted[index + 1];
    if (time >= prev.time && time <= next.time) {
      return interpolate(prev, next, time);
    }
  }
  return { ...sorted[sorted.length - 1], time };
}

/**
 * Inject "hold" keyframes at `next.time - TRANSITION_DURATION` carrying the
 * previous keyframe's values. Combined with linear interpolation between the
 * hold and the next keyframe, this reproduces the editor's short (0.3s) ease
 * between states instead of slowly ramping across the full gap.
 */
export function expandKeyframesWithTransitionHolds(keyframes: Keyframe[]): Keyframe[] {
  if (!Array.isArray(keyframes) || keyframes.length <= 1) return [...keyframes];
  const out: Keyframe[] = [keyframes[0]];
  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = keyframes[index - 1];
    const curr = keyframes[index];
    const holdTime = curr.time - TRANSITION_DURATION;
    if (holdTime > prev.time + 0.001 && holdTime < curr.time - 0.001) {
      out.push({ ...prev, time: holdTime });
    }
    out.push(curr);
  }
  return out;
}

export function clipLocalKeyframesForSection(
  keyframes: Keyframe[],
  section: SectionRange,
  fps: number
): ClipLocalKeyframe[] {
  const sorted = [...keyframes]
    .filter((kf) => Number.isFinite(kf.time))
    .sort((a, b) => a.time - b.time);
  const expanded = expandKeyframesWithTransitionHolds(sorted);

  const clipDurSec = Math.max(0, section.timelineEnd - section.timelineStart);
  const clipDurFrames = secondsToFrames(clipDurSec, fps);

  const timesSet = new Set<number>();
  timesSet.add(section.timelineStart);
  timesSet.add(section.timelineEnd);
  for (const kf of expanded) {
    if (kf.time > section.timelineStart && kf.time < section.timelineEnd) {
      timesSet.add(kf.time);
    }
  }

  const times = Array.from(timesSet).sort((a, b) => a - b);

  return times.map((time) => {
    const kf = valueAtTime(expanded, time);
    const frame = Math.max(
      0,
      Math.min(clipDurFrames, secondsToFrames(time - section.timelineStart, fps))
    );
    return {
      frame,
      pipX: kf.pipX,
      pipY: kf.pipY,
      pipVisible: kf.pipVisible,
      cameraFullscreen: kf.cameraFullscreen,
      backgroundZoom: kf.backgroundZoom,
      backgroundPanX: kf.backgroundPanX,
      backgroundPanY: kf.backgroundPanY
    };
  });
}

/**
 * Scale the camera so that after a square center-crop (via the FCP Crop
 * effect on the clip), the visible square equals the scaled pipSize region.
 * Motion scale operates on the full source frame, so we divide by the shorter
 * source dimension.
 */
export function computeCameraPipScalePercent(
  pipSizeScaled: number,
  cameraWidth: number,
  cameraHeight: number
): number {
  const shorter = Math.min(cameraWidth, cameraHeight);
  if (shorter <= 0) return 100;
  return (pipSizeScaled / shorter) * 100;
}

export function computeSquareCropPercents(
  cameraWidth: number,
  cameraHeight: number
): { left: number; right: number; top: number; bottom: number } {
  if (cameraWidth <= 0 || cameraHeight <= 0) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  const shorter = Math.min(cameraWidth, cameraHeight);
  const horizontalTrim = Math.max(0, (cameraWidth - shorter) / cameraWidth) * 100;
  const verticalTrim = Math.max(0, (cameraHeight - shorter) / cameraHeight) * 100;
  const half = (value: number) => value / 2;
  return {
    left: half(horizontalTrim),
    right: half(horizontalTrim),
    top: half(verticalTrim),
    bottom: half(verticalTrim)
  };
}

/**
 * Cover the canvas with the camera source, preserving aspect; matches the
 * renderer's `force_original_aspect_ratio=increase,crop` behavior in screen space.
 */
export function computeCameraFullScalePercent(
  canvasW: number,
  canvasH: number,
  cameraWidth: number,
  cameraHeight: number
): number {
  if (cameraWidth <= 0 || cameraHeight <= 0) return 100;
  const cover = Math.max(canvasW / cameraWidth, canvasH / cameraHeight);
  return cover * 100;
}

/**
 * Motion scale (percent) needed for a screen capture to cover the sequence
 * frame, preserving aspect. The sequence is authored at 1080p while the screen
 * media keeps its native resolution (e.g. 4K), so the clip is scaled down to
 * fit: 3840px wide media in a 1920px sequence → 50%. Mirrors the renderer's
 * `force_original_aspect_ratio=increase,crop` cover behavior.
 */
export function computeScreenCoverScalePercent(
  canvasW: number,
  canvasH: number,
  screenWidth: number,
  screenHeight: number
): number {
  if (screenWidth <= 0 || screenHeight <= 0) return 100;
  const cover = Math.max(canvasW / screenWidth, canvasH / screenHeight);
  return cover * 100;
}

/**
 * Premiere imports xmeml Basic Motion `<center>` in units of the MEDIA frame
 * size, not the sequence frame: Position = seqCenter + center × mediaDim.
 * (Verified empirically: a 4K camera PiP emitted with sequence-relative units
 * landed at 960 + horiz×3840 — off screen.) Convert a desired on-canvas
 * center (px) into those media-relative units.
 */
export function centerPxToFcpCenter(
  centerPxX: number,
  centerPxY: number,
  canvasW: number,
  canvasH: number,
  mediaW: number,
  mediaH: number
): { horiz: number; vert: number } {
  const horiz = mediaW > 0 ? (centerPxX - canvasW / 2) / mediaW : 0;
  const vert = mediaH > 0 ? (centerPxY - canvasH / 2) / mediaH : 0;
  return { horiz, vert };
}

interface CameraGeom {
  scalePct: number;
  centerPxX: number;
  centerPxY: number;
}

function cameraGeomAt(
  kf: ClipLocalKeyframe,
  input: PremiereXmlInput,
  cameraWidth: number,
  cameraHeight: number
): CameraGeom {
  const { canvasW, canvasH, pipSize } = input;
  const scaleX = canvasW / AUTHORING_CANVAS_W;
  const scaleY = canvasH / AUTHORING_CANVAS_H;
  const pipSizeScaled = pipSize * Math.min(scaleX, scaleY);

  if (kf.cameraFullscreen) {
    return {
      scalePct: computeCameraFullScalePercent(canvasW, canvasH, cameraWidth, cameraHeight),
      centerPxX: canvasW / 2,
      centerPxY: canvasH / 2
    };
  }

  // Match the editor's square PiP center: (pipX + pipSize/2, pipY + pipSize/2)
  // in authoring space, scaled to canvas space.
  const centerPxX = (kf.pipX + pipSize / 2) * scaleX;
  const centerPxY = (kf.pipY + pipSize / 2) * scaleY;
  return {
    scalePct: computeCameraPipScalePercent(pipSizeScaled, cameraWidth, cameraHeight),
    centerPxX,
    centerPxY
  };
}

function numericKeyframeXml(frame: number, value: number, precision = 3): string {
  return (
    `          <keyframe>\n` +
    `            <when>${frame}</when>\n` +
    `            <value>${value.toFixed(precision)}</value>\n` +
    `          </keyframe>`
  );
}

function centerKeyframeXml(frame: number, horiz: number, vert: number): string {
  return (
    `          <keyframe>\n` +
    `            <when>${frame}</when>\n` +
    `            <value>\n` +
    `              <horiz>${horiz.toFixed(6)}</horiz>\n` +
    `              <vert>${vert.toFixed(6)}</vert>\n` +
    `            </value>\n` +
    `          </keyframe>`
  );
}

function emitCameraFilter(
  localKeyframes: ClipLocalKeyframe[],
  input: PremiereXmlInput,
  cameraWidth: number,
  cameraHeight: number
): string {
  const { canvasW, canvasH } = input;
  const squareCrop = computeSquareCropPercents(cameraWidth, cameraHeight);

  const scaleKfs: string[] = [];
  const centerKfs: string[] = [];
  const opacityKfs: string[] = [];
  const cropLeftKfs: string[] = [];
  const cropRightKfs: string[] = [];
  const cropTopKfs: string[] = [];
  const cropBottomKfs: string[] = [];

  // Crop only changes when the camera toggles between PiP (square crop) and
  // fullscreen (no crop). When it stays constant we emit a single static Crop
  // value with no keyframes so the editor can simply delete the Crop filter to
  // recover the full, uncropped camera frame.
  const cropForKf = (kf: ClipLocalKeyframe) =>
    kf.cameraFullscreen ? { left: 0, right: 0, top: 0, bottom: 0 } : squareCrop;
  const cropVaries = localKeyframes.some(
    (kf) => kf.cameraFullscreen !== localKeyframes[0]?.cameraFullscreen
  );

  for (const kf of localKeyframes) {
    const geom = cameraGeomAt(kf, input, cameraWidth, cameraHeight);
    const { horiz, vert } = centerPxToFcpCenter(
      geom.centerPxX,
      geom.centerPxY,
      canvasW,
      canvasH,
      cameraWidth,
      cameraHeight
    );

    scaleKfs.push(numericKeyframeXml(kf.frame, geom.scalePct));
    centerKfs.push(centerKeyframeXml(kf.frame, horiz, vert));
    opacityKfs.push(numericKeyframeXml(kf.frame, kf.pipVisible ? 100 : 0));

    if (cropVaries) {
      const crop = cropForKf(kf);
      cropLeftKfs.push(numericKeyframeXml(kf.frame, crop.left, 4));
      cropRightKfs.push(numericKeyframeXml(kf.frame, crop.right, 4));
      cropTopKfs.push(numericKeyframeXml(kf.frame, crop.top, 4));
      cropBottomKfs.push(numericKeyframeXml(kf.frame, crop.bottom, 4));
    }
  }

  const first = localKeyframes[0];
  const firstGeom = first
    ? cameraGeomAt(first, input, cameraWidth, cameraHeight)
    : { scalePct: 100, centerPxX: canvasW / 2, centerPxY: canvasH / 2 };
  const firstCenter = centerPxToFcpCenter(
    firstGeom.centerPxX,
    firstGeom.centerPxY,
    canvasW,
    canvasH,
    cameraWidth,
    cameraHeight
  );
  const firstOpacity = first ? (first.pipVisible ? 100 : 0) : 100;
  const firstCrop = first ? cropForKf(first) : squareCrop;

  const basicMotion =
    `      <effect>\n` +
    `        <name>Basic Motion</name>\n` +
    `        <effectid>basic</effectid>\n` +
    `        <effectcategory>motion</effectcategory>\n` +
    `        <effecttype>motion</effecttype>\n` +
    `        <mediatype>video</mediatype>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>scale</parameterid>\n` +
    `          <name>Scale</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>1000</valuemax>\n` +
    `          <value>${firstGeom.scalePct.toFixed(3)}</value>\n` +
    `${scaleKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>center</parameterid>\n` +
    `          <name>Center</name>\n` +
    `          <value>\n` +
    `            <horiz>${firstCenter.horiz.toFixed(6)}</horiz>\n` +
    `            <vert>${firstCenter.vert.toFixed(6)}</vert>\n` +
    `          </value>\n` +
    `${centerKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>rotation</parameterid>\n` +
    `          <name>Rotation</name>\n` +
    `          <valuemin>-100000</valuemin>\n` +
    `          <valuemax>100000</valuemax>\n` +
    `          <value>0</value>\n` +
    `        </parameter>\n` +
    `      </effect>`;

  const opacity =
    `      <effect>\n` +
    `        <name>Opacity</name>\n` +
    `        <effectid>opacity</effectid>\n` +
    `        <effectcategory>motion</effectcategory>\n` +
    `        <effecttype>motion</effecttype>\n` +
    `        <mediatype>video</mediatype>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>opacity</parameterid>\n` +
    `          <name>opacity</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>100</valuemax>\n` +
    `          <value>${firstOpacity}</value>\n` +
    `${opacityKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `      </effect>`;

  // FCP7 Crop is a filter/matte, not a motion fixed-effect. Premiere skips the
  // effect if the category/type are wrong (we previously mis-classified it,
  // which left the camera uncropped and made the PiP "float" off the corner).
  const crop =
    `      <effect>\n` +
    `        <name>Crop</name>\n` +
    `        <effectid>crop</effectid>\n` +
    `        <effectcategory>Matte</effectcategory>\n` +
    `        <effecttype>filter</effecttype>\n` +
    `        <mediatype>video</mediatype>\n` +
    `        <parameter>\n` +
    `          <parameterid>left</parameterid>\n` +
    `          <name>Left</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>100</valuemax>\n` +
    `          <value>${firstCrop.left.toFixed(4)}</value>\n` +
    `${cropLeftKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter>\n` +
    `          <parameterid>right</parameterid>\n` +
    `          <name>Right</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>100</valuemax>\n` +
    `          <value>${firstCrop.right.toFixed(4)}</value>\n` +
    `${cropRightKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter>\n` +
    `          <parameterid>top</parameterid>\n` +
    `          <name>Top</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>100</valuemax>\n` +
    `          <value>${firstCrop.top.toFixed(4)}</value>\n` +
    `${cropTopKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter>\n` +
    `          <parameterid>bottom</parameterid>\n` +
    `          <name>Bottom</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>100</valuemax>\n` +
    `          <value>${firstCrop.bottom.toFixed(4)}</value>\n` +
    `${cropBottomKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `      </effect>`;

  return (
    `    <filter>\n${basicMotion}\n    </filter>\n` +
    `    <filter>\n${opacity}\n    </filter>\n` +
    `    <filter>\n${crop}\n    </filter>`
  );
}

interface ScreenGeom {
  scalePct: number;
  centerPxX: number;
  centerPxY: number;
}

/**
 * Effective screen geometry for one keyframe when a free ScreenTransform is
 * set. The editor composes the placement first, then the background zoom
 * crops a window of the composed canvas and scales it back up. In screen
 * space that is p' = (p - windowOrigin) * zoom, so the clip's Motion center
 * and scale can express the exact same result.
 */
function screenGeomAt(
  kf: ClipLocalKeyframe,
  baseScalePct: number,
  baseCenterX: number,
  baseCenterY: number,
  canvasW: number,
  canvasH: number
): ScreenGeom {
  const zoom = Math.max(1, kf.backgroundZoom ?? 1);
  const focusX = panToFocusCoord(zoom, kf.backgroundPanX ?? 0, 0.5);
  const focusY = panToFocusCoord(zoom, kf.backgroundPanY ?? 0, 0.5);
  const originX = Math.max(
    0,
    Math.min(canvasW - canvasW / zoom, focusX * canvasW - canvasW / (2 * zoom))
  );
  const originY = Math.max(
    0,
    Math.min(canvasH - canvasH / zoom, focusY * canvasH - canvasH / (2 * zoom))
  );
  return {
    scalePct: baseScalePct * zoom,
    centerPxX: (baseCenterX - originX) * zoom,
    centerPxY: (baseCenterY - originY) * zoom
  };
}

/**
 * Basic Motion for the screen clip. Covers both the legacy cover placement
 * (no transform) and the free ScreenTransform placement, with background
 * zoom/pan composed exactly the way the editor renders them.
 */
function emitScreenMotionFilter(
  localKeyframes: ClipLocalKeyframe[],
  input: PremiereXmlInput,
  screenWidth: number,
  screenHeight: number
): string | null {
  const transform = input.screenTransform ?? null;
  // With no transform the screen keeps the legacy behavior: cover the
  // sequence frame, preserving aspect.
  const placement = computeScreenPlacement(
    screenWidth,
    screenHeight,
    input.canvasW,
    input.canvasH,
    'fill',
    transform
  );
  if (!placement) return null;

  // Motion scale is relative to the media's native pixel size, so the drawn
  // placement width over the native width gives the uniform base scale.
  const baseScalePct = (placement.width / screenWidth) * 100;
  const baseCenterX = placement.left + placement.width / 2;
  const baseCenterY = placement.top + placement.height / 2;

  const hasZoomPan = localKeyframes.some((kf) => {
    return (
      Math.abs((kf.backgroundZoom ?? 1) - 1) > 0.0001 ||
      Math.abs(kf.backgroundPanX ?? 0) > 0.0001 ||
      Math.abs(kf.backgroundPanY ?? 0) > 0.0001
    );
  });
  // Media that already covers the sequence 1:1, with no zoom/pan animation
  // and no free placement, needs no Motion at all — the editor can treat the
  // clip as untouched.
  if (!transform && !hasZoomPan && Math.abs(baseScalePct - 100) < 0.01) return null;

  const geoms = localKeyframes.map((kf) =>
    screenGeomAt(kf, baseScalePct, baseCenterX, baseCenterY, input.canvasW, input.canvasH)
  );
  const firstGeom = geoms[0] ?? {
    scalePct: baseScalePct,
    centerPxX: baseCenterX,
    centerPxY: baseCenterY
  };
  const varies = geoms.some(
    (geom) =>
      Math.abs(geom.scalePct - firstGeom.scalePct) > 0.001 ||
      Math.abs(geom.centerPxX - firstGeom.centerPxX) > 0.01 ||
      Math.abs(geom.centerPxY - firstGeom.centerPxY) > 0.01
  );

  const scaleKfs: string[] = [];
  const centerKfs: string[] = [];
  if (varies) {
    localKeyframes.forEach((kf, index) => {
      const geom = geoms[index];
      const { horiz, vert } = centerPxToFcpCenter(
        geom.centerPxX,
        geom.centerPxY,
        input.canvasW,
        input.canvasH,
        screenWidth,
        screenHeight
      );
      scaleKfs.push(numericKeyframeXml(kf.frame, geom.scalePct));
      centerKfs.push(centerKeyframeXml(kf.frame, horiz, vert));
    });
  }

  const firstCenter = centerPxToFcpCenter(
    firstGeom.centerPxX,
    firstGeom.centerPxY,
    input.canvasW,
    input.canvasH,
    screenWidth,
    screenHeight
  );
  return screenBasicMotionFilterXml(
    firstGeom.scalePct,
    firstCenter.horiz,
    firstCenter.vert,
    scaleKfs,
    centerKfs
  );
}

function screenBasicMotionFilterXml(
  firstScale: number,
  firstHoriz: number,
  firstVert: number,
  scaleKfs: string[],
  centerKfs: string[]
): string {
  return (
    `    <filter>\n` +
    `      <effect>\n` +
    `        <name>Basic Motion</name>\n` +
    `        <effectid>basic</effectid>\n` +
    `        <effectcategory>motion</effectcategory>\n` +
    `        <effecttype>motion</effecttype>\n` +
    `        <mediatype>video</mediatype>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>scale</parameterid>\n` +
    `          <name>Scale</name>\n` +
    `          <valuemin>0</valuemin>\n` +
    `          <valuemax>1000</valuemax>\n` +
    `          <value>${firstScale.toFixed(3)}</value>\n` +
    `${scaleKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>center</parameterid>\n` +
    `          <name>Center</name>\n` +
    `          <value>\n` +
    `            <horiz>${firstHoriz.toFixed(6)}</horiz>\n` +
    `            <vert>${firstVert.toFixed(6)}</vert>\n` +
    `          </value>\n` +
    `${centerKfs.join('\n')}\n` +
    `        </parameter>\n` +
    `        <parameter authoringApp="PremierePro">\n` +
    `          <parameterid>rotation</parameterid>\n` +
    `          <name>Rotation</name>\n` +
    `          <valuemin>-100000</valuemin>\n` +
    `          <valuemax>100000</valuemax>\n` +
    `          <value>0</value>\n` +
    `        </parameter>\n` +
    `      </effect>\n` +
    `    </filter>`
  );
}

interface FileAssetInfo {
  id: string;
  name: string;
  pathUrl: string;
  durationFrames: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

function emitFileAsset(info: FileAssetInfo, fps: number, emitted: Set<string>): string {
  if (emitted.has(info.id)) {
    return `      <file id="${info.id}"/>`;
  }
  emitted.add(info.id);
  const audioBlock = info.hasAudio
    ? `          <audio>\n` +
      `            <samplecharacteristics>\n` +
      `              <depth>16</depth>\n` +
      `              <samplerate>48000</samplerate>\n` +
      `            </samplecharacteristics>\n` +
      `            <channelcount>2</channelcount>\n` +
      `          </audio>\n`
    : '';
  // Audio-only assets (width/height of 0, e.g. the dedicated mic WAV) must not
  // declare a zero-size video stream — Premiere can mis-conform such a file and
  // drive the imported audio hot. Emit only the audio characteristics instead.
  const isAudioOnly = info.width <= 0 || info.height <= 0;
  const videoBlock = isAudioOnly
    ? ''
    : `          <video>\n` +
      `            <samplecharacteristics>\n` +
      `              <rate>\n` +
      `                <timebase>${fps}</timebase>\n` +
      `                <ntsc>FALSE</ntsc>\n` +
      `              </rate>\n` +
      `              <width>${info.width}</width>\n` +
      `              <height>${info.height}</height>\n` +
      `              <pixelaspectratio>square</pixelaspectratio>\n` +
      `            </samplecharacteristics>\n` +
      `          </video>\n`;
  return (
    `      <file id="${info.id}">\n` +
    `        <name>${escapeXml(info.name)}</name>\n` +
    `        <pathurl>${escapeXml(info.pathUrl)}</pathurl>\n` +
    `        <rate>\n` +
    `          <timebase>${fps}</timebase>\n` +
    `          <ntsc>FALSE</ntsc>\n` +
    `        </rate>\n` +
    `        <duration>${info.durationFrames}</duration>\n` +
    `        <media>\n` +
    videoBlock +
    audioBlock +
    `        </media>\n` +
    `      </file>`
  );
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function emitScreenClip(params: {
  clipIndex: number;
  section: PremiereSection;
  take: PremiereTake;
  fps: number;
  emittedFiles: Set<string>;
  input: PremiereXmlInput;
}): string {
  const { clipIndex, section, take, fps, emittedFiles, input } = params;
  const fileId = `file-screen-${take.id}`;
  const durationFrames = secondsToFrames(take.screenDurationSec, fps);
  const inFrames = secondsToFrames(section.sourceStart, fps);
  const outFrames = secondsToFrames(section.sourceEnd, fps);
  const startFrames = secondsToFrames(section.timelineStart, fps);
  const endFrames = secondsToFrames(section.timelineEnd, fps);

  const fileAsset = emitFileAsset(
    {
      id: fileId,
      name: basename(take.screenPath),
      pathUrl: pathToFileUrl(take.screenPath),
      durationFrames,
      width: take.screenWidth,
      height: take.screenHeight,
      // Screen file carries audio either for legacy takes (mic muxed into
      // screen) or for new takes with captured system audio. New camera/
      // external takes without system audio have a silent screen webm.
      hasAudio: take.audioSource === 'screen' || take.hasSystemAudio
    },
    fps,
    emittedFiles
  );

  const localKfs = clipLocalKeyframesForSection(input.keyframes, section, fps);
  const screenFilter = emitScreenMotionFilter(
    localKfs,
    input,
    take.screenWidth,
    take.screenHeight
  );

  return (
    `  <clipitem id="clipitem-screen-${clipIndex}">\n` +
    `    <name>${escapeXml(basename(take.screenPath))}</name>\n` +
    `    <enabled>TRUE</enabled>\n` +
    `    <duration>${durationFrames}</duration>\n` +
    `    <rate>\n` +
    `      <timebase>${fps}</timebase>\n` +
    `      <ntsc>FALSE</ntsc>\n` +
    `    </rate>\n` +
    `    <in>${inFrames}</in>\n` +
    `    <out>${outFrames}</out>\n` +
    `    <start>${startFrames}</start>\n` +
    `    <end>${endFrames}</end>\n` +
    `${fileAsset}\n` +
    `    <sourcetrack>\n` +
    `      <mediatype>video</mediatype>\n` +
    `      <trackindex>1</trackindex>\n` +
    `    </sourcetrack>\n` +
    (screenFilter ? `${screenFilter}\n` : '') +
    `  </clipitem>`
  );
}

function emitCameraClip(params: {
  clipIndex: number;
  section: PremiereSection;
  take: PremiereTake;
  fps: number;
  emittedFiles: Set<string>;
  input: PremiereXmlInput;
}): string | null {
  const { clipIndex, section, take, fps, emittedFiles, input } = params;
  if (!take.cameraPath) return null;

  const cameraW = take.cameraWidth ?? AUTHORING_CANVAS_W;
  const cameraH = take.cameraHeight ?? AUTHORING_CANVAS_H;

  const fileId = `file-camera-${take.id}`;
  const durationFrames = secondsToFrames(take.cameraDurationSec, fps);
  const inFrames = secondsToFrames(section.sourceStart, fps);
  const outFrames = secondsToFrames(section.sourceEnd, fps);
  const startFrames = secondsToFrames(section.timelineStart, fps);
  const endFrames = secondsToFrames(section.timelineEnd, fps);

  const fileAsset = emitFileAsset(
    {
      id: fileId,
      name: basename(take.cameraPath),
      pathUrl: pathToFileUrl(take.cameraPath),
      durationFrames,
      width: cameraW,
      height: cameraH,
      // Camera file owns the mic when audioSource === 'camera' (new default
      // for camera+mic takes). Legacy camera files were always silent.
      hasAudio: take.audioSource === 'camera'
    },
    fps,
    emittedFiles
  );

  const localKfs = clipLocalKeyframesForSection(input.keyframes, section, fps);
  const cameraFilter = emitCameraFilter(localKfs, input, cameraW, cameraH);

  return (
    `  <clipitem id="clipitem-camera-${clipIndex}">\n` +
    `    <name>${escapeXml(basename(take.cameraPath))}</name>\n` +
    `    <enabled>TRUE</enabled>\n` +
    `    <duration>${durationFrames}</duration>\n` +
    `    <rate>\n` +
    `      <timebase>${fps}</timebase>\n` +
    `      <ntsc>FALSE</ntsc>\n` +
    `    </rate>\n` +
    `    <in>${inFrames}</in>\n` +
    `    <out>${outFrames}</out>\n` +
    `    <start>${startFrames}</start>\n` +
    `    <end>${endFrames}</end>\n` +
    `${fileAsset}\n` +
    `    <sourcetrack>\n` +
    `      <mediatype>video</mediatype>\n` +
    `      <trackindex>1</trackindex>\n` +
    `    </sourcetrack>\n` +
    `${cameraFilter}\n` +
    `  </clipitem>`
  );
}

interface ResolvedAudioSource {
  fileId: string;
  path: string;
  durationFrames: number;
  width: number;
  height: number;
}

function resolvePremiereAudioSource(
  take: PremiereTake,
  fps: number
): ResolvedAudioSource | null {
  if (take.audioSource === 'camera' && take.cameraPath) {
    return {
      fileId: `file-camera-${take.id}`,
      path: take.cameraPath,
      durationFrames: secondsToFrames(take.cameraDurationSec, fps),
      width: take.cameraWidth ?? AUTHORING_CANVAS_W,
      height: take.cameraHeight ?? AUTHORING_CANVAS_H
    };
  }
  if (take.audioSource === 'external' && take.audioPath) {
    return {
      fileId: `file-audio-${take.id}`,
      path: take.audioPath,
      // Audio-only assets mirror the screen duration since they are recorded
      // concurrently with the screen and share the same timeline window.
      durationFrames: secondsToFrames(take.screenDurationSec, fps),
      width: 0,
      height: 0
    };
  }
  if (take.audioSource === 'screen' && take.screenPath) {
    return {
      fileId: `file-screen-${take.id}`,
      path: take.screenPath,
      durationFrames: secondsToFrames(take.screenDurationSec, fps),
      width: 0,
      height: 0
    };
  }
  return null;
}

function emitSystemAudioClip(params: {
  clipIndex: number;
  section: PremiereSection;
  take: PremiereTake;
  fps: number;
  emittedFiles: Set<string>;
}): string | null {
  const { clipIndex, section, take, fps, emittedFiles } = params;
  if (!take.hasSystemAudio || !take.screenPath) return null;
  // When the mic already lives on the screen file (legacy), the primary audio
  // clip covers it — a second identical clip would just duplicate playback.
  if (take.audioSource === 'screen') return null;

  const fileId = `file-screen-${take.id}`;
  const durationFrames = secondsToFrames(take.screenDurationSec, fps);
  const inFrames = secondsToFrames(section.sourceStart, fps);
  const outFrames = secondsToFrames(section.sourceEnd, fps);
  const startFrames = secondsToFrames(section.timelineStart, fps);
  const endFrames = secondsToFrames(section.timelineEnd, fps);

  const fileAsset = emitFileAsset(
    {
      id: fileId,
      name: basename(take.screenPath),
      pathUrl: pathToFileUrl(take.screenPath),
      durationFrames,
      width: take.screenWidth,
      height: take.screenHeight,
      hasAudio: true
    },
    fps,
    emittedFiles
  );

  return (
    `  <clipitem id="clipitem-sysaudio-${clipIndex}">\n` +
    `    <name>${escapeXml(basename(take.screenPath))}</name>\n` +
    `    <enabled>TRUE</enabled>\n` +
    `    <duration>${durationFrames}</duration>\n` +
    `    <rate>\n` +
    `      <timebase>${fps}</timebase>\n` +
    `      <ntsc>FALSE</ntsc>\n` +
    `    </rate>\n` +
    `    <in>${inFrames}</in>\n` +
    `    <out>${outFrames}</out>\n` +
    `    <start>${startFrames}</start>\n` +
    `    <end>${endFrames}</end>\n` +
    `${fileAsset}\n` +
    `    <sourcetrack>\n` +
    `      <mediatype>audio</mediatype>\n` +
    `      <trackindex>1</trackindex>\n` +
    `    </sourcetrack>\n` +
    `  </clipitem>`
  );
}

function emitAudioClip(params: {
  clipIndex: number;
  section: PremiereSection;
  take: PremiereTake;
  fps: number;
  emittedFiles: Set<string>;
}): string | null {
  const { clipIndex, section, take, fps, emittedFiles } = params;
  const source = resolvePremiereAudioSource(take, fps);
  // Takes recorded without a mic (audioSource === null / missing file) have
  // nothing to emit on the audio track; skipping keeps Premiere from trying
  // to reference a missing file.
  if (!source) return null;
  const inFrames = secondsToFrames(section.sourceStart, fps);
  const outFrames = secondsToFrames(section.sourceEnd, fps);
  const startFrames = secondsToFrames(section.timelineStart, fps);
  const endFrames = secondsToFrames(section.timelineEnd, fps);

  const fileAsset = emitFileAsset(
    {
      id: source.fileId,
      name: basename(source.path),
      pathUrl: pathToFileUrl(source.path),
      durationFrames: source.durationFrames,
      width: source.width,
      height: source.height,
      hasAudio: true
    },
    fps,
    emittedFiles
  );

  return (
    `  <clipitem id="clipitem-audio-${clipIndex}">\n` +
    `    <name>${escapeXml(basename(source.path))}</name>\n` +
    `    <enabled>TRUE</enabled>\n` +
    `    <duration>${source.durationFrames}</duration>\n` +
    `    <rate>\n` +
    `      <timebase>${fps}</timebase>\n` +
    `      <ntsc>FALSE</ntsc>\n` +
    `    </rate>\n` +
    `    <in>${inFrames}</in>\n` +
    `    <out>${outFrames}</out>\n` +
    `    <start>${startFrames}</start>\n` +
    `    <end>${endFrames}</end>\n` +
    `${fileAsset}\n` +
    `    <sourcetrack>\n` +
    `      <mediatype>audio</mediatype>\n` +
    `      <trackindex>1</trackindex>\n` +
    `    </sourcetrack>\n` +
    `  </clipitem>`
  );
}

function indent(block: string, prefix: string): string {
  return block
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

export function buildPremiereXml(input: PremiereXmlInput): string {
  const fps = Math.max(1, Math.round(input.fps));
  const takeMap = new Map<string, PremiereTake>();
  for (const take of input.takes) takeMap.set(take.id, take);

  const totalDurationSec = input.sections.reduce(
    (max, section) => Math.max(max, section.timelineEnd),
    0
  );
  const totalDurationFrames = secondsToFrames(totalDurationSec, fps);

  const emittedFiles = new Set<string>();

  const screenClips: string[] = [];
  const cameraClips: string[] = [];
  const audioClips: string[] = [];
  const systemAudioClips: string[] = [];

  input.sections.forEach((section, index) => {
    const take = takeMap.get(section.takeId);
    if (!take) return;
    screenClips.push(
      emitScreenClip({ clipIndex: index, section, take, fps, emittedFiles, input })
    );
    if (input.hasCamera && take.cameraPath) {
      const cam = emitCameraClip({ clipIndex: index, section, take, fps, emittedFiles, input });
      if (cam) cameraClips.push(cam);
    }
    const audioClip = emitAudioClip({ clipIndex: index, section, take, fps, emittedFiles });
    if (audioClip) audioClips.push(audioClip);
    const sysAudioClip = emitSystemAudioClip({
      clipIndex: index,
      section,
      take,
      fps,
      emittedFiles
    });
    if (sysAudioClip) systemAudioClips.push(sysAudioClip);
  });

  const videoTracks: string[] = [];
  videoTracks.push(
    `      <track>\n` +
      `        <enabled>TRUE</enabled>\n` +
      `        <locked>FALSE</locked>\n` +
      `${indent(screenClips.join('\n'), '      ')}\n` +
      `      </track>`
  );
  if (input.hasCamera && cameraClips.length > 0) {
    videoTracks.push(
      `      <track>\n` +
        `        <enabled>TRUE</enabled>\n` +
        `        <locked>FALSE</locked>\n` +
        `${indent(cameraClips.join('\n'), '      ')}\n` +
        `      </track>`
    );
  }

  const audioTracks: string[] = [];
  audioTracks.push(
    `      <track>\n` +
      `        <enabled>TRUE</enabled>\n` +
      `        <locked>FALSE</locked>\n` +
      `${indent(audioClips.join('\n'), '      ')}\n` +
      `      </track>`
  );
  if (systemAudioClips.length > 0) {
    // System audio lives on its own track so editors can mute/level it
    // independently of the mic.
    audioTracks.push(
      `      <track>\n` +
        `        <enabled>TRUE</enabled>\n` +
        `        <locked>FALSE</locked>\n` +
        `${indent(systemAudioClips.join('\n'), '      ')}\n` +
        `      </track>`
    );
  }
  const audioTrack = audioTracks.join('\n');

  // Declare an explicit stereo / 48kHz / 16-bit audio master with a 2-channel
  // output group. Without this, Premiere guesses the sequence's audio master
  // when importing the xmeml and can default to a mono/odd configuration; any
  // footage the editor later drops into the sequence then gets summed/boosted
  // and clips even though the source files are clean.
  const audioMaster =
    `        <numOutputChannels>2</numOutputChannels>\n` +
    `        <format>\n` +
    `          <samplecharacteristics>\n` +
    `            <depth>16</depth>\n` +
    `            <samplerate>48000</samplerate>\n` +
    `          </samplecharacteristics>\n` +
    `        </format>\n` +
    `        <outputs>\n` +
    `          <group>\n` +
    `            <index>1</index>\n` +
    `            <numchannels>2</numchannels>\n` +
    `            <downmix>0</downmix>\n` +
    `            <channel>\n` +
    `              <index>1</index>\n` +
    `            </channel>\n` +
    `            <channel>\n` +
    `              <index>2</index>\n` +
    `            </channel>\n` +
    `          </group>\n` +
    `        </outputs>`;

  const sequenceName = escapeXml(input.projectName || 'Loop Sequence');
  const sequenceId = `sequence-1`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE xmeml>\n` +
    `<xmeml version="5">\n` +
    `  <sequence id="${sequenceId}">\n` +
    `    <name>${sequenceName}</name>\n` +
    `    <duration>${totalDurationFrames}</duration>\n` +
    `    <rate>\n` +
    `      <timebase>${fps}</timebase>\n` +
    `      <ntsc>FALSE</ntsc>\n` +
    `    </rate>\n` +
    `    <media>\n` +
    `      <video>\n` +
    `        <format>\n` +
    `          <samplecharacteristics>\n` +
    `            <rate>\n` +
    `              <timebase>${fps}</timebase>\n` +
    `              <ntsc>FALSE</ntsc>\n` +
    `            </rate>\n` +
    `            <width>${input.canvasW}</width>\n` +
    `            <height>${input.canvasH}</height>\n` +
    `            <pixelaspectratio>square</pixelaspectratio>\n` +
    `            <fielddominance>none</fielddominance>\n` +
    `            <colordepth>24</colordepth>\n` +
    `          </samplecharacteristics>\n` +
    `        </format>\n` +
    `${videoTracks.join('\n')}\n` +
    `      </video>\n` +
    `      <audio>\n` +
    `${audioMaster}\n` +
    `${audioTrack}\n` +
    `      </audio>\n` +
    `    </media>\n` +
    `  </sequence>\n` +
    `</xmeml>\n`
  );
}
