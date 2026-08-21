import type { AudioSource, Take } from '../../../shared/domain/project';
import { resolveTakeAudio } from '../../../shared/domain/take-audio';

export type WaveformTakeInput = Partial<
  Pick<
    Take,
    | 'screenPath'
    | 'cameraPath'
    | 'audioPath'
    | 'audioSource'
    | 'hasSystemAudio'
    | 'proxyPath'
    | 'cameraProxyPath'
  >
>;

export interface WaveformDecodeSources {
  micCandidates: string[];
  micSource: AudioSource | null;
  systemCandidates: string[];
}

export type WaveformLoadStatus = 'loading' | 'ready' | 'no-audio' | 'error';

function orderedUniquePaths(...paths: unknown[]): string[] {
  const normalized = paths.filter(
    (path): path is string => typeof path === 'string' && path.trim().length > 0
  );
  return [...new Set(normalized)];
}

function resolveMicDecodeCandidates(
  source: AudioSource | null,
  resolvedPath: string | null,
  take: WaveformTakeInput
): string[] {
  if (source === 'camera') {
    return orderedUniquePaths(take.cameraProxyPath, take.cameraPath, resolvedPath);
  }
  if (source === 'screen') {
    return orderedUniquePaths(take.proxyPath, take.screenPath, resolvedPath);
  }
  if (source === 'external') return orderedUniquePaths(resolvedPath);
  return [];
}

export function getWaveformDecodeSources(
  take: WaveformTakeInput | null | undefined
): WaveformDecodeSources {
  if (!take) {
    return { micCandidates: [], micSource: null, systemCandidates: [] };
  }

  const audioResolution = resolveTakeAudio(take);
  const micCandidates = resolveMicDecodeCandidates(
    audioResolution.source,
    audioResolution.path,
    take
  );
  const systemCandidates =
    take.hasSystemAudio === true && audioResolution.source !== 'screen'
      ? orderedUniquePaths(take.proxyPath, take.screenPath)
      : [];

  return {
    micCandidates,
    micSource: audioResolution.source,
    systemCandidates
  };
}

export function resolveWaveformLoadStatus({
  loading,
  candidateSourceCount,
  decodedTrackCount,
  failedTrackCount
}: {
  loading: boolean;
  candidateSourceCount: number;
  decodedTrackCount: number;
  failedTrackCount: number;
}): WaveformLoadStatus {
  if (loading) return 'loading';
  if (decodedTrackCount > 0) return 'ready';
  if (candidateSourceCount <= 0) return 'no-audio';
  if (failedTrackCount >= candidateSourceCount) return 'error';
  return 'loading';
}
