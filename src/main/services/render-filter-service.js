const TRANSITION_DURATION = 0.3;

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

    if (prevVal !== currVal && !prevFull && !currFull) {
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

function buildFilterComplex(
  keyframes,
  pipSize,
  screenFitMode,
  sourceWidth,
  sourceHeight,
  canvasW,
  _canvasH
) {
  let outW = sourceWidth % 2 === 0 ? sourceWidth : sourceWidth - 1;
  let outH = Math.round((outW * 9) / 16);
  if (outH % 2 !== 0) outH -= 1;

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

  const screenFilter =
    screenFitMode === 'fill'
      ? `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}[screen]`
      : `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:'(ow-iw)/2':'(oh-ih)/2':color=black[screen]`;

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
  buildPosExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex
};
