import type { Take } from '../../../shared/domain/project';

export interface TakePlaybackSources {
  screenPath: string | null;
  cameraPath: string | null;
}

function normalizePath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getTakePlaybackSources(
  take: Pick<Take, 'screenPath' | 'cameraPath' | 'proxyPath'> | null | undefined
): TakePlaybackSources {
  const screenPath = normalizePath(take?.screenPath);
  const cameraPath = normalizePath(take?.cameraPath);
  const proxyPath = normalizePath(take?.proxyPath);

  return {
    // Avoid mixing a timestamp-normalized screen proxy with raw camera media.
    screenPath: cameraPath ? screenPath : proxyPath || screenPath,
    cameraPath
  };
}
