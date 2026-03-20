const TRANSITION_DURATION = 0.3;

function resolveOutputSize(sourceWidth, sourceHeight, outputMode = 'landscape') {
  if (outputMode === 'reel') {
    let outH = sourceHeight % 2 === 0 ? sourceHeight : sourceHeight - 1;
    let outW = Math.round((outH * 9) / 16);
    if (outW % 2 !== 0) outW -= 1;
    return { outW, outH };
  }
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

function getContentWidth(sourceW, sourceH, fitMode, canvasW, canvasH) {
  if (fitMode !== 'fit' || !sourceW || !sourceH) return canvasW;
  const scale = Math.min(canvasW / sourceW, canvasH / sourceH);
  return sourceW * scale;
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
  targetFps = 30,
  outputMode = 'landscape'
) {
  const landscapeSize = resolveOutputSize(sourceWidth, sourceHeight, 'landscape');
  const { outW: landscapeW, outH: landscapeH } = landscapeSize;
  const isReel = outputMode === 'reel';
  const { outW: finalW, outH: finalH } = isReel
    ? resolveOutputSize(sourceWidth, sourceHeight, 'reel')
    : landscapeSize;

  const normalizedKeyframes = (Array.isArray(keyframes) ? keyframes : []).map((keyframe) => ({
    ...keyframe,
    backgroundZoom: Number.isFinite(Number(keyframe?.backgroundZoom)) ? Number(keyframe.backgroundZoom) : 1,
    backgroundPanX: Number.isFinite(Number(keyframe?.backgroundPanX)) ? Number(keyframe.backgroundPanX) : 0,
    backgroundPanY: Number.isFinite(Number(keyframe?.backgroundPanY)) ? Number(keyframe.backgroundPanY) : 0,
    backgroundFocusX: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanX, 0.5),
    backgroundFocusY: panToFocusCoord(keyframe?.backgroundZoom, keyframe?.backgroundPanY, 0.5),
    reelCropX: Number.isFinite(Number(keyframe?.reelCropX)) ? Number(keyframe.reelCropX) : 0
  }));

  const baseFilter =
    isReel
      ? (screenPreprocessed
        ? '[0:v]setpts=PTS-STARTPTS[screen_base]'
        : `[0:v]scale=${landscapeW}:${landscapeH}:force_original_aspect_ratio=${screenFitMode === 'fill' ? 'increase' : 'decrease'}${screenFitMode === 'fill' ? `,crop=${landscapeW}:${landscapeH}` : `,pad=${landscapeW}:${landscapeH}:'(ow-iw)/2':'(oh-ih)/2':color=black`}[screen_base]`)
      : screenFitMode === 'fill'
        ? `[0:v]${screenPreprocessed ? 'setpts=PTS-STARTPTS,' : ''}scale=${landscapeW}:${landscapeH}:force_original_aspect_ratio=increase,crop=${landscapeW}:${landscapeH}[screen_base]`
        : `[0:v]${screenPreprocessed ? 'setpts=PTS-STARTPTS,' : ''}scale=${landscapeW}:${landscapeH}:force_original_aspect_ratio=decrease,pad=${landscapeW}:${landscapeH}:'(ow-iw)/2':'(oh-ih)/2':color=black[screen_base]`;

  // Effective dimensions of screen_base after baseFilter
  // In reel+preprocessed, screen_base is raw source; otherwise it's landscape-scaled
  const baseW = (isReel && screenPreprocessed) ? sourceWidth : landscapeW;
  const baseH = (isReel && screenPreprocessed) ? sourceHeight : landscapeH;

  const hasBackgroundAnimation = normalizedKeyframes.some((keyframe) => {
    return Math.abs(keyframe.backgroundZoom - 1) > 0.0001
      || Math.abs(keyframe.backgroundPanX) > 0.0001
      || Math.abs(keyframe.backgroundPanY) > 0.0001;
  });

  // Compute content width for fit mode crop constraining
  // In reel mode with preprocessed source, content fills the full source width (no fit padding applied)
  const contentW = (isReel && screenPreprocessed) ? landscapeW : getContentWidth(sourceWidth, sourceHeight, screenFitMode, landscapeW, landscapeH);
  const contentLeft = Math.round((landscapeW - contentW) / 2);

  // Build reel crop suffix if in reel mode
  let reelCropSuffix = '';
  if (isReel) {
    const maxCropRange = Math.max(0, Math.round(contentW) - finalW);
    const hasAnimatedCrop = normalizedKeyframes.some((kf, i) => {
      if (i === 0) return false;
      return Math.abs(kf.reelCropX - normalizedKeyframes[i - 1].reelCropX) > 0.0001;
    });

    if (hasAnimatedCrop) {
      const cropXExpr = buildNumericExpr(normalizedKeyframes, 'reelCropX', 3, 0, 't');
      reelCropSuffix = `,crop=${finalW}:${finalH}:'max(0,min(${landscapeW - finalW},${contentLeft}+(${cropXExpr}+1)/2*${maxCropRange}))':0,setsar=1`;
    } else {
      const cropX = Math.max(0, Math.min(landscapeW - finalW, contentLeft + Math.round(((normalizedKeyframes[0]?.reelCropX || 0) + 1) / 2 * maxCropRange)));
      reelCropSuffix = `,crop=${finalW}:${finalH}:${cropX}:0,setsar=1`;
    }
  }

  // Check if any keyframe has zoom < 1 (zoom-out in reel mode)
  const hasZoomOut = isReel && normalizedKeyframes.some(kf => kf.backgroundZoom < 0.9999);

  // --- Zoom-out pipeline (reel mode with zoom < 1) ---
  if (hasZoomOut) {
    const darkenFilter = 'colorlevels=romax=0.2:gomax=0.2:bomax=0.2';

    const hasAnimatedCrop = normalizedKeyframes.some((kf, i) => {
      if (i === 0) return false;
      return Math.abs(kf.reelCropX - normalizedKeyframes[i - 1].reelCropX) > 0.0001;
    });

    // Check if zoom/focus actually vary between keyframes
    const hasZoomAnimation = normalizedKeyframes.length > 1 && normalizedKeyframes.some((kf, i) => {
      if (i === 0) return false;
      const prev = normalizedKeyframes[i - 1];
      return Math.abs(kf.backgroundZoom - prev.backgroundZoom) > 0.0001
        || Math.abs(kf.backgroundFocusX - prev.backgroundFocusX) > 0.0001
        || Math.abs(kf.backgroundFocusY - prev.backgroundFocusY) > 0.0001;
    });

    if (!hasZoomAnimation) {
      // Static zoom-out: all keyframes same zoom < 1, no pan — uniform scale
      const zoom = normalizedKeyframes[0].backgroundZoom;
      let scaledW = Math.round(baseW * zoom);
      if (scaledW % 2 !== 0) scaledW -= 1;
      scaledW = Math.max(2, scaledW);
      let scaledH = Math.round(baseH * zoom);
      if (scaledH % 2 !== 0) scaledH -= 1;
      scaledH = Math.max(2, scaledH);
      const offsetX = Math.round((baseW - scaledW) / 2);
      const offsetY = Math.round((baseH - scaledH) / 2);

      // Crop constrained to scaled content bounds (accounts for fit-mode padding)
      const zoScaledLeft = Math.round((baseW - contentW * zoom) / 2);
      const maxCropRange = Math.max(0, Math.round(contentW * zoom - finalW));
      let zoCropSuffix;
      if (hasAnimatedCrop) {
        const cropXExpr = buildNumericExpr(normalizedKeyframes, 'reelCropX', 3, 0, 't');
        zoCropSuffix = `,crop=${finalW}:${finalH}:'max(0,${zoScaledLeft}+((${cropXExpr})+1)/2*${maxCropRange})':0,setsar=1`;
      } else {
        const cropX = Math.max(0, zoScaledLeft + Math.round(((normalizedKeyframes[0]?.reelCropX || 0) + 1) / 2 * maxCropRange));
        zoCropSuffix = `,crop=${finalW}:${finalH}:${cropX}:0,setsar=1`;
      }

      return `${baseFilter};[screen_base]split[for_zoom][for_bg];[for_bg]${darkenFilter}[dark_bg];[for_zoom]scale=${scaledW}:${scaledH}[content];[dark_bg][content]overlay=${offsetX}:${offsetY}${zoCropSuffix}${outputLabel}`;
    }

    // Animated zoom-out: zoom may cross 1.0 boundary — uniform scale both dimensions
    const zoomExprIT = buildNumericExpr(normalizedKeyframes, 'backgroundZoom', 3, 1, 'it');
    const zoomExprT = buildNumericExpr(normalizedKeyframes, 'backgroundZoom', 3, 1, 't');
    const focusXExprIT = buildNumericExpr(normalizedKeyframes, 'backgroundFocusX', 6, 0.5, 'it');
    const focusYExprIT = buildNumericExpr(normalizedKeyframes, 'backgroundFocusY', 6, 0.5, 'it');

    const zoompanPart = `zoompan=z='max(1.000,${zoomExprIT})':x='max(0,min(iw-iw/zoom,iw*(${focusXExprIT})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${focusYExprIT})-ih/zoom/2))':d=1:s=${baseW}x${baseH}:fps=${targetFps},setsar=1`;
    const scalePart = `scale=w='max(2,2*floor(${baseW}*min(1.0,${zoomExprT})/2))':h='max(2,2*floor(${baseH}*min(1.0,${zoomExprT})/2))':eval=frame`;
    const overlayPart = `overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2':eval=frame`;

    // Crop constrained to scaled content bounds: cropX = contentScaledLeft + ((reelCropX+1)/2) * maxRange
    const cropXExpr = buildNumericExpr(normalizedKeyframes, 'reelCropX', 3, 0, 't');
    const zMinExpr = `min(1,${zoomExprT})`;
    const cw = Math.round(contentW);
    const fullCropExpr = `(${baseW}-${cw}*${zMinExpr})/2+((${cropXExpr})+1)/2*max(0,${cw}*${zMinExpr}-${finalW})`;
    const zoCropSuffix = `,crop=${finalW}:${finalH}:'max(0,min(${baseW - finalW},${fullCropExpr}))':0,setsar=1`;

    return `${baseFilter};[screen_base]split[for_zoom][for_bg];[for_bg]${darkenFilter}[dark_bg];[for_zoom]${zoompanPart}[zoomed];[zoomed]${scalePart}[scaled];[dark_bg][scaled]${overlayPart}${zoCropSuffix}${outputLabel}`;
  }

  // --- Standard pipeline (no zoom-out) ---
  if (!hasBackgroundAnimation) {
    if (isReel) {
      // Need an intermediate label for the reel crop
      return `${baseFilter};[screen_base]null${reelCropSuffix}${outputLabel}`;
    }
    return baseFilter.replace('[screen_base]', outputLabel);
  }

  const zoomExpr = buildNumericExpr(normalizedKeyframes, 'backgroundZoom', 3, 1, 'it');
  const focusXExpr = buildNumericExpr(normalizedKeyframes, 'backgroundFocusX', 6, 0.5, 'it');
  const focusYExpr = buildNumericExpr(normalizedKeyframes, 'backgroundFocusY', 6, 0.5, 'it');
  const animatedFilter = `[screen_base]zoompan=z='${zoomExpr}':x='max(0,min(iw-iw/zoom,iw*(${focusXExpr})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${focusYExpr})-ih/zoom/2))':d=1:s=${baseW}x${baseH}:fps=${targetFps},setsar=1${reelCropSuffix}${outputLabel}`;
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
  targetFps = 30,
  outputMode = 'landscape'
) {
  const { outW, outH } = resolveOutputSize(sourceWidth, sourceHeight, outputMode);

  const scale = outW / canvasW;
  const radius = Math.round(12 * scale);
  const radiusSquared = radius * radius;

  // Determine per-keyframe pipScale values
  const DEFAULT_PIP_SCALE = 0.22;
  const normalizedKeyframes = (Array.isArray(keyframes) ? keyframes : []).map((kf) => ({
    ...kf,
    pipScale: Number.isFinite(Number(kf.pipScale)) ? Number(kf.pipScale) : DEFAULT_PIP_SCALE
  }));

  // Check if pipScale is static (same across all keyframes)
  const firstPipScale = normalizedKeyframes.length > 0 ? normalizedKeyframes[0].pipScale : DEFAULT_PIP_SCALE;
  const isStaticPipScale = normalizedKeyframes.every(kf => Math.abs(kf.pipScale - firstPipScale) < 0.0001);

  // For static case, use fixed pip size; for animated, build expressions
  const actualPipSize = isStaticPipScale ? Math.round(outW * firstPipScale) : null;

  const scaledKeyframes = normalizedKeyframes.map((keyframe) => ({
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
    targetFps,
    outputMode
  );

  const hasPip = normalizedKeyframes.some((keyframe) => keyframe.pipVisible);
  const hasCamFull = normalizedKeyframes.some((keyframe) => keyframe.cameraFullscreen);

  // Build camera PIP filter (scale + round corners + alpha)
  function buildCamPipFilter(inputLabel, outputLabel) {
    const alphaExpr = buildAlphaExpr(normalizedKeyframes);

    if (isStaticPipScale) {
      const maxCoord = actualPipSize - 1 - radius;
      const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
      return `${inputLabel}setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})'${outputLabel}`;
    }

    // Animated pipScale: scale to fixed max size, apply round corners, then animated downscale.
    // format+geq lock to first frame dimensions, so animated scale must come AFTER geq.
    // overlay handles variable-size overlay input correctly.
    const maxPipScale = Math.max(...normalizedKeyframes.map(kf => kf.pipScale));
    const maxPipSize = Math.max(2, Math.round(outW * maxPipScale));
    const maxCoord = maxPipSize - 1 - radius;
    const roundCornerExpr = `lte(pow(max(0,max(${radius}-X,X-${maxCoord})),2)+pow(max(0,max(${radius}-Y,Y-${maxCoord})),2),${radiusSquared})`;
    const pipSizeExpr = buildNumericExpr(normalizedKeyframes, 'pipScale', 3, DEFAULT_PIP_SCALE, 't');
    const sizeExpr = `max(2,2*floor(${outW}*${pipSizeExpr}/2))`;
    return `${inputLabel}setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${maxPipSize}:${maxPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCornerExpr}*(${alphaExpr})',scale=w='${sizeExpr}':h='${sizeExpr}':eval=frame${outputLabel}`;
  }

  if (hasPip && hasCamFull) {
    const camPipFilter = buildCamPipFilter('[cam1]', '[cam]');

    const camFullAlpha = buildCamFullAlphaExpr(normalizedKeyframes);
    const camFullFilter = `[cam2]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;

    const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
    const yExpr = buildPosExpr(scaledKeyframes, 'pipY');

    return `${screenFilter};[1:v]split[cam1][cam2];${camPipFilter};${camFullFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto:eval=frame[with_pip];[with_pip][camfull]overlay=0:0:format=auto[out]`;
  }

  if (hasCamFull) {
    const camFullAlpha = buildCamFullAlphaExpr(normalizedKeyframes);
    const camFullFilter = `[1:v]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`;
    return `${screenFilter};${camFullFilter};[screen][camfull]overlay=0:0:format=auto[out]`;
  }

  const camFilter = buildCamPipFilter('[1:v]', '[cam]');

  const xExpr = buildPosExpr(scaledKeyframes, 'pipX');
  const yExpr = buildPosExpr(scaledKeyframes, 'pipY');
  return `${screenFilter};${camFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto:eval=frame[out]`;
}

/**
 * Build overlay filter fragments for all overlay segments.
 * Returns { inputs: string[], filterParts: string[] } where:
 *   - inputs: ffmpeg input args for each overlay (e.g., ['-loop', '1', '-t', '5', '-i', 'img.png'])
 *   - filterParts: filter_complex fragments to chain overlays onto the base label
 *
 * @param {Array} overlays - normalized overlay segments
 * @param {number} canvasW - editor canvas width (1920 or 608)
 * @param {number} canvasH - editor canvas height (1080)
 * @param {number} outW - render output width
 * @param {number} outH - render output height
 * @param {number} inputOffset - ffmpeg input index offset (overlays start after screen+camera inputs)
 * @param {string} baseLabel - input label to overlay onto (e.g., 'screen' or 'out')
 * @param {string} outputMode - 'landscape' or 'reel'
 * @returns {{ inputs: string[][], filterParts: string[], outputLabel: string }}
 */
function buildOverlayFilter(overlays, canvasW, canvasH, outW, outH, inputOffset, baseLabel, outputMode = 'landscape') {
  if (!Array.isArray(overlays) || overlays.length === 0) {
    return { inputs: [], filterParts: [], outputLabel: baseLabel };
  }

  const scaleX = outW / canvasW;
  const scaleY = outH / canvasH;
  const mode = outputMode === 'reel' ? 'reel' : 'landscape';
  const FADE = TRANSITION_DURATION;
  const inputs = [];
  const filterParts = [];
  let currentLabel = baseLabel;

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const idx = inputOffset + i;
    const pos = o[mode] || { x: 0, y: 0, width: 400, height: 300 };
    const renderW = Math.max(2, Math.round(pos.width * scaleX));
    const renderH = Math.max(2, Math.round(pos.height * scaleY));
    const renderX = Math.round(pos.x * scaleX);
    const renderY = Math.round(pos.y * scaleY);
    const duration = o.endTime - o.startTime;

    // Build input args
    if (o.mediaType === 'image') {
      inputs.push(['-loop', '1', '-t', duration.toFixed(3), '-i']);
    } else {
      inputs.push(['-i']);
    }

    // Build filter chain for this overlay
    const overlayInputLabel = `[${idx}:v]`;
    const prepLabel = `ovl_prep_${i}`;
    const overlayLabel = `ovl_${i}`;

    const prepParts = [];
    if (o.mediaType === 'video') {
      prepParts.push(`trim=start=${o.sourceStart.toFixed(3)}:end=${o.sourceEnd.toFixed(3)}`);
      prepParts.push('setpts=PTS-STARTPTS');
    }
    prepParts.push(`scale=${renderW}:${renderH}`);
    prepParts.push('format=yuva420p');

    // Shift PTS to rendered timeline position so fade times align with enable window
    prepParts.push(`setpts=PTS+${o.startTime.toFixed(3)}/TB`);

    // Fade in/out (times in rendered timeline)
    const fadeInTime = o.startTime;
    const fadeOutTime = o.endTime - FADE;
    const fadeIn = `fade=in:st=${fadeInTime.toFixed(3)}:d=${FADE.toFixed(3)}:alpha=1`;
    const fadeOut = `fade=out:st=${fadeOutTime.toFixed(3)}:d=${FADE.toFixed(3)}:alpha=1`;

    // Check if this segment has same-media neighbor — suppress fade at boundary
    const next = i < overlays.length - 1 ? overlays[i + 1] : null;
    const prev = i > 0 ? overlays[i - 1] : null;
    const hasNextSameMedia = next && next.mediaPath === o.mediaPath && Math.abs(next.startTime - o.endTime) < 0.01;
    const hasPrevSameMedia = prev && prev.mediaPath === o.mediaPath && Math.abs(o.startTime - prev.endTime) < 0.01;

    if (!hasNextSameMedia && !hasPrevSameMedia) {
      prepParts.push(fadeIn);
      prepParts.push(fadeOut);
    } else if (!hasPrevSameMedia) {
      prepParts.push(fadeIn);
    } else if (!hasNextSameMedia) {
      prepParts.push(fadeOut);
    }

    filterParts.push(`${overlayInputLabel}${prepParts.join(',')}[${prepLabel}]`);

    // Position — static or animated for same-media transitions
    let xExpr = String(renderX);
    let yExpr = String(renderY);
    let useEvalFrame = false;

    if (hasNextSameMedia) {
      const nextPos = next[mode] || { x: 0, y: 0, width: 400, height: 300 };
      const nextRenderX = Math.round(nextPos.x * scaleX);
      const nextRenderY = Math.round(nextPos.y * scaleY);
      if (nextRenderX !== renderX || nextRenderY !== renderY) {
        const tStart = (duration - FADE).toFixed(3);
        const tEnd = duration.toFixed(3);
        xExpr = `if(gte(t,${tEnd}),${nextRenderX},if(gte(t,${tStart}),${renderX}+(${nextRenderX}-${renderX})*(t-${tStart})/${FADE.toFixed(3)},${renderX}))`;
        yExpr = `if(gte(t,${tEnd}),${nextRenderY},if(gte(t,${tStart}),${renderY}+(${nextRenderY}-${renderY})*(t-${tStart})/${FADE.toFixed(3)},${renderY}))`;
        useEvalFrame = true;
      }
    }

    const nextLabel = i < overlays.length - 1 ? `ovl_out_${i}` : overlayLabel;
    const enableExpr = `enable='between(t,${o.startTime.toFixed(3)},${o.endTime.toFixed(3)})'`;
    const evalMode = useEvalFrame ? ':eval=frame' : '';
    filterParts.push(`[${currentLabel}][${prepLabel}]overlay=x='${xExpr}':y='${yExpr}':${enableExpr}:format=auto${evalMode}[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  // Rename last label to a consistent output
  const finalLabel = `ovl_${overlays.length - 1}`;
  return { inputs, filterParts, outputLabel: finalLabel };
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
  buildFilterComplex,
  buildOverlayFilter
};
