import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createProjectService } from '../../src/main/services/project-service';

function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-project-service-'));
  const userData = path.join(root, 'user-data');
  const app = {
    getPath(name: string) {
      if (name === 'userData') return userData;
      if (name === 'documents' || name === 'home') return root;
      return root;
    }
  };

  return {
    root,
    app,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe('main/services/project-service integration', () => {
  let sandbox: ReturnType<typeof createSandbox>;
  let service: ReturnType<typeof createProjectService>;

  beforeEach(() => {
    sandbox = createSandbox();
    service = createProjectService({ app: sandbox.app });
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  test('createProject creates project files and unique folders', () => {
    const first = service.createProject({ name: 'Demo', parentFolder: sandbox.root });
    const second = service.createProject({ name: 'Demo', parentFolder: sandbox.root });

    expect(fs.existsSync(path.join(first.projectPath, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(second.projectPath, 'project.json'))).toBe(true);
    expect(second.projectPath).not.toBe(first.projectPath);
    expect(first.project.settings.exportAudioPreset).toBe('compressed');
    expect(first.project.settings.exportVideoPreset).toBe('quality');
    expect(first.project.settings.cameraSyncOffsetMs).toBe(0);
    expect(second.project.settings.exportAudioPreset).toBe('compressed');
    expect(second.project.settings.exportVideoPreset).toBe('quality');
    expect(second.project.settings.cameraSyncOffsetMs).toBe(0);
  });

  test('saveProject and openProject round-trip takes and relative paths', () => {
    const created = service.createProject({ name: 'Roundtrip', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    const cameraPath = path.join(created.projectPath, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const saved = service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        settings: {
          ...created.project.settings,
          exportAudioPreset: 'compressed',
          exportVideoPreset: 'fast',
          cameraSyncOffsetMs: 145
        },
        takes: [
          {
            id: 'take-1',
            duration: 2.5,
            screenPath,
            cameraPath,
            sections: [{ start: 0, end: 2.5, sourceStart: 0, sourceEnd: 2.5 }]
          }
        ],
        timeline: {
          duration: 2.5,
          sections: [{ start: 0, end: 2.5, sourceStart: 0, sourceEnd: 2.5, takeId: 'take-1' }],
          keyframes: [
            {
              time: 0,
              pipX: 40,
              pipY: 50,
              pipVisible: true,
              cameraFullscreen: false,
              backgroundZoom: 2.2,
              backgroundPanX: 0.3,
              backgroundPanY: -0.4,
              sectionId: 'section-1',
              autoSection: true
            }
          ],
          selectedSectionId: null,
          hasCamera: true,
          sourceWidth: 1920,
          sourceHeight: 1080
        }
      }
    });

    expect(saved.project.takes[0].screenPath).toBe(screenPath);

    const raw = JSON.parse(fs.readFileSync(path.join(created.projectPath, 'project.json'), 'utf8'));
    expect(raw.takes[0].screenPath).toBe('screen.webm');
    expect(raw.takes[0].cameraPath).toBe('camera.webm');
    expect(raw.timeline.keyframes[0].backgroundZoom).toBe(2.2);
    expect(raw.timeline.keyframes[0].backgroundPanX).toBe(0.3);
    expect(raw.timeline.keyframes[0].backgroundPanY).toBe(-0.4);
    expect(raw.settings.exportAudioPreset).toBe('compressed');
    expect(raw.settings.exportVideoPreset).toBe('fast');
    expect(raw.settings.cameraSyncOffsetMs).toBe(145);

    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].screenPath).toBe(screenPath);
    expect(opened.project.timeline.sections).toHaveLength(1);
    expect(opened.project.timeline.keyframes[0].backgroundZoom).toBe(2.2);
    expect(opened.project.timeline.keyframes[0].backgroundPanX).toBe(0.3);
    expect(opened.project.timeline.keyframes[0].backgroundPanY).toBe(-0.4);
    expect(opened.project.settings.exportAudioPreset).toBe('compressed');
    expect(opened.project.settings.exportVideoPreset).toBe('fast');
    expect(opened.project.settings.cameraSyncOffsetMs).toBe(145);
  });

  test('proxyPath round-trips through save and open as relative path', () => {
    const created = service.createProject({ name: 'Proxy', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    const proxyPath = path.join(created.projectPath, 'screen-proxy.mp4');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(proxyPath, 'proxy', 'utf8');

    service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        takes: [
          {
            id: 'take-1',
            createdAt: new Date().toISOString(),
            duration: 5,
            screenPath,
            cameraPath: null,
            proxyPath,
            sections: []
          }
        ]
      }
    });

    // Verify on-disk format uses relative path
    const raw = JSON.parse(fs.readFileSync(path.join(created.projectPath, 'project.json'), 'utf8'));
    expect(raw.takes[0].proxyPath).toBe('screen-proxy.mp4');

    // Verify open resolves back to absolute
    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].proxyPath).toBe(proxyPath);
  });

  test('cameraProxyPath round-trips through save and open as relative path', () => {
    const created = service.createProject({ name: 'CameraProxy', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    const cameraPath = path.join(created.projectPath, 'camera.webm');
    const cameraProxyPath = path.join(created.projectPath, 'camera-proxy-v2.mp4');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');
    fs.writeFileSync(cameraProxyPath, 'proxy', 'utf8');

    service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        takes: [
          {
            id: 'take-1',
            createdAt: new Date().toISOString(),
            duration: 5,
            screenPath,
            cameraPath,
            proxyPath: null,
            cameraProxyPath,
            sections: []
          }
        ]
      }
    });

    const raw = JSON.parse(
      fs.readFileSync(path.join(created.projectPath, 'project.json'), 'utf8')
    );
    expect(raw.takes[0].cameraProxyPath).toBe('camera-proxy-v2.mp4');

    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].cameraProxyPath).toBe(cameraProxyPath);
    // Legacy takes without a cameraProxyPath field must hydrate to null,
    // not undefined, so the renderer's "!take.cameraProxyPath" trigger
    // keeps working without special-casing missing fields.
    service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        takes: [
          {
            id: 'take-legacy',
            createdAt: new Date().toISOString(),
            duration: 2,
            screenPath,
            cameraPath: null,
            proxyPath: null,
            sections: []
          }
        ]
      }
    });
    const legacyOpened = service.openProject(created.projectPath);
    expect(legacyOpened.project.takes[0].cameraProxyPath).toBeNull();
  });

  test('recorder start offsets round-trip through save and open, defaulting to 0', () => {
    const created = service.createProject({ name: 'StartOffsets', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    const cameraPath = path.join(created.projectPath, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        takes: [
          {
            id: 'take-offsets',
            createdAt: new Date().toISOString(),
            duration: 4,
            screenPath,
            cameraPath,
            proxyPath: null,
            sections: [],
            screenStartOffsetMs: 0,
            cameraStartOffsetMs: 187,
            audioStartOffsetMs: 0
          },
          {
            id: 'take-legacy',
            createdAt: new Date().toISOString(),
            duration: 2,
            screenPath,
            cameraPath: null,
            proxyPath: null,
            sections: []
          }
        ]
      }
    });

    const raw = JSON.parse(
      fs.readFileSync(path.join(created.projectPath, 'project.json'), 'utf8')
    );
    expect(raw.takes[0].screenStartOffsetMs).toBe(0);
    expect(raw.takes[0].cameraStartOffsetMs).toBe(187);
    expect(raw.takes[0].audioStartOffsetMs).toBe(0);

    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].screenStartOffsetMs).toBe(0);
    expect(opened.project.takes[0].cameraStartOffsetMs).toBe(187);
    expect(opened.project.takes[0].audioStartOffsetMs).toBe(0);
    // Legacy takes that were saved before the fields existed must default to 0
    // (not NaN/undefined) so downstream consumers can treat them uniformly.
    expect(opened.project.takes[1].screenStartOffsetMs).toBe(0);
    expect(opened.project.takes[1].cameraStartOffsetMs).toBe(0);
    expect(opened.project.takes[1].audioStartOffsetMs).toBe(0);
  });

  test('proxyPath defaults to null for legacy takes without proxy', () => {
    const created = service.createProject({ name: 'Legacy', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    service.saveProject({
      projectPath: created.projectPath,
      project: {
        ...created.project,
        takes: [
          {
            id: 'take-1',
            createdAt: new Date().toISOString(),
            duration: 5,
            screenPath,
            cameraPath: null,
            proxyPath: null,
            sections: []
          }
        ]
      }
    });

    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].proxyPath).toBeNull();
  });

  test('recovery take lifecycle persists and clears payload', () => {
    const created = service.createProject({ name: 'Recovery', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const recovery = service.setRecoveryTake({
      projectPath: created.projectPath,
      take: {
        id: 'take-r',
        screenPath,
        recordedDuration: 4.2,
        sections: [{ start: 0, end: 4.2, sourceStart: 0, sourceEnd: 4.2 }],
        trimSegments: [{ start: 0, end: 1, text: 'hello' }]
      }
    });

    expect(recovery.recoveryTake.id).toBe('take-r');

    const opened = service.openProject(created.projectPath);
    expect(opened.recoveryTake).toBeTruthy();
    expect(opened.recoveryTake!.id).toBe('take-r');

    expect(service.clearRecoveryByProject(created.projectPath)).toBe(true);
    const reopened = service.openProject(created.projectPath);
    expect(reopened.recoveryTake).toBeNull();
  });

  test('recovery take survives a missing camera file by dropping the camera pointer', () => {
    const created = service.createProject({ name: 'RecoveryPartial', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    const cameraPath = path.join(created.projectPath, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    service.setRecoveryTake({
      projectPath: created.projectPath,
      take: {
        id: 'take-partial',
        screenPath,
        cameraPath,
        recordedDuration: 2,
        sections: [{ start: 0, end: 2, sourceStart: 0, sourceEnd: 2 }],
        trimSegments: []
      }
    });

    // Simulate the camera file disappearing (crash mid-finalize, manual delete, etc.)
    fs.unlinkSync(cameraPath);

    const opened = service.openProject(created.projectPath);
    expect(opened.recoveryTake).not.toBeNull();
    expect(opened.recoveryTake!.id).toBe('take-partial');
    expect(opened.recoveryTake!.screenPath).toBe(screenPath);
    expect(opened.recoveryTake!.cameraPath).toBeNull();
    // Recovery file should still exist so the next open can still recover it.
    expect(fs.existsSync(path.join(created.projectPath, '.pending-recording.json'))).toBe(true);
  });

  test('recovery take with no screen file is discarded on open', () => {
    const created = service.createProject({ name: 'RecoveryGone', parentFolder: sandbox.root });
    const screenPath = path.join(created.projectPath, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    service.setRecoveryTake({
      projectPath: created.projectPath,
      take: {
        id: 'take-gone',
        screenPath,
        recordedDuration: 1,
        sections: [{ start: 0, end: 1, sourceStart: 0, sourceEnd: 1 }]
      }
    });

    fs.unlinkSync(screenPath);

    const opened = service.openProject(created.projectPath);
    expect(opened.recoveryTake).toBeNull();
    // Stale recovery file is cleaned up.
    expect(fs.existsSync(path.join(created.projectPath, '.pending-recording.json'))).toBe(false);
  });

  test('saveVideo writes recording atomically and verifies file size', () => {
    const created = service.createProject({ name: 'SaveVideo', parentFolder: sandbox.root });
    const data = Buffer.alloc(1024, 0xab);
    const savedPath = service.saveVideo(data, created.projectPath, 'screen');

    expect(savedPath).toMatch(/recording-\d+-screen\.webm$/);
    expect(fs.existsSync(savedPath)).toBe(true);

    const written = fs.readFileSync(savedPath);
    expect(written.length).toBe(1024);
    expect(Buffer.compare(written, data)).toBe(0);

    // No leftover temp files in the project folder
    const files = fs.readdirSync(created.projectPath).filter((f) => f.startsWith('.tmp-'));
    expect(files).toHaveLength(0);
  });

  test('saveVideo accepts Uint8Array input', () => {
    const created = service.createProject({ name: 'SaveVideoU8', parentFolder: sandbox.root });
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const savedPath = service.saveVideo(data, created.projectPath, 'camera');

    expect(fs.existsSync(savedPath)).toBe(true);
    const written = fs.readFileSync(savedPath);
    expect(written.length).toBe(5);
  });

  test('recent project metadata tracks last project and list', () => {
    const one = service.createProject({ name: 'One', parentFolder: sandbox.root });
    const two = service.createProject({ name: 'Two', parentFolder: sandbox.root });

    service.setLastProject(one.projectPath);
    service.setLastProject(two.projectPath);

    const recent = service.listRecentProjects(10);
    expect(recent.projects.length).toBeGreaterThan(0);
    expect(recent.lastProjectPath).toBe(two.projectPath);

    const loaded = service.loadLastProject();
    expect(loaded).not.toBeNull();
    expect(loaded!.projectPath).toBe(two.projectPath);
  });
});
