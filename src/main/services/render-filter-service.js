const TRANSITION_DURATION = 0.3;

function resolveOutputSize(sourceWidth, _sourceHeight) {
  let outW = sourceWidth % 2 === 0 ? sourceWidth : sourceWidth - 1;
  let outH = Math.round((outW * 9) / 16);
  if (outH % 2 !== 0) outH -= 1;
  return { outW, outH };
}

function buildNumericExpr(keyframes, prop, precision = 3, defaultValue = 0, timeVar = 't') {
  const firstValue = Number.isFinite(Number(keyframes[0]?.[prop]))
    ? Number(keyframes[0][prop])
    : defaultValue;
  if (keyframes.length === 1) return firstValue.toFixed(precision);

  let expr = firstValue.toFixed(precision);
  for (let i = 1; i < keyframes.length; i += 1) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const prevVal = Number.isFinite(Number(prev?.[prop])) ? Number(prev[prop]) : defaultValue;
    const currVal = Number.isFinite(Number(curr?.[prop])) ? Number(curr[prop]) : defaultValue;
    const t = curr.time;
    const tStart = t - TRANSITION_DURATION;
    const diff = currVal - prevVal;

    if (Math.abs(diff) > 0.0001) {
      expr = `if(gte(${timeVar},${t.toFixed(3)}),${currVal.toFixed(precision)},if(gte(${timeVar},${tStart.toFixed(3)}),${prevVal.toFixed(precision)}+${diff.toFixed(precision)}*(${timeVar}-${tStart.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
    } else {
      expr = `if(gte(${timeVar},${t.toFixed(3)}),${currVal.toFixed(precision)},${expr})`;
    }
  }
  return expr;
}

function panToFocusCoord(zoom, pan, defaultCoord = 0.5) {
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;
  const normalizedPan = Number.isFinite(Number(pan)) ? Number(pan) : 0;
  if (normalizedZoom <= 1.0001) return defaultCoord;
  const cropFraction = 1 / normalizedZoom;
  return cropFraction / 2 + ((normalizedPan + 1) / 2) * (1 - cropFraction);
}

function buildPosExpr(keyframes, prop) {
  if (keyframes.length === 1) return String(Math.round(keyframes[0][prop]));

  let expr = String(Math.round(keyframes[0][prop]));
  for (let i = 1; i < keyframes.length; i += 1) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const prevVal = Math.round(prev[prop]);
    const currVal = Math.round(curr[prop]);
    const t = curr.time;
    const prevFull = prev.cameraFullscreen || false;
    const currFull = curr.cameraFullscreen || false;
    const prevVisible = prev.pipVisible !== undefined ? prev.pipVisible : true;
    const currVisible = curr.pipVisible !== undefined ? curr.pipVisible : true;

    if ((prevFull && !currFull) || (!prevVisible && currVisible)) {
      // Fullscreen→pip or hidden→visible: snap to destination at transition start
      const tStart = t - TRANSITION_DURATION;
      expr = `if(gte(t,${tStart.toFixed(3)}),${currVal},${expr})`;
    } else if (prevVal !== currVal && !prevFull && !currFull) {
      const tStart = t - TRANSITION_DURATION;
      const diff = currVal - prevVal;
      expr = `if(gte(t,${t.toFixed(3)}),${currVal},if(gte(t,${tStart.toFixed(3)}),${prevVal}+${diff}*(t-${tStart.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
    } else {
      expr = `if(gte(t,${t.toFixed(3)}),${currVal},${expr})`;
    }
  }
  return expr;
}

function buildAlphaExpr(keyframes) {
  if (keyframes.length === 1) return keyframes[0].pipVisible ? '1' : '0';

  let expr = keyframes[0].pipVisible ? '1' : '0';
  for (let i = 1; i < keyframes.length; i += 1) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const t = curr.time;

    if (prev.pipVisible !== curr.pipVisible) {
      const tStart = t - TRANSITION_DURATION;
      if (curr.pipVisible) {
        expr = `if(gte(T,${t.toFixed(3)}),1,if(gte(T,${tStart.toFixed(3)}),(T-${tStart.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
      } else {
        expr = `if(gte(T,${t.toFixed(3)}),0,if(gte(T,${tStart.toFixed(3)}),(${t.toFixed(3)}-T)/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
      }
    } else {
      expr = `if(gte(T,${t.toFixed(3)}),${curr.pipVisible ? '1' : '0'},${expr})`;
    }
  }
  return expr;
}

function buildCamFullAlphaExpr(keyframes) {
  const isFullVisible = (keyframe) => (keyframe.cameraFullscreen || false) && keyframe.pipVisible;
  if (keyframes.length === 1) return isFullVisible(keyframes[0]) ? '1' : '0';

  let expr = isFullVisible(keyframes[0]) ? '1' : '0';
  for (let i = 1; i < keyframes.length; i += 1) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const t = curr.time;
    const tStart = t - TRANSITION_DURATION;
    const prevFull = isFullVisible(prev);
    const currFull = isFullVisible(curr);

    if (prevFull !== currFull) {
      if (currFull) {
        expr = `if(gte(T,${t.toFixed(3)}),1,if(gte(T,${tStart.toFixed(3)}),(T-${tStart.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
      } else {
        expr = `if(gte(T,${t.toFixed(3)}),0,if(gte(T,${tStart.toFixed(3)}),(${t.toFixed(3)}-T)/${TRANSITION_DURATION.toFixed(3)},${expr}))`;
      }
    } else {
      expr = `if(gte(T,${t.toFixed(3)}),${currFull ? '1' : '0'},${expr})`;
    }
  }
  return expr;
}

function buildScreenFilter(
  keyframes,
  screenFitMode,
  sourceWidth,
  sourceHeight,
  canvasW,
  _canvasH,
  outputLabel = '[screen]',
  screenPreprocessed = false,
  targetFps = 30
) {
  const { outW, outH } = resolveOutputSize(sourceWidth, sourceHeight);
  const normalizedKeyframes = (Array.isArray(keyframes) ? keyframes : []).map((keyframe) => ({
    ...keyframe,
    backgroundZoom: Number.isFinite(Number(keyframe?.backgroundZoom)) ? Number(keyframe.backgroundZoom) : 1,
    backgroundPanX: Number.isFinite(Number(keyframe?.backgroundPanX)) ? Number(keyframe.backgroundPanX) : 0,
    backgroundPanY: Number.isFinite(Number(keyframe?.backgroundPanY)) ? Number(keyframe.backgroundPanY) : 0,
    backgroundFocusX: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanX, 0.5),
    backgroundFocusY: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanY, 0.5)
  }));

  const baseFilter =
    screenPreprocessed
      ? '[0:v]setpts=PTS-STARTPTS[screen_base]'
      : screenFitMode === 'fill'
        ? `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}[screen_base]`
        : `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:'(ow-iw)/2':'(oh-ih)/2':color=black[screen_base]`;

  const hasBackgroundAnimation = normalizedKeyframes.some((keyframe) => {
    return Math.abs(keyframe.backgroundZoom - 1) > 0.0001
      || Math.abs(keyframe.backgroundPanX) > 0.0001
      || Math.abs(keyframe.backgroundPanY) > 0.0001;
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

function buildFilterComplex(
  keyframes,
  pipSize,
  screenFitMode,
  sourceWidth,
  sourceHeight,
  canvasW,
  _canvasH,
  screenPreprocessed = false,
  targetFps = 30
) {
  const { outW, outH } = resolveOutputSize(sourceWidth, sourceHeight);

  const scale = outW / canvasW;
  const actualPipSize = Math.round(pipSize * scale);
  const radius = Math.round(12 * scale);
  const maxCoord = actualPipSize - 1 - radius;
  const radiusSquared = radius * radius;

  const scaledKeyframes = keyframes.map((keyframe) => ({
    ...keyframe,
    pipX: Math.round(keyframe.pipX * scale),
    pipY: Math.round(keyframe.pipY * scale)
  }));

  const screenFilter = buildScreenFilter(
    keyframes,
    screenFitMode,
    sourceWidth,
    sourceHeight,
    canvasW,
    _canvasH,
    '[screen]',
    screenPreprocessed,
    targetFps
  );

  const hasPip = keyframes.some((keyframe) => keyframe.pipVisible);
  const hasCamFull = keyframes.some((keyframe) => keyframe.cameraFullscreen);

  if (hasPip && hasCamFull) {
    const alphaExpr = buildAlphaExpr(keyframes);
    const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
    const camPipFilter = `[cam1]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})'[cam]`;

    const camFullAlpha = buildCamFullAlphaExpr(keyframes);
    const camFullFilter = `[cam2]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;

    const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
    const yExpr = buildPosExpr(scaledKeyframes, 'pipY');

    return `${screenFilter};[1:v]split[cam1][cam2];${camPipFilter};${camFullFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[with_pip];[with_pip][camfull]overlay=0:0:format=auto[out]`;
  }

  if (hasCamFull) {
    const camFullAlpha = buildCamFullAlphaExpr(keyframes);
    const camFullFilter = `[1:v]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;
    return `${screenFilter};${camFullFilter};[screen][camfull]overlay=0:0:format=auto[out]`;
  }

  const alphaExpr = buildAlphaExpr(keyframes);
  const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
  const camFilter = `[1:v]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})'[cam]`;

  const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
  const yExpr = buildPosExpr(scaledKeyframes, 'pipY');
  return `${screenFilter};${camFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[out]`;
}

module.exports = {
  TRANSITION_DURATION,
  resolveOutputSize,
  buildNumericExpr,
  buildScreenFilter,
  panToFocusCoord,
  buildPosExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex
};
