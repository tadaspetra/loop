/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest';

import {
  buildPremiereXml,
  centerPxToFcpCenter,
  clipLocalKeyframesForSection,
  computeCameraFullScalePercent,
  computeCameraPipScalePercent,
  computeSquareCropPercents,
  expandKeyframesWithTransitionHolds,
  TRANSITION_DURATION,
  type PremiereXmlInput
} from '../../src/main/services/premiere-xml-service';

function baseInput(overrides: Partial<PremiereXmlInput> = {}): PremiereXmlInput {
  return {
    projectName: 'Test Project',
    canvasW: 1920,
    canvasH: 1080,
    fps: 30,
    pipSize: 422,
    takes: [
      {
        id: 'take-1',
        screenPath: '/tmp/proj/media/screen-take-1.mov',
        cameraPath: '/tmp/proj/media/camera-take-1.mov',
        audioPath: null,
        audioSource: 'screen',
        hasSystemAudio: false,
        screenDurationSec: 10,
        cameraDurationSec: 10,
        screenWidth: 1920,
        screenHeight: 1080,
        cameraWidth: 1920,
        cameraHeight: 1080
      }
    ],
    sections: [
      {
        takeId: 'take-1',
        timelineStart: 0,
        timelineEnd: 5,
        sourceStart: 0,
        sourceEnd: 5
      }
    ],
    keyframes: [
      {
        time: 0,
        pipX: 1478,
        pipY: 638,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      }
    ],
    hasCamera: true,
    ...overrides
  };
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function getAllByTag(root: Element | Document, tag: string): Element[] {
  return Array.from(root.getElementsByTagName(tag));
}

describe('main/services/premiere-xml-service', () => {
  test('buildPremiereXml emits well-formed xmeml v5 with sequence metadata', () => {
    const xml = buildPremiereXml(baseInput());
    const doc = parseXml(xml);

    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<xmeml version="5">');

    const sequence = doc.getElementsByTagName('sequence')[0];
    expect(sequence).toBeDefined();
    expect(sequence.getElementsByTagName('name')[0].textContent).toBe('Test Project');
    expect(sequence.getElementsByTagName('duration')[0].textContent).toBe('150');

    const seqRate = sequence.getElementsByTagName('rate')[0];
    expect(seqRate.getElementsByTagName('timebase')[0].textContent).toBe('30');

    const format = sequence.getElementsByTagName('format')[0];
    const sample = format.getElementsByTagName('samplecharacteristics')[0];
    expect(sample.getElementsByTagName('width')[0].textContent).toBe('1920');
    expect(sample.getElementsByTagName('height')[0].textContent).toBe('1080');
  });

  test('buildPremiereXml uses native screen dimensions for sequence format', () => {
    const input = baseInput({
      canvasW: 3840,
      canvasH: 2160,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 10,
          screenWidth: 3840,
          screenHeight: 2160,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const format = doc.getElementsByTagName('sequence')[0].getElementsByTagName('format')[0];
    const sample = format.getElementsByTagName('samplecharacteristics')[0];
    expect(sample.getElementsByTagName('width')[0].textContent).toBe('3840');
    expect(sample.getElementsByTagName('height')[0].textContent).toBe('2160');
  });

  test('buildPremiereXml produces V1 screen + V2 camera tracks with matching cuts', () => {
    const input = baseInput({
      sections: [
        { takeId: 'take-1', timelineStart: 0, timelineEnd: 2, sourceStart: 3, sourceEnd: 5 },
        { takeId: 'take-1', timelineStart: 2, timelineEnd: 5, sourceStart: 7, sourceEnd: 10 }
      ],
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 15,
          cameraDurationSec: 15,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });

    const doc = parseXml(buildPremiereXml(input));

    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    expect(videoTracks).toHaveLength(2);

    const screenClips = getAllByTag(videoTracks[0], 'clipitem');
    const cameraClips = getAllByTag(videoTracks[1], 'clipitem');
    expect(screenClips).toHaveLength(2);
    expect(cameraClips).toHaveLength(2);

    expect(screenClips[0].getElementsByTagName('in')[0].textContent).toBe('90');
    expect(screenClips[0].getElementsByTagName('out')[0].textContent).toBe('150');
    expect(screenClips[0].getElementsByTagName('start')[0].textContent).toBe('0');
    expect(screenClips[0].getElementsByTagName('end')[0].textContent).toBe('60');

    expect(screenClips[1].getElementsByTagName('in')[0].textContent).toBe('210');
    expect(screenClips[1].getElementsByTagName('out')[0].textContent).toBe('300');
    expect(screenClips[1].getElementsByTagName('start')[0].textContent).toBe('60');
    expect(screenClips[1].getElementsByTagName('end')[0].textContent).toBe('150');

    expect(cameraClips[0].getElementsByTagName('in')[0].textContent).toBe('90');
    expect(cameraClips[0].getElementsByTagName('out')[0].textContent).toBe('150');
    expect(cameraClips[1].getElementsByTagName('start')[0].textContent).toBe('60');
  });

  test('buildPremiereXml records camera file asset at native (uncropped) dimensions', () => {
    const input = baseInput({
      canvasW: 3840,
      canvasH: 2160,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 10,
          screenWidth: 3840,
          screenHeight: 2160,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const files = getAllByTag(doc, 'file');
    const cameraFile = files.find(
      (f) =>
        f.getAttribute('id') === 'file-camera-take-1' &&
        f.getElementsByTagName('pathurl').length > 0
    );
    expect(cameraFile).toBeDefined();
    const samples = cameraFile!.getElementsByTagName('samplecharacteristics');
    const videoSample = Array.from(samples).find(
      (s) => s.getElementsByTagName('width')[0]?.textContent === '1920'
    );
    expect(videoSample).toBeDefined();
    expect(videoSample!.getElementsByTagName('height')[0].textContent).toBe('1080');
  });

  test('buildPremiereXml references shared file asset via id after first use', () => {
    const input = baseInput({
      sections: [
        { takeId: 'take-1', timelineStart: 0, timelineEnd: 2, sourceStart: 0, sourceEnd: 2 },
        { takeId: 'take-1', timelineStart: 2, timelineEnd: 4, sourceStart: 4, sourceEnd: 6 }
      ]
    });
    const xml = buildPremiereXml(input);
    const doc = parseXml(xml);
    const files = getAllByTag(doc, 'file');
    const screenFiles = files.filter((f) => f.getAttribute('id') === 'file-screen-take-1');
    expect(screenFiles.length).toBeGreaterThanOrEqual(2);
    const withPath = screenFiles.filter((f) => f.getElementsByTagName('pathurl').length > 0);
    expect(withPath).toHaveLength(1);
    expect(withPath[0].getElementsByTagName('pathurl')[0].textContent).toContain(
      'file:///tmp/proj/media/screen-take-1.mov'
    );
  });

  test('buildPremiereXml adds one screen audio track when camera is absent', () => {
    const input = baseInput({
      hasCamera: false,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: null,
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 5,
          cameraDurationSec: 0,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: null,
          cameraHeight: null
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const sequence = doc.getElementsByTagName('sequence')[0];
    const media = Array.from(sequence.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const videoEl = Array.from(media.childNodes).find(
      (n) => (n as Element).tagName === 'video'
    ) as Element;
    const audioEl = Array.from(media.childNodes).find(
      (n) => (n as Element).tagName === 'audio'
    ) as Element;
    const videoTracks = Array.from(videoEl.childNodes).filter(
      (n) => (n as Element).tagName === 'track'
    );
    const audioTracks = Array.from(audioEl.childNodes).filter(
      (n) => (n as Element).tagName === 'track'
    );
    expect(videoTracks).toHaveLength(1);
    expect(audioTracks).toHaveLength(1);
  });

  test('buildPremiereXml emits Basic Motion keyframes for camera PiP position/scale', () => {
    const input = baseInput({
      keyframes: [
        {
          time: 0,
          pipX: 100,
          pipY: 200,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        },
        {
          time: 2,
          pipX: 900,
          pipY: 500,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        }
      ]
    });

    const doc = parseXml(buildPremiereXml(input));
    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    const cameraClip = videoTracks[1].getElementsByTagName('clipitem')[0];
    const filter = cameraClip.getElementsByTagName('filter');
    expect(filter.length).toBeGreaterThan(0);

    const effects = Array.from(cameraClip.getElementsByTagName('effect'));
    const basicMotion = effects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'basic'
    );
    expect(basicMotion).toBeDefined();

    const params = Array.from(basicMotion!.getElementsByTagName('parameter'));
    const scale = params.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'scale'
    );
    const center = params.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'center'
    );
    expect(scale).toBeDefined();
    expect(center).toBeDefined();

    const scaleKfs = Array.from(scale!.getElementsByTagName('keyframe'));
    expect(scaleKfs.length).toBeGreaterThanOrEqual(2);

    const centerKfs = Array.from(center!.getElementsByTagName('keyframe'));
    expect(centerKfs.length).toBeGreaterThanOrEqual(2);

    const kfWhens = centerKfs.map((kf) => kf.getElementsByTagName('when')[0]?.textContent);
    expect(kfWhens).toContain('0');
    expect(kfWhens).toContain('60');
  });

  test('buildPremiereXml emits Opacity keyframes reflecting pipVisible transitions', () => {
    const input = baseInput({
      sections: [{ takeId: 'take-1', timelineStart: 0, timelineEnd: 4, sourceStart: 0, sourceEnd: 4 }],
      keyframes: [
        {
          time: 0,
          pipX: 100,
          pipY: 100,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        },
        {
          time: 2,
          pipX: 100,
          pipY: 100,
          pipVisible: false,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        }
      ]
    });

    const doc = parseXml(buildPremiereXml(input));
    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    const cameraClip = videoTracks[1].getElementsByTagName('clipitem')[0];
    const effects = Array.from(cameraClip.getElementsByTagName('effect'));
    const opacity = effects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'opacity'
    );
    expect(opacity).toBeDefined();

    const kfs = Array.from(opacity!.getElementsByTagName('keyframe'));
    expect(kfs.length).toBeGreaterThanOrEqual(2);

    const values = kfs.map((kf) => Number(kf.getElementsByTagName('value')[0]?.textContent));
    expect(values).toContain(100);
    expect(values).toContain(0);
  });

  test('buildPremiereXml emits screen Basic Motion for backgroundZoom keyframes', () => {
    const input = baseInput({
      sections: [{ takeId: 'take-1', timelineStart: 0, timelineEnd: 4, sourceStart: 0, sourceEnd: 4 }],
      keyframes: [
        {
          time: 0,
          pipX: 0,
          pipY: 0,
          pipVisible: false,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        },
        {
          time: 2,
          pipX: 0,
          pipY: 0,
          pipVisible: false,
          cameraFullscreen: false,
          backgroundZoom: 2,
          backgroundPanX: 0.5,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        }
      ],
      hasCamera: false,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: null,
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 5,
          cameraDurationSec: 0,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: null,
          cameraHeight: null
        }
      ]
    });

    const doc = parseXml(buildPremiereXml(input));
    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    const screenClip = videoTracks[0].getElementsByTagName('clipitem')[0];
    const effects = Array.from(screenClip.getElementsByTagName('effect'));
    const basicMotion = effects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'basic'
    );
    expect(basicMotion).toBeDefined();

    const params = Array.from(basicMotion!.getElementsByTagName('parameter'));
    const scale = params.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'scale'
    );
    expect(scale).toBeDefined();

    const scaleValues = Array.from(scale!.getElementsByTagName('keyframe')).map((kf) =>
      Number(kf.getElementsByTagName('value')[0]?.textContent)
    );
    expect(scaleValues).toContain(100);
    expect(scaleValues).toContain(200);
  });

  test('clipLocalKeyframesForSection holds previous value until transition window', () => {
    const keyframes = [
      {
        time: 1,
        pipX: 0,
        pipY: 0,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      },
      {
        time: 5,
        pipX: 400,
        pipY: 400,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      }
    ];

    // Section covers the transition window; boundary values should reflect
    // "held previous state" semantics, not a slow linear ramp across the gap.
    const locals = clipLocalKeyframesForSection(
      keyframes,
      { timelineStart: 2, timelineEnd: 5, sourceStart: 0, sourceEnd: 3 },
      30
    );

    expect(locals.length).toBeGreaterThanOrEqual(2);
    const first = locals[0];
    const last = locals[locals.length - 1];
    expect(first.frame).toBe(0);
    // At t=2 (well before transition start t=4.7), value is held at the prev
    // keyframe's pipX=0.
    expect(Math.round(first.pipX)).toBe(0);
    // At section end t=5, value reaches the next keyframe's pipX=400.
    expect(last.frame).toBe(90);
    expect(Math.round(last.pipX)).toBe(400);
  });

  test('computeCameraPipScalePercent uses shorter camera side so crop-to-square matches pipSize', () => {
    // 1920x1080 camera, pipSize_scaled=422 → 422/1080 * 100 = 39.074
    expect(computeCameraPipScalePercent(422, 1920, 1080)).toBeCloseTo(39.074, 2);
    // 3840x2160 sequence (scale 2x), pipSize_scaled = 422 * 2 = 844 → 844/1080 * 100 ≈ 78.15
    expect(computeCameraPipScalePercent(844, 1920, 1080)).toBeCloseTo(78.148, 2);
    // portrait 720x1280 camera: shorter = 720 → 422/720 * 100 ≈ 58.6
    expect(computeCameraPipScalePercent(422, 720, 1280)).toBeCloseTo(58.611, 2);
  });

  test('computeSquareCropPercents returns symmetric trims producing a square center', () => {
    // 1920x1080 → trim horizontal only; total trim = (1920-1080)/1920 = ~43.75% → 21.875 each side
    expect(computeSquareCropPercents(1920, 1080)).toEqual({
      left: 21.875,
      right: 21.875,
      top: 0,
      bottom: 0
    });
    // Already square → no crop
    expect(computeSquareCropPercents(1080, 1080)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0
    });
    // Portrait 720x1280 → trim vertical
    const portrait = computeSquareCropPercents(720, 1280);
    expect(portrait.left).toBe(0);
    expect(portrait.right).toBe(0);
    expect(portrait.top).toBeCloseTo((1280 - 720) / 1280 / 2 * 100, 4);
    expect(portrait.bottom).toBeCloseTo((1280 - 720) / 1280 / 2 * 100, 4);
  });

  test('expandKeyframesWithTransitionHolds injects 0.3s hold keyframes before each transition', () => {
    const kfs = [
      {
        time: 0,
        pipX: 100,
        pipY: 100,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      },
      {
        time: 5,
        pipX: 800,
        pipY: 400,
        pipVisible: true,
        cameraFullscreen: true,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      }
    ];
    const expanded = expandKeyframesWithTransitionHolds(kfs);
    expect(expanded).toHaveLength(3);
    expect(expanded[0].time).toBe(0);
    expect(expanded[1].time).toBeCloseTo(5 - TRANSITION_DURATION, 4);
    // Hold keyframe carries the PREVIOUS keyframe's values, not the next.
    expect(expanded[1].pipX).toBe(100);
    expect(expanded[1].cameraFullscreen).toBe(false);
    expect(expanded[2].time).toBe(5);
    expect(expanded[2].pipX).toBe(800);
  });

  test('expandKeyframesWithTransitionHolds skips hold when keyframes are closer than TRANSITION_DURATION', () => {
    const kfs = [
      {
        time: 0,
        pipX: 0,
        pipY: 0,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      },
      {
        time: 0.1,
        pipX: 100,
        pipY: 100,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      }
    ];
    const expanded = expandKeyframesWithTransitionHolds(kfs);
    expect(expanded).toHaveLength(2);
  });

  test('clipLocalKeyframesForSection emits a fast-transition pair around each keyframe change', () => {
    const kfs = [
      {
        time: 0,
        pipX: 100,
        pipY: 100,
        pipVisible: true,
        cameraFullscreen: false,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      },
      {
        time: 5,
        pipX: 100,
        pipY: 100,
        pipVisible: true,
        cameraFullscreen: true,
        backgroundZoom: 1,
        backgroundPanX: 0,
        backgroundPanY: 0,
        sectionId: null,
        autoSection: false
      }
    ];
    const locals = clipLocalKeyframesForSection(
      kfs,
      { timelineStart: 0, timelineEnd: 6, sourceStart: 0, sourceEnd: 6 },
      30
    );
    const frames = locals.map((k) => k.frame);
    // Should contain frames at 0, ~141 (5s - 0.3s = 4.7s * 30 = 141), 150 (5s), and 180 (section end)
    expect(frames).toContain(0);
    expect(frames).toContain(150);
    expect(frames.some((f) => Math.abs(f - Math.round((5 - TRANSITION_DURATION) * 30)) <= 1)).toBe(
      true
    );
  });

  test('computeCameraFullScalePercent covers sequence with camera preserving aspect', () => {
    // 1920x1080 camera in 1920x1080 sequence → 100%
    expect(computeCameraFullScalePercent(1920, 1080, 1920, 1080)).toBeCloseTo(100, 1);
    // 1920x1080 camera in 3840x2160 sequence → 200%
    expect(computeCameraFullScalePercent(3840, 2160, 1920, 1080)).toBeCloseTo(200, 1);
    // 16:9 camera in a 1:1 sequence → cover by the larger axis
    expect(computeCameraFullScalePercent(1000, 1000, 1920, 1080)).toBeCloseTo(
      Math.max(1000 / 1920, 1000 / 1080) * 100,
      1
    );
  });

  test('centerPxToFcpCenter maps canvas center to (0,0) and edges to +/-1', () => {
    expect(centerPxToFcpCenter(960, 540, 1920, 1080)).toEqual({ horiz: 0, vert: 0 });
    expect(centerPxToFcpCenter(0, 0, 1920, 1080)).toEqual({ horiz: -1, vert: -1 });
    expect(centerPxToFcpCenter(1920, 1080, 1920, 1080)).toEqual({ horiz: 1, vert: 1 });
  });

  test('buildPremiereXml positions camera PiP center to match editor square PiP center', () => {
    // Authoring pipX=0, pipY=0, pipSize=422 → center (211, 211) in 1920x1080.
    // With canvas 3840x2160, scaled center = (422, 422). horiz = (2*422-3840)/3840 ≈ -0.780, vert = (2*422-2160)/2160 ≈ -0.609
    const input = baseInput({
      canvasW: 3840,
      canvasH: 2160,
      pipSize: 422,
      keyframes: [
        {
          time: 0,
          pipX: 0,
          pipY: 0,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        }
      ],
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 10,
          screenWidth: 3840,
          screenHeight: 2160,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });

    const doc = parseXml(buildPremiereXml(input));
    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    const cameraClip = videoTracks[1].getElementsByTagName('clipitem')[0];
    const effects = Array.from(cameraClip.getElementsByTagName('effect'));
    const basicMotion = effects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'basic'
    );
    const params = Array.from(basicMotion!.getElementsByTagName('parameter'));
    const center = params.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'center'
    );
    const firstValue = center!.getElementsByTagName('value')[0];
    const horiz = Number(firstValue.getElementsByTagName('horiz')[0].textContent);
    const vert = Number(firstValue.getElementsByTagName('vert')[0].textContent);
    expect(horiz).toBeCloseTo((2 * 422 - 3840) / 3840, 3);
    expect(vert).toBeCloseTo((2 * 422 - 2160) / 2160, 3);

    const scale = params.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'scale'
    );
    const firstScale = Number(scale!.getElementsByTagName('value')[0].textContent);
    // canvasW/1920 = 2, canvasH/1080 = 2, pipSize_scaled = 422 * 2 = 844,
    // camera shorter side = 1080 → 844/1080 * 100 ≈ 78.148%
    expect(firstScale).toBeCloseTo(78.148, 2);

    // Crop effect present with square-center crop for the 1920x1080 camera.
    const allEffects = Array.from(cameraClip.getElementsByTagName('effect'));
    const cropEffect = allEffects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'crop'
    );
    expect(cropEffect).toBeDefined();

    // Crop must be classified as a filter/Matte so Premiere actually applies it.
    // Declaring it as a motion fixed-effect makes Premiere silently ignore the
    // effect and the PiP ends up un-cropped and mis-positioned.
    expect(cropEffect!.getElementsByTagName('effecttype')[0]?.textContent).toBe('filter');
    expect(cropEffect!.getElementsByTagName('effectcategory')[0]?.textContent).toBe('Matte');

    const cropParams = Array.from(cropEffect!.getElementsByTagName('parameter'));
    const leftParam = cropParams.find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'left'
    );
    const leftValue = Number(leftParam!.getElementsByTagName('value')[0].textContent);
    expect(leftValue).toBeCloseTo(21.875, 3);
  });

  test('buildPremiereXml keyframes Crop to zero when camera switches to fullscreen', () => {
    const input = baseInput({
      sections: [{ takeId: 'take-1', timelineStart: 0, timelineEnd: 6, sourceStart: 0, sourceEnd: 6 }],
      keyframes: [
        {
          time: 0,
          pipX: 100,
          pipY: 100,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        },
        {
          time: 5,
          pipX: 100,
          pipY: 100,
          pipVisible: true,
          cameraFullscreen: true,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0,
          sectionId: null,
          autoSection: false
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const videoTracks = getAllByTag(doc, 'video')[0].getElementsByTagName('track');
    const cameraClip = videoTracks[1].getElementsByTagName('clipitem')[0];
    const effects = Array.from(cameraClip.getElementsByTagName('effect'));
    const cropEffect = effects.find(
      (e) => e.getElementsByTagName('effectid')[0]?.textContent === 'crop'
    );
    const leftParam = Array.from(cropEffect!.getElementsByTagName('parameter')).find(
      (p) => p.getElementsByTagName('parameterid')[0]?.textContent === 'left'
    );
    const leftKfs = Array.from(leftParam!.getElementsByTagName('keyframe'));
    const leftValues = leftKfs.map((kf) => Number(kf.getElementsByTagName('value')[0]?.textContent));
    // Must contain both the square-crop percent (PiP) and 0 (fullscreen).
    expect(leftValues.some((v) => Math.abs(v - 21.875) < 0.001)).toBe(true);
    expect(leftValues.some((v) => Math.abs(v) < 0.001)).toBe(true);
  });

  function getSequenceAudioTrack(doc: Document): Element {
    // File assets can contain nested <audio> blocks, so reach into
    // sequence > media > audio directly instead of grabbing the first
    // document-order match.
    const sequence = doc.getElementsByTagName('sequence')[0];
    const media = Array.from(sequence.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const audioEl = Array.from(media.childNodes).find(
      (n) => (n as Element).tagName === 'audio'
    ) as Element;
    return Array.from(audioEl.childNodes).find(
      (n) => (n as Element).tagName === 'track'
    ) as Element;
  }

  test('buildPremiereXml points the audio clip at the camera file when audioSource is camera', () => {
    const input = baseInput({
      hasCamera: true,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'camera',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 10,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });
    const xml = buildPremiereXml(input);
    const doc = parseXml(xml);

    const audioTrack = getSequenceAudioTrack(doc);
    const audioClips = audioTrack.getElementsByTagName('clipitem');
    expect(audioClips).toHaveLength(1);
    // The audio clip must reference the camera asset id (not the screen one).
    const audioClip = audioClips[0];
    const fileEl = audioClip.getElementsByTagName('file')[0];
    expect(fileEl.getAttribute('id')).toBe('file-camera-take-1');
    // The full camera asset is emitted elsewhere (e.g. the V2 camera clip);
    // the audio clip may reference it with the short-form `<file id="..."/>`.
    // Verify the path lives on whichever emission carries the pathurl.
    const files = getAllByTag(doc, 'file');
    const cameraAssetWithPath = files.find(
      (f) =>
        f.getAttribute('id') === 'file-camera-take-1' &&
        f.getElementsByTagName('pathurl').length > 0
    );
    expect(cameraAssetWithPath).toBeDefined();
    const pathUrl =
      cameraAssetWithPath!.getElementsByTagName('pathurl')[0]?.textContent ?? '';
    expect(pathUrl).toContain('camera-take-1.mov');
    // And that full emission must now advertise an audio stream because the
    // mic is muxed into the camera webm for this take.
    const cameraMedia = Array.from(cameraAssetWithPath!.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const cameraAudioBlocks = Array.from(cameraMedia.childNodes).filter(
      (n) => (n as Element).tagName === 'audio'
    );
    expect(cameraAudioBlocks).toHaveLength(1);

    // The screen asset must advertise no audio now — the mic has moved.
    const screenAsset = files.find(
      (f) =>
        f.getAttribute('id') === 'file-screen-take-1' &&
        f.getElementsByTagName('pathurl').length > 0
    );
    expect(screenAsset).toBeDefined();
    const screenMedia = Array.from(screenAsset!.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const screenAudioBlocks = Array.from(screenMedia.childNodes).filter(
      (n) => (n as Element).tagName === 'audio'
    );
    expect(screenAudioBlocks).toHaveLength(0);
  });

  test('buildPremiereXml points the audio clip at a dedicated audio file when audioSource is external', () => {
    const input = baseInput({
      hasCamera: false,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: null,
          audioPath: '/tmp/proj/media/audio-take-1.wav',
          audioSource: 'external',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 0,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: null,
          cameraHeight: null
        }
      ]
    });
    const xml = buildPremiereXml(input);
    const doc = parseXml(xml);

    const audioTrack = getSequenceAudioTrack(doc);
    const audioClips = audioTrack.getElementsByTagName('clipitem');
    expect(audioClips).toHaveLength(1);
    const fileEl = audioClips[0].getElementsByTagName('file')[0];
    expect(fileEl.getAttribute('id')).toBe('file-audio-take-1');
    const pathUrl = fileEl.getElementsByTagName('pathurl')[0]?.textContent ?? '';
    expect(pathUrl).toContain('audio-take-1.wav');

    // No audio stream should be registered on the screen asset anymore.
    const files = getAllByTag(doc, 'file');
    const screenAsset = files.find(
      (f) =>
        f.getAttribute('id') === 'file-screen-take-1' &&
        f.getElementsByTagName('pathurl').length > 0
    );
    expect(screenAsset).toBeDefined();
    const screenMedia = Array.from(screenAsset!.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const screenAudioBlocks = Array.from(screenMedia.childNodes).filter(
      (n) => (n as Element).tagName === 'audio'
    );
    expect(screenAudioBlocks).toHaveLength(0);
  });

  test('buildPremiereXml keeps legacy takes emitting audio from the screen asset', () => {
    const input = baseInput({
      hasCamera: false,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: null,
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: false,
          screenDurationSec: 10,
          cameraDurationSec: 0,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: null,
          cameraHeight: null
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const audioTrack = getSequenceAudioTrack(doc);
    const audioClip = audioTrack.getElementsByTagName('clipitem')[0];
    const fileEl = audioClip.getElementsByTagName('file')[0];
    expect(fileEl.getAttribute('id')).toBe('file-screen-take-1');
  });

  test('buildPremiereXml emits a second audio track for system audio when hasSystemAudio is true', () => {
    const input = baseInput({
      hasCamera: true,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: '/tmp/proj/media/camera-take-1.mov',
          audioPath: null,
          audioSource: 'camera',
          hasSystemAudio: true,
          screenDurationSec: 10,
          cameraDurationSec: 10,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: 1920,
          cameraHeight: 1080
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));

    // Sequence should now carry two <audio> <track> children: mic (camera)
    // on track 1, system audio (screen) on track 2.
    const sequence = doc.getElementsByTagName('sequence')[0];
    const media = Array.from(sequence.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const audioEl = Array.from(media.childNodes).find(
      (n) => (n as Element).tagName === 'audio'
    ) as Element;
    const audioTracks = Array.from(audioEl.childNodes).filter(
      (n) => (n as Element).tagName === 'track'
    ) as Element[];
    expect(audioTracks).toHaveLength(2);

    const micClip = audioTracks[0].getElementsByTagName('clipitem')[0];
    const sysClip = audioTracks[1].getElementsByTagName('clipitem')[0];
    expect(micClip.getElementsByTagName('file')[0]?.getAttribute('id')).toBe(
      'file-camera-take-1'
    );
    expect(sysClip.getElementsByTagName('file')[0]?.getAttribute('id')).toBe(
      'file-screen-take-1'
    );
    expect(sysClip.getAttribute('id')).toMatch(/^clipitem-sysaudio/);

    // Screen asset must advertise audio now that system audio is present.
    const files = getAllByTag(doc, 'file');
    const screenAsset = files.find(
      (f) =>
        f.getAttribute('id') === 'file-screen-take-1' &&
        f.getElementsByTagName('pathurl').length > 0
    );
    expect(screenAsset).toBeDefined();
    const screenMedia = Array.from(screenAsset!.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const screenAudioBlocks = Array.from(screenMedia.childNodes).filter(
      (n) => (n as Element).tagName === 'audio'
    );
    expect(screenAudioBlocks).toHaveLength(1);
  });

  test('buildPremiereXml does NOT duplicate the audio track when legacy take reports hasSystemAudio', () => {
    // Legacy takes with mic muxed into the screen file should not get an
    // extra "system audio" clip pointing at the same asset — that would
    // double the same audio in Premiere.
    const input = baseInput({
      hasCamera: false,
      takes: [
        {
          id: 'take-1',
          screenPath: '/tmp/proj/media/screen-take-1.mov',
          cameraPath: null,
          audioPath: null,
          audioSource: 'screen',
          hasSystemAudio: true,
          screenDurationSec: 10,
          cameraDurationSec: 0,
          screenWidth: 1920,
          screenHeight: 1080,
          cameraWidth: null,
          cameraHeight: null
        }
      ]
    });
    const doc = parseXml(buildPremiereXml(input));
    const sequence = doc.getElementsByTagName('sequence')[0];
    const media = Array.from(sequence.childNodes).find(
      (n) => (n as Element).tagName === 'media'
    ) as Element;
    const audioEl = Array.from(media.childNodes).find(
      (n) => (n as Element).tagName === 'audio'
    ) as Element;
    const audioTracks = Array.from(audioEl.childNodes).filter(
      (n) => (n as Element).tagName === 'track'
    );
    expect(audioTracks).toHaveLength(1);
  });

  test('buildPremiereXml escapes special characters in project name and paths', () => {
    const xml = buildPremiereXml(
      baseInput({
        projectName: 'A & B <Demo>',
        takes: [
          {
            id: 'take-1',
            screenPath: '/tmp/proj/media/screen & <1>.mov',
            cameraPath: '/tmp/proj/media/camera-take-1.mov',
            audioPath: null,
            audioSource: 'screen',
            hasSystemAudio: false,
            screenDurationSec: 10,
            cameraDurationSec: 10,
            screenWidth: 1920,
            screenHeight: 1080,
            cameraWidth: 1920,
            cameraHeight: 1080
          }
        ]
      })
    );
    expect(xml).toContain('A &amp; B &lt;Demo&gt;');
    expect(xml).toContain('screen%20%26%20%3C1%3E.mov');
  });
});
