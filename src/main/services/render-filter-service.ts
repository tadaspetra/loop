import type { Keyframe, ScreenFitMode } from '../../shared/domain/project';

export const TRANSITION_DURATION = 0.3;
const AUTHORING_CANVAS_W = 1920;
const AUTHORING_CANVAS_H = 1080;

function easeExpr(timeVar: string, start: number): string {
  const progress = `(${timeVar}-${start.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)}`;
  return `if(lt(${progress},0.5),2*${progress}*${progress},1-pow(-2*${progress}+2,2)/2)`;
}

interface KeyframeProp extends Keyframe {
  backgroundFocusX?: number;
  backgroundFocusY?: number;
}

function collapseConsecutiveKeyframes<T extends Keyframe>(
  keyframes: T[],
  isSame: (prev: T, curr: T) => boolean
): T[] {
  if (!Array.isArray(keyframes) || keyframes.length <= 1) return keyframes;

  const collapsed = [keyframes[0]];
  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = collapsed[collapsed.length - 1];
    const curr = keyframes[index];
    if (!isSame(prev, curr)) collapsed.push(curr);
  }
  return collapsed;
}

function roundToEven(value: number): number {
  const rounded = Math.round(value);
  if (rounded <= 2) return 2;
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function resolveOutputSize(sourceWidth: number, sourceHeight: number) {
  const outW = roundToEven(sourceWidth);
  const outH = roundToEven(sourceHeight);
  return { outW, outH };
}

export function buildNumericExpr(
  keyframes: KeyframeProp[],
  prop: keyof KeyframeProp,
  precision = 3,
  defaultValue = 0,
  timeVar = 't'
): string {
  const relevantKeyframes = collapseConsecutiveKeyframes(keyframes, (prev, curr) => {
    const prevVal = Number.isFinite(Number(prev?.[prop])) ? Number(prev[prop]) : defaultValue;
    const currVal = Number.isFinite(Number(curr?.[prop])) ? Number(curr[prop]) : defaultValue;
    return Math.abs(prevVal - currVal) <= 0.0001;
  });

  const firstValue = Number.isFinite(Number(relevantKeyframes[0]?.[prop]))
    ? Number(relevantKeyframes[0][prop])
    : defaultValue;
  if (relevantKeyframes.length === 1) return firstValue.toFixed(precision);

  let expr = firstValue.toFixed(precision);
  for (let index = 1; index < relevantKeyframes.length; index += 1) {
    const prev = relevantKeyframes[index - 1];
    const curr = relevantKeyframes[index];
    const prevVal = Number.isFinite(Number(prev?.[prop])) ? Number(prev[prop]) : defaultValue;
    const currVal = Number.isFinite(Number(curr?.[prop])) ? Number(curr[prop]) : defaultValue;
    const time = curr.time;
    const start = time - TRANSITION_DURATION;
    const diff = currVal - prevVal;

    if (Math.abs(diff) > 0.0001) {
      const eased = easeExpr(timeVar, start);
      expr = `if(gte(${timeVar},${time.toFixed(3)}),${currVal.toFixed(precision)},if(gte(${timeVar},${start.toFixed(3)}),${prevVal.toFixed(precision)}+${diff.toFixed(precision)}*${eased},${expr}))`;
    } else {
      expr = `if(gte(${timeVar},${time.toFixed(3)}),${currVal.toFixed(precision)},${expr})`;
    }
  }
  return expr;
}

export function panToFocusCoord(zoom: unknown, pan: unknown, defaultCoord = 0.5): number {
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;
  const normalizedPan = Number.isFinite(Number(pan)) ? Number(pan) : 0;
  if (normalizedZoom <= 1.0001) return defaultCoord;
  const cropFraction = 1 / normalizedZoom;
  return cropFraction / 2 + ((normalizedPan + 1) / 2) * (1 - cropFraction);
}

export function buildPosExpr(keyframes: Keyframe[], prop: 'pipX' | 'pipY'): string {
  const relevantKeyframes = collapseConsecutiveKeyframes(keyframes, (prev, curr) => {
    const prevVisible = prev.pipVisible !== undefined ? prev.pipVisible : true;
    const currVisible = curr.pipVisible !== undefined ? curr.pipVisible : true;
    return (
      Math.round(prev[prop]) === Math.round(curr[prop]) &&
      (prev.cameraFullscreen || false) === (curr.cameraFullscreen || false) &&
      prevVisible === currVisible
    );
  });

  if (relevantKeyframes.length === 1) {
    return String(Math.round(relevantKeyframes[0][prop]));
  }

  let expr = String(Math.round(relevantKeyframes[0][prop]));
  for (let index = 1; index < relevantKeyframes.length; index += 1) {
    const prev = relevantKeyframes[index - 1];
    const curr = relevantKeyframes[index];
    const prevVal = Math.round(prev[prop]);
    const currVal = Math.round(curr[prop]);
    const time = curr.time;
    const prevFull = prev.cameraFullscreen || false;
    const currFull = curr.cameraFullscreen || false;
    const prevVisible = prev.pipVisible !== undefined ? prev.pipVisible : true;
    const currVisible = curr.pipVisible !== undefined ? curr.pipVisible : true;

    if ((prevFull && !currFull) || (!prevVisible && currVisible)) {
      const start = time - TRANSITION_DURATION;
      expr = `if(gte(t,${start.toFixed(3)}),${currVal},${expr})`;
    } else if (prevVal !== currVal && !prevFull && !currFull) {
      const start = time - TRANSITION_DURATION;
      const diff = currVal - prevVal;
      const eased = easeExpr('t', start);
      expr = `if(gte(t,${time.toFixed(3)}),${currVal},if(gte(t,${start.toFixed(3)}),${prevVal}+${diff}*${eased},${expr}))`;
    } else {
      expr = `if(gte(t,${time.toFixed(3)}),${currVal},${expr})`;
    }
  }
  return expr;
}

export function buildAlphaExpr(keyframes: Keyframe[]): string {
  const relevantKeyframes = collapseConsecutiveKeyframes(
    keyframes,
    (prev, curr) => prev.pipVisible === curr.pipVisible
  );
  if (relevantKeyframes.length === 1) return relevantKeyframes[0].pipVisible ? '1' : '0';

  let expr = relevantKeyframes[0].pipVisible ? '1' : '0';
  for (let index = 1; index < relevantKeyframes.length; index += 1) {
    const prev = relevantKeyframes[index - 1];
    const curr = relevantKeyframes[index];
    const time = curr.time;

    if (prev.pipVisible !== curr.pipVisible) {
      const start = time - TRANSITION_DURATION;
      const eased = easeExpr('T', start);
      if (curr.pipVisible) {
        expr = `if(gte(T,${time.toFixed(3)}),1,if(gte(T,${start.toFixed(3)}),${eased},${expr}))`;
      } else {
        expr = `if(gte(T,${time.toFixed(3)}),0,if(gte(T,${start.toFixed(3)}),1-${eased},${expr}))`;
      }
    } else {
      expr = `if(gte(T,${time.toFixed(3)}),${curr.pipVisible ? '1' : '0'},${expr})`;
    }
  }
  return expr;
}

export function buildCamFullAlphaExpr(keyframes: Keyframe[]): string {
  const isFullVisible = (keyframe: Keyframe) =>
    (keyframe.cameraFullscreen || false) && keyframe.pipVisible;

  const relevantKeyframes = collapseConsecutiveKeyframes(
    keyframes,
    (prev, curr) => isFullVisible(prev) === isFullVisible(curr)
  );
  if (relevantKeyframes.length === 1) return isFullVisible(relevantKeyframes[0]) ? '1' : '0';

  let expr = isFullVisible(relevantKeyframes[0]) ? '1' : '0';
  for (let index = 1; index < relevantKeyframes.length; index += 1) {
    const prev = relevantKeyframes[index - 1];
    const curr = relevantKeyframes[index];
    const time = curr.time;
    const start = time - TRANSITION_DURATION;
    const prevFull = isFullVisible(prev);
    const currFull = isFullVisible(curr);

    if (prevFull !== currFull) {
      const eased = easeExpr('T', start);
      if (currFull) {
        expr = `if(gte(T,${time.toFixed(3)}),1,if(gte(T,${start.toFixed(3)}),${eased},${expr}))`;
      } else {
        expr = `if(gte(T,${time.toFixed(3)}),0,if(gte(T,${start.toFixed(3)}),1-${eased},${expr}))`;
      }
    } else {
      expr = `if(gte(T,${time.toFixed(3)}),${currFull ? '1' : '0'},${expr})`;
    }
  }
  return expr;
}

export function buildScreenFilter(
  keyframes: Keyframe[],
  screenFitMode: ScreenFitMode,
  _sourceWidth: number,
  _sourceHeight: number,
  canvasW: number,
  canvasH: number,
  outputLabel = '[screen]',
  targetFps = 30
): string {
  const { outW, outH } = resolveOutputSize(canvasW, canvasH);
  const normalizedKeyframes = (Array.isArray(keyframes) ? keyframes : []).map((keyframe) => ({
    ...keyframe,
    backgroundZoom: Number.isFinite(Number(keyframe?.backgroundZoom))
      ? Number(keyframe.backgroundZoom)
      : 1,
    backgroundPanX: Number.isFinite(Number(keyframe?.backgroundPanX))
      ? Number(keyframe.backgroundPanX)
      : 0,
    backgroundPanY: Number.isFinite(Number(keyframe?.backgroundPanY))
      ? Number(keyframe.backgroundPanY)
      : 0,
    backgroundFocusX: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanX, 0.5),
    backgroundFocusY: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanY, 0.5)
  }));

  const baseFilter =
    screenFitMode === 'fill'
      ? `[0:v]scale=${outW}:${outH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${outH}[screen_base]`
      : `[0:v]scale=${outW}:${outH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:'(ow-iw)/2':'(oh-ih)/2':color=black[screen_base]`;

  const hasBackgroundAnimation = normalizedKeyframes.some((keyframe) => {
    return (
      Math.abs(keyframe.backgroundZoom - 1) > 0.0001 ||
      Math.abs(keyframe.backgroundPanX) > 0.0001 ||
      Math.abs(keyframe.backgroundPanY) > 0.0001
    );
  });

  if (!hasBackgroundAnimation) {
    return baseFilter.replace('[screen_base]', outputLabel);
  }

  const zoomExpr = buildNumericExpr(normalizedKeyframes, 'backgroundZoom', 3, 1, 'it');
  const focusXExpr = buildNumericExpr(normalizedKeyframes, 'backgroundFocusX', 6, 0.5, 'it');
  const focusYExpr = buildNumericExpr(normalizedKeyframes, 'backgroundFocusY', 6, 0.5, 'it');
  const animatedFilter = `[screen_base]zoompan=z='${zoomExpr}':x='max(0,min(iw-iw/zoom,iw*(${focusXExpr})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${focusYExpr})-ih/zoom/2))':d=1:s=${outW}x${outH}:fps=${targetFps},setsar=1${outputLabel}`;
  return `${baseFilter};${animatedFilter}`;
}

export function buildFilterComplex(
  keyframes: Keyframe[],
  pipSize: number,
  screenFitMode: ScreenFitMode,
  sourceWidth: number,
  sourceHeight: number,
  canvasW: number,
  canvasH: number,
  targetFps = 30
): string {
  const { outW, outH } = resolveOutputSize(canvasW, canvasH);
  const scaleX = outW / AUTHORING_CANVAS_W;
  const scaleY = outH / AUTHORING_CANVAS_H;

  // Compose in the same fixed canvas space as the editor preview so exported
  // screen fit, PiP size, and PiP coordinates match authored values exactly.
  // Larger exports scale authored overlay geometry proportionally.
  const actualPipSize = roundToEven(pipSize * scaleX);
  const radius = Math.max(1, Math.round(12 * scaleX));
  const maxCoord = actualPipSize - 1 - radius;
  const radiusSquared = radius * radius;

  const scaledKeyframes = keyframes.map((keyframe) => ({
    ...keyframe,
    pipX: Math.round(keyframe.pipX * scaleX),
    pipY: Math.round(keyframe.pipY * scaleY)
  }));

  const screenFilter = buildScreenFilter(
    keyframes,
    screenFitMode,
    sourceWidth,
    sourceHeight,
    canvasW,
    canvasH,
    '[screen]',
    targetFps
  );

  const hasPip = keyframes.some((keyframe) => keyframe.pipVisible);
  const hasCamFull = keyframes.some((keyframe) => keyframe.cameraFullscreen);

  if (hasPip && hasCamFull) {
    const alphaExpr = buildAlphaExpr(keyframes);
    const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
    const camPipFilter = `[cam1]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})'[cam]`;

    const camFullAlpha = buildCamFullAlphaExpr(keyframes);
    const camFullFilter = `[cam2]setpts=PTS-STARTPTS,scale=${outW}:${outH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;

    const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
    const yExpr = buildPosExpr(scaledKeyframes, 'pipY');

    return `${screenFilter};[1:v]setpts=PTS-STARTPTS,hflip,split[cam1][cam2];${camPipFilter};${camFullFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[with_pip];[with_pip][camfull]overlay=0:0:format=auto[out]`;
  }

  if (hasCamFull) {
    const camFullAlpha = buildCamFullAlphaExpr(keyframes);
    const camFullFilter = `[1:v]setpts=PTS-STARTPTS,hflip,scale=${outW}:${outH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;
    return `${screenFilter};${camFullFilter};[screen][camfull]overlay=0:0:format=auto[out]`;
  }

  const alphaExpr = buildAlphaExpr(keyframes);
  const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
  const camFilter = `[1:v]setpts=PTS-STARTPTS,hflip,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})'[cam]`;

  const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
  const yExpr = buildPosExpr(scaledKeyframes, 'pipY');
  return `${screenFilter};${camFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[out]`;
}
