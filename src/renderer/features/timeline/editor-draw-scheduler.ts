export type EditorDrawSchedule = 'idle' | 'video-frame' | 'animation-frame';

export function resolveEditorDrawSchedule({
  playing,
  hasActiveVideo,
  supportsVideoFrameCallback
}: {
  playing: boolean;
  hasActiveVideo: boolean;
  supportsVideoFrameCallback: boolean;
}): EditorDrawSchedule {
  if (!playing) return 'idle';
  return hasActiveVideo && supportsVideoFrameCallback ? 'video-frame' : 'animation-frame';
}

export function shouldRequestEditorDraw({
  hasEditor,
  timelineVisible,
  drawPending
}: {
  hasEditor: boolean;
  timelineVisible: boolean;
  drawPending: boolean;
}): boolean {
  return hasEditor && timelineVisible && !drawPending;
}
