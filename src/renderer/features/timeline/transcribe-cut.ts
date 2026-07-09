/**
 * Pure helpers for the on-demand "Transcribe & Cut" editor action: pick which
 * take to transcribe, locate the file that carries its mic audio, and splice
 * freshly cut sections into the timeline in place of the take's current ones.
 */

export interface TranscribableTake {
  id?: string;
  audioSource?: string | null;
  audioPath?: string | null;
  cameraPath?: string | null;
  audioStartOffsetMs?: number;
  cameraStartOffsetMs?: number;
}

export interface TimelineSectionLike {
  id: string;
  takeId?: string | null;
}

export interface TranscriptionSource {
  sourcePath: string;
  offsetSec: number;
}

function toOffsetSec(value: unknown): number {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}

/**
 * Which finalized file carries the take's mic audio, and how far that file's
 * first sample sits from the take's timeline origin. Mirrors the recording
 * routing: external mic → dedicated audio file, camera mic → camera file.
 */
export function resolveTranscriptionSource(
  take: TranscribableTake | null | undefined
): TranscriptionSource | null {
  if (!take || typeof take !== 'object') return null;

  if (take.audioSource === 'external' && typeof take.audioPath === 'string' && take.audioPath) {
    return { sourcePath: take.audioPath, offsetSec: toOffsetSec(take.audioStartOffsetMs) };
  }
  if (take.audioSource === 'camera' && typeof take.cameraPath === 'string' && take.cameraPath) {
    return { sourcePath: take.cameraPath, offsetSec: toOffsetSec(take.cameraStartOffsetMs) };
  }
  return null;
}

/**
 * Picks the take the "Transcribe & Cut" action operates on: the selected
 * section's take when there is one, otherwise the most recently recorded take
 * that still has sections on the timeline.
 */
export function resolveTargetTakeId({
  sections,
  selectedSectionId,
  takes
}: {
  sections: TimelineSectionLike[] | null | undefined;
  selectedSectionId: string | null | undefined;
  takes: Array<{ id?: string }> | null | undefined;
}): string | null {
  const timelineSections = Array.isArray(sections) ? sections : [];
  const knownTakes = Array.isArray(takes) ? takes : [];

  if (selectedSectionId) {
    const selected = timelineSections.find((section) => section.id === selectedSectionId);
    if (selected?.takeId && knownTakes.some((take) => take.id === selected.takeId)) {
      return selected.takeId;
    }
  }

  for (let i = knownTakes.length - 1; i >= 0; i -= 1) {
    const takeId = knownTakes[i]?.id;
    if (takeId && timelineSections.some((section) => section.takeId === takeId)) {
      return takeId;
    }
  }
  return null;
}

/**
 * Replaces every timeline section belonging to a take with a new list of
 * sections, inserted where the take's first section currently sits. Returns a
 * new array; the caller re-indexes and recalculates timeline positions.
 */
export function replaceTakeSections<T extends TimelineSectionLike>(
  sections: T[] | null | undefined,
  takeId: string,
  replacements: T[]
): { sections: T[]; replacedCount: number } {
  const input = Array.isArray(sections) ? sections : [];
  const firstIndex = input.findIndex((section) => section.takeId === takeId);
  if (firstIndex < 0) {
    return { sections: [...input], replacedCount: 0 };
  }

  const result: T[] = [];
  let replacedCount = 0;
  input.forEach((section, index) => {
    if (section.takeId === takeId) {
      replacedCount += 1;
      if (index === firstIndex) result.push(...replacements);
      return;
    }
    result.push(section);
  });

  return { sections: result, replacedCount };
}
