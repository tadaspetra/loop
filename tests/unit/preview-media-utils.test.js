const previewMediaUtilsPromise = import('../../src/renderer/features/recording/preview-media-utils.js');

function createFakeMediaElement(kind) {
  return {
    kind,
    preload: '',
    src: '',
    playsInline: false,
    muted: false,
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    }
  };
}

describe('renderer/features/recording/preview-media-utils', () => {
  test('createTakePreviewMedia creates screen, camera, and mic elements', async () => {
    const previewMediaUtils = await previewMediaUtilsPromise;
    const media = previewMediaUtils.createTakePreviewMedia(
      {
        screenPath: '/tmp/screen.webm',
        cameraPath: '/tmp/camera.webm',
        micPath: '/tmp/mic.webm'
      },
      {
        createVideoElement: () => createFakeMediaElement('video'),
        createAudioElement: () => createFakeMediaElement('audio'),
        pathToFileUrl: (value) => `file://${value}`
      }
    );

    expect(media.screen.src).toBe('file:///tmp/screen.webm');
    expect(media.screen.playsInline).toBe(true);
    expect(media.camera.src).toBe('file:///tmp/camera.webm');
    expect(media.camera.muted).toBe(true);
    expect(media.mic.src).toBe('file:///tmp/mic.webm');
    expect(media.mic.kind).toBe('audio');
  });

  test('seekTakePreviewMedia and playTakePreviewMedia keep mic aligned to screen', async () => {
    const previewMediaUtils = await previewMediaUtilsPromise;
    const media = {
      screen: createFakeMediaElement('video'),
      camera: createFakeMediaElement('video'),
      mic: createFakeMediaElement('audio')
    };

    previewMediaUtils.seekTakePreviewMedia(media, {
      sourceTime: 12.5,
      cameraTime: 12.65
    });
    previewMediaUtils.playTakePreviewMedia(media, { speed: 1.5, hasCamera: true });

    expect(media.screen.currentTime).toBe(12.5);
    expect(media.camera.currentTime).toBe(12.65);
    expect(media.mic.currentTime).toBe(12.5);
    expect(media.screen.playbackRate).toBe(1.5);
    expect(media.camera.playbackRate).toBe(1.5);
    expect(media.mic.playbackRate).toBe(1.5);
    expect(media.screen.paused).toBe(false);
    expect(media.camera.paused).toBe(false);
    expect(media.mic.paused).toBe(false);
  });
});
