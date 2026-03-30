import type { Section } from '../../shared/domain/project';

export function computeSections(
  opts: {
    segments?: Array<{ start: number; end: number }>;
    paddingSeconds?: number;
  } = {}
): { sections: Section[]; trimmedDuration: number } {
  const segments = Array.isArray(opts.segments) ? opts.segments : [];
  const paddingSeconds = Number.isFinite(Number(opts.paddingSeconds))
    ? Math.max(0, Number(opts.paddingSeconds))
    : 0.15;

  if (segments.length === 0) {
    return { sections: [], trimmedDuration: 0 };
  }

  const padded = segments
    .map((segment) => ({
      start: Math.max(0, Number(segment.start) - paddingSeconds),
      end: Number(segment.end) + paddingSeconds
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);

  if (padded.length === 0) {
    return { sections: [], trimmedDuration: 0 };
  }

  const merged = [padded[0]];
  for (let index = 1; index < padded.length; index += 1) {
    const last = merged[merged.length - 1];
    if (padded[index].start < last.end) {
      last.end = Math.max(last.end, padded[index].end);
    } else {
      merged.push(padded[index]);
    }
  }

  const remapped: Section[] = [];
  let timelineCursor = 0;
  for (let index = 0; index < merged.length; index += 1) {
    const segment = merged[index];
    const sourceStart = Number(segment.start.toFixed(3));
    const sourceEnd = Number(segment.end.toFixed(3));
    const sectionDuration = Math.max(0, sourceEnd - sourceStart);
    const start = Number(timelineCursor.toFixed(3));
    const end = Number((timelineCursor + sectionDuration).toFixed(3));
    remapped.push({
      id: `section-${index + 1}`,
      index,
      sourceStart,
      sourceEnd,
      start,
      end,
      duration: Number(sectionDuration.toFixed(3)),
      label: `Section ${index + 1}`,
      transcript: '',
      takeId: null,
      imagePath: null
    });
    timelineCursor += sectionDuration;
  }

  return {
    sections: remapped,
    trimmedDuration: remapped.length > 0 ? remapped[remapped.length - 1].end : 0
  };
}
