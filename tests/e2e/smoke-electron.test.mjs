import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const electronBin =
  process.platform === 'win32'
    ? path.join(projectRoot, 'node_modules', '.bin', 'electron.cmd')
    : path.join(projectRoot, 'node_modules', '.bin', 'electron');

function getElectronSpawnSpec() {
  const args = getElectronArgs();
  if (process.platform === 'win32') {
    return {
      command: electronBin,
      args,
      shell: true
    };
  }

  return {
    command: electronBin,
    args,
    shell: false
  };
}

function getElectronArgs() {
  const args = ['.'];
  const isCiLinux = process.platform === 'linux' && process.env.CI;
  if (isCiLinux) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return args;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore'
    });
    return;
  }

  child.kill('SIGTERM');
  await wait(500);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function runSmoke() {
  const spawnSpec = getElectronSpawnSpec();
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: projectRoot,
    shell: spawnSpec.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  const startedAt = Date.now();
  let earlyExit = null;
  child.on('exit', (code, signal) => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 3000) {
      earlyExit = { code, signal, elapsed };
    }
  });

  await wait(4000);

  if (earlyExit) {
    throw new Error(
      `Electron exited too early (${earlyExit.elapsed}ms, code=${earlyExit.code}, signal=${earlyExit.signal}).\n${stderr}`
    );
  }

  if (child.exitCode !== null) {
    throw new Error(`Electron exited unexpectedly with code ${child.exitCode}.\n${stderr}`);
  }

  await terminateChild(child);
}

runSmoke()
  .then(() => {
    assert.ok(true);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
