const fs = require('fs');
const os = require('os');
const path = require('path');

const { createProjectService } = require('../../src/main/services/project-service');

function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-project-service-'));
  const userData = path.join(root, 'user-data');
  const app = {
    getPath(name) {
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
  let sandbox;
  let service;

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
    expect(first.project.settings.cameraSyncOffsetMs).toBe(0);
    expect(second.project.settings.exportAudioPreset).toBe('compressed');
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

    const raw = JSON.parse(
      fs.readFileSync(path.join(created.projectPath, 'project.json'), 'utf8')
    );
    expect(raw.takes[0].screenPath).toBe('screen.webm');
    expect(raw.takes[0].cameraPath).toBe('camera.webm');
    expect(raw.timeline.keyframes[0].backgroundZoom).toBe(2.2);
    expect(raw.timeline.keyframes[0].backgroundPanX).toBe(0.3);
    expect(raw.timeline.keyframes[0].backgroundPanY).toBe(-0.4);
    expect(raw.settings.exportAudioPreset).toBe('compressed');
    expect(raw.settings.cameraSyncOffsetMs).toBe(145);

    const opened = service.openProject(created.projectPath);
    expect(opened.project.takes[0].screenPath).toBe(screenPath);
    expect(opened.project.timeline.sections).toHaveLength(1);
    expect(opened.project.timeline.keyframes[0].backgroundZoom).toBe(2.2);
    expect(opened.project.timeline.keyframes[0].backgroundPanX).toBe(0.3);
    expect(opened.project.timeline.keyframes[0].backgroundPanY).toBe(-0.4);
    expect(opened.project.settings.exportAudioPreset).toBe('compressed');
    expect(opened.project.settings.cameraSyncOffsetMs).toBe(145);
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
    expect(opened.recoveryTake.id).toBe('take-r');

    expect(service.clearRecoveryByProject(created.projectPath)).toBe(true);
    const reopened = service.openProject(created.projectPath);
    expect(reopened.recoveryTake).toBeNull();
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
    expect(loaded.projectPath).toBe(two.projectPath);
  });
});
