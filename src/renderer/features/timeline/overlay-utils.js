const TRANSITION_DURATION = 0.3;

/**
 * Compute the overlay visual state at a given timeline time.
 * Pure function — no DOM dependencies.
 *
 * @param {number} time - current playhead time in seconds
 * @param {Array} overlays - normalized overlay segments
 * @param {string} outputMode - 'landscape' or 'reel'
 * @returns {{ active: boolean, overlayId?, mediaPath?, mediaType?, x?, y?, width?, height?, opacity?, sourceTime? }}
 */
function getOverlayStateAtTime(time, overlays, outputMode) {
  if (!Array.isArray(overlays) || overlays.length === 0) {
    return { active: false };
  }
  const mode = outputMode === 'reel' ? 'reel' : 'landscape';
  const FADE = TRANSITION_DURATION;

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    if (time < o.startTime - 0.001 || time > o.endTime + 0.001) continue;

    const pos = o[mode] || { x: 0, y: 0, width: 400, height: 300 };
    let x = pos.x, y = pos.y, width = pos.width, height = pos.height;

    // Fade in/out
    let opacity = 1;
    if (time < o.startTime + FADE) {
      opacity = Math.max(0, (time - o.startTime) / FADE);
    }
    if (time > o.endTime - FADE) {
      opacity = Math.min(opacity, Math.max(0, (o.endTime - time) / FADE));
    }

    // Position interpolation with adjacent same-media segment
    // Only ONE side handles the transition to avoid double-animation:
    // The SECOND segment handles the full interpolation from prev→current during its FADE window.
    // The FIRST segment does NOT interpolate toward next — it stays at its own position.
    const prev = i > 0 ? overlays[i - 1] : null;
    if (prev && prev.mediaPath === o.mediaPath && Math.abs(o.startTime - prev.endTime) < 0.01) {
      const elapsed = time - o.startTime;
      if (elapsed >= 0 && elapsed < FADE) {
        const t = elapsed / FADE;
        const prevPos = prev[mode] || { x: 0, y: 0, width: 400, height: 300 };
        x = prevPos.x + (x - prevPos.x) * t;
        y = prevPos.y + (y - prevPos.y) * t;
        width = prevPos.width + (width - prevPos.width) * t;
        height = prevPos.height + (height - prevPos.height) * t;
        opacity = 1;
      }
    } else {
      // Only suppress fade-out if next segment is same media (transition handled by next)
      const next = i < overlays.length - 1 ? overlays[i + 1] : null;
      if (next && next.mediaPath === o.mediaPath && Math.abs(next.startTime - o.endTime) < 0.01) {
        opacity = 1; // no fade-out, next segment will handle the transition
      }
    }

    const sourceTime = o.mediaType === 'video' ? o.sourceStart + (time - o.startTime) : 0;

    return {
      active: true,
      overlayId: o.id,
      mediaPath: o.mediaPath,
      mediaType: o.mediaType,
      x, y, width, height,
      opacity,
      sourceTime
    };
  }
  return { active: false };
}

export { getOverlayStateAtTime, TRANSITION_DURATION };
