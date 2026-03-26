const path = require('path');
const fs = require('fs');
const { runFfmpeg } = require('./ffmpeg-runner');

const MAX_CONCURRENT = 2;

let activeCount = 0;
const queue = [];

function drainQueue() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    activeCount += 1;
    next().finally(() => {
      activeCount -= 1;
      drainQueue();
    });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    drainQueue();
  });
}

/**
 * Generate a proxy MP4 for a screen recording.
 * Writes to a `.tmp` path first, then renames on success.
 * Deletes the `.tmp` file on failure.
 *
 * @param {object} opts
 * @param {string} opts.screenPath  Absolute path to the source .webm
 * @param {string} opts.proxyPath   Absolute path where the proxy .mp4 should be written
 * @param {string} opts.ffmpegPath  Path to the ffmpeg binary
 * @param {object} [deps]           Injectable deps for testing
 * @returns {Promise<void>}
 */
function generateProxy({ screenPath, proxyPath, ffmpegPath: explicitPath, onProgress }, deps = {}) {
  const runFfmpegImpl = deps.runFfmpeg || runFfmpeg;
  const fsImpl = deps.fs || fs;
  const ffmpegPath = explicitPath || deps.ffmpegPath || require('ffmpeg-static');

  return enqueue(async () => {
    const tmpPath = `${proxyPath}.tmp`;

    // Clean up any stale tmp from a previous failed attempt
    if (fsImpl.existsSync(tmpPath)) {
      try { fsImpl.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    }

    const args = [
      '-progress', 'pipe:1', '-nostats',
      '-i', screenPath,
      '-vf', 'scale=960:540',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'ultrafast',
      '-threads', '2',
      '-g', '15',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-movflags', '+faststart',
      '-f', 'mp4',
      '-y',
      tmpPath
    ];

    try {
      await runFfmpegImpl({ ffmpegPath, args, onProgress });
      fsImpl.renameSync(tmpPath, proxyPath);
    } catch (err) {
      // Clean up partial tmp file on failure
      try { if (fsImpl.existsSync(tmpPath)) fsImpl.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
      throw err;
    }
  });
}

/**
 * Derive the proxy output path from a source screen path.
 * recording-1710000000000-screen.webm → recording-1710000000000-screen-proxy.mp4
 */
function deriveProxyPath(screenPath) {
  const dir = path.dirname(screenPath);
  const ext = path.extname(screenPath);
  const base = path.basename(screenPath, ext);
  return path.join(dir, `${base}-proxy.mp4`);
}

module.exports = { generateProxy, deriveProxyPath };
