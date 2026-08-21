export function resolveScrubSeekAction({
  nowMs,
  lastMediaSeekAtMs,
  intervalMs,
  final
}: {
  nowMs: number;
  lastMediaSeekAtMs: number | null;
  intervalMs: number;
  final: boolean;
}): {
  commitMediaSeek: boolean;
  nextLastMediaSeekAtMs: number | null;
} {
  const normalizedNow = Number.isFinite(nowMs) ? nowMs : 0;
  const normalizedInterval = Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 0);
  const commitMediaSeek =
    final ||
    lastMediaSeekAtMs === null ||
    normalizedNow - lastMediaSeekAtMs >= normalizedInterval ||
    normalizedNow < lastMediaSeekAtMs;

  return {
    commitMediaSeek,
    nextLastMediaSeekAtMs: commitMediaSeek ? normalizedNow : lastMediaSeekAtMs
  };
}
