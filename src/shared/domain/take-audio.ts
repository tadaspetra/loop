import type { AudioSource } from './project';

/**
 * Shape of a take for audio resolution purposes. Accepts the minimal fields
 * needed so both the renderer `Take` and the main-process render/Premiere
 * inputs can reuse the helper without any type gymnastics.
 */
export interface TakeAudioInput {
  screenPath?: string | null;
  cameraPath?: string | null;
  audioPath?: string | null;
  audioSource?: AudioSource | null;
}

export interface ResolvedTakeAudio {
  path: string | null;
  source: AudioSource | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns the file path and logical source that owns this take's microphone
 * audio. New takes route audio to the camera file (when a camera was recorded)
 * or to a dedicated audio-only file (screen-only recordings). Legacy takes
 * predate those layouts and keep the mic muxed into the screen file.
 *
 * Returns `{ path: null, source: null }` when the take has no usable audio
 * (explicitly silent or missing the referenced file).
 */
export function resolveTakeAudio(take: TakeAudioInput | null | undefined): ResolvedTakeAudio {
  if (!take) return { path: null, source: null };

  if (take.audioSource === 'external') {
    return isNonEmptyString(take.audioPath)
      ? { path: take.audioPath, source: 'external' }
      : { path: null, source: null };
  }

  if (take.audioSource === 'camera') {
    return isNonEmptyString(take.cameraPath)
      ? { path: take.cameraPath, source: 'camera' }
      : { path: null, source: null };
  }

  if (take.audioSource === 'screen') {
    return isNonEmptyString(take.screenPath)
      ? { path: take.screenPath, source: 'screen' }
      : { path: null, source: null };
  }

  return { path: null, source: null };
}
