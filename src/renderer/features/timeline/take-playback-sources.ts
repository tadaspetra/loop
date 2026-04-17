import type { Take } from '../../../shared/domain/project';

export interface TakePlaybackSources {
  screenPath: string | null;
  cameraPath: string | null;
}

function normalizePath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getTakePlaybackSources(
  take:
    | Pick<Take, 'screenPath' | 'cameraPath' | 'proxyPath' | 'cameraProxyPath'>
    | null
    | undefined
): TakePlaybackSources {
  const screenPath = normalizePath(take?.screenPath);
  const cameraPath = normalizePath(take?.cameraPath);
  const proxyPath = normalizePath(take?.proxyPath);
  const cameraProxyPath = normalizePath(take?.cameraProxyPath);

  // Always prefer proxies when available. Proxies preserve the source
  // per-frame PTS (see `generateProxy` in proxy-service.ts), so they can
  // play side-by-side without clock divergence, and the 960x540 H.264
  // decode is drastically cheaper than 1080p VP8 — which is what made
  // long-recording editor playback stall and fall out of sync when two
  // raw WebMs had to be decoded simultaneously. Export never uses these
  // proxies; it always reads the raw files for fidelity.
  return {
    screenPath: proxyPath || screenPath,
    cameraPath: cameraProxyPath || cameraPath
  };
}
