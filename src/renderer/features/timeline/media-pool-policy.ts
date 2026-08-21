export interface MediaPoolSection {
  id: string;
  takeId?: string | null;
}

export function getWarmTakeIds(
  sections: MediaPoolSection[] | null | undefined,
  activeSectionId: string | null | undefined
): string[] {
  const timeline = Array.isArray(sections) ? sections : [];
  const requestedIndex = activeSectionId
    ? timeline.findIndex((section) => section.id === activeSectionId)
    : -1;
  const startIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const warmTakeIds: string[] = [];

  for (let index = startIndex; index < timeline.length && warmTakeIds.length < 2; index++) {
    const takeId = timeline[index]?.takeId;
    if (typeof takeId !== 'string' || !takeId || warmTakeIds.includes(takeId)) continue;
    warmTakeIds.push(takeId);
  }

  return warmTakeIds;
}
