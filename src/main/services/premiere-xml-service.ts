import type { Keyframe } from '../../shared/domain/project';
import { TRANSITION_DURATION } from './render-filter-service';

export { TRANSITION_DURATION };

export interface PremiereTake {
  id: string;
  screenPath: string;
  cameraPath: string | null;
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

export function centerPxToFcpCenter(
  centerPxX: number,
  centerPxY: number,
  canvasW: number,
  canvasH: number
): { horiz: number; vert: number } {
  const horiz = canvasW > 0 ? (2 * centerPxX - canvasW) / canvasW : 0;
  const vert = canvasH > 0 ? (2 * centerPxY - canvasH) / canvasH : 0;
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

  for (const kf of localKeyframes) {
    const geom = cameraGeomAt(kf, input, cameraWidth, cameraHeight);
    const { horiz, vert } = centerPxToFcpCenter(
      geom.centerPxX,
      geom.centerPxY,
      canvasW,
      canvasH
    );

    scaleKfs.push(numericKeyframeXml(kf.frame, geom.scalePct));
    centerKfs.push(centerKeyframeXml(kf.frame, horiz, vert));
    opacityKfs.push(numericKeyframeXml(kf.frame, kf.pipVisible ? 100 : 0));

    // Square-crop while in PiP so the visible region matches the editor's
    // square PiP footprint; drop crop to 0 when fullscreen so the camera fills.
    const crop = kf.cameraFullscreen
      ? { left: 0, right: 0, top: 0, bottom: 0 }
      : squareCrop;
    cropLeftKfs.push(numericKeyframeXml(kf.frame, crop.left, 4));
    cropRightKfs.push(numericKeyframeXml(kf.frame, crop.right, 4));
    cropTopKfs.push(numericKeyframeXml(kf.frame, crop.top, 4));
    cropBottomKfs.push(numericKeyframeXml(kf.frame, crop.bottom, 4));
  }

  const first = localKeyframes[0];
  const firstGeom = first
    ? cameraGeomAt(first, input, cameraWidth, cameraHeight)
    : { scalePct: 100, centerPxX: canvasW / 2, centerPxY: canvasH / 2 };
  const firstCenter = centerPxToFcpCenter(
    firstGeom.centerPxX,
    firstGeom.centerPxY,
    canvasW,
    canvasH
  );
  const firstOpacity = first ? (first.pipVisible ? 100 : 0) : 100;
  const firstCrop = first && !first.cameraFullscreen ? squareCrop : squareCrop;

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

function emitScreenFilter(localKeyframes: ClipLocalKeyframe[]): string | null {
  const hasChange = localKeyframes.some((kf) => {
    return (
      Math.abs((kf.backgroundZoom ?? 1) - 1) > 0.0001 ||
      Math.abs(kf.backgroundPanX ?? 0) > 0.0001 ||
      Math.abs(kf.backgroundPanY ?? 0) > 0.0001
    );
  });
  if (!hasChange) return null;

  const scaleKfs: string[] = [];
  const centerKfs: string[] = [];

  for (const kf of localKeyframes) {
    const zoomPct = Math.max(1, kf.backgroundZoom ?? 1) * 100;
    const horiz = kf.backgroundPanX ?? 0;
    const vert = kf.backgroundPanY ?? 0;

    scaleKfs.push(
      `          <keyframe>\n` +
        `            <when>${kf.frame}</when>\n` +
        `            <value>${zoomPct.toFixed(3)}</value>\n` +
        `          </keyframe>`
    );
    centerKfs.push(
      `          <keyframe>\n` +
        `            <when>${kf.frame}</when>\n` +
        `            <value>\n` +
        `              <horiz>${horiz.toFixed(6)}</horiz>\n` +
        `              <vert>${vert.toFixed(6)}</vert>\n` +
        `            </value>\n` +
        `          </keyframe>`
    );
  }

  const first = localKeyframes[0];
  const firstScale = first ? Math.max(1, first.backgroundZoom ?? 1) * 100 : 100;
  const firstHoriz = first ? first.backgroundPanX ?? 0 : 0;
  const firstVert = first ? first.backgroundPanY ?? 0 : 0;

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
    `          <video>\n` +
    `            <samplecharacteristics>\n` +
    `              <rate>\n` +
    `                <timebase>${fps}</timebase>\n` +
    `                <ntsc>FALSE</ntsc>\n` +
    `              </rate>\n` +
    `              <width>${info.width}</width>\n` +
    `              <height>${info.height}</height>\n` +
    `              <pixelaspectratio>square</pixelaspectratio>\n` +
    `            </samplecharacteristics>\n` +
    `          </video>\n` +
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
      hasAudio: true
    },
    fps,
    emittedFiles
  );

  const localKfs = clipLocalKeyframesForSection(input.keyframes, section, fps);
  const screenFilter = emitScreenFilter(localKfs);

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
      hasAudio: false
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

function emitAudioClip(params: {
  clipIndex: number;
  section: PremiereSection;
  take: PremiereTake;
  fps: number;
  emittedFiles: Set<string>;
}): string {
  const { clipIndex, section, take, fps, emittedFiles } = params;
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
      width: 0,
      height: 0,
      hasAudio: true
    },
    fps,
    emittedFiles
  );

  return (
    `  <clipitem id="clipitem-audio-${clipIndex}">\n` +
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
    audioClips.push(emitAudioClip({ clipIndex: index, section, take, fps, emittedFiles }));
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

  const audioTrack =
    `      <track>\n` +
    `        <enabled>TRUE</enabled>\n` +
    `        <locked>FALSE</locked>\n` +
    `${indent(audioClips.join('\n'), '      ')}\n` +
    `      </track>`;

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
    `${audioTrack}\n` +
    `      </audio>\n` +
    `    </media>\n` +
    `  </sequence>\n` +
    `</xmeml>\n`
  );
}
