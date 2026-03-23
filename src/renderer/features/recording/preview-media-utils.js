function createMediaElementForPath(kind, mediaPath, createMediaElement, pathToFileUrl) {
  if (!mediaPath) return null;
  const element = createMediaElement(kind);
  element.preload = 'auto';
  element.src = pathToFileUrl(mediaPath);
  if (kind !== 'audio') element.playsInline = true;
  if (kind === 'video-camera') element.muted = true;
  return element;
}

export function createTakePreviewMedia(
  take,
  {
    createVideoElement = () => document.createElement('video'),
    createAudioElement = () => document.createElement('audio'),
    pathToFileUrl
  } = {}
) {
  if (!take || typeof pathToFileUrl !== 'function') return null;

  const createMediaElement = (kind) => {
    if (kind === 'audio') return createAudioElement();
    return createVideoElement();
  };

  return {
    screen: createMediaElementForPath('video-screen', take.screenPath, createMediaElement, pathToFileUrl),
    camera: createMediaElementForPath('video-camera', take.cameraPath, createMediaElement, pathToFileUrl),
    mic: createMediaElementForPath('audio', take.micPath, createMediaElement, pathToFileUrl)
  };
}

export function pauseTakePreviewMedia(media) {
  if (!media) return;
  media.screen?.pause();
  media.camera?.pause();
  media.mic?.pause();
}

export function clearTakePreviewMedia(media) {
  if (!media) return;
  pauseTakePreviewMedia(media);
  if (media.screen) media.screen.src = '';
  if (media.camera) media.camera.src = '';
  if (media.mic) media.mic.src = '';
}

export function seekTakePreviewMedia(media, { sourceTime, cameraTime }) {
  if (!media?.screen) return;
  media.screen.currentTime = sourceTime;
  if (media.camera) media.camera.currentTime = cameraTime;
  if (media.mic) media.mic.currentTime = sourceTime;
}

export function setTakePreviewPlaybackRate(media, { speed, hasCamera }) {
  if (!media?.screen) return;
  media.screen.playbackRate = speed;
  if (hasCamera && media.camera) media.camera.playbackRate = speed;
  if (media.mic) media.mic.playbackRate = speed;
}

export function playTakePreviewMedia(media, { speed, hasCamera }) {
  if (!media?.screen) return;
  setTakePreviewPlaybackRate(media, { speed, hasCamera });
  if (media.screen.paused) media.screen.play().catch(() => {});
  if (hasCamera && media.camera && media.camera.paused) media.camera.play().catch(() => {});
  if (media.mic && media.mic.paused) media.mic.play().catch(() => {});
}
