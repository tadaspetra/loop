import path from 'node:path';
import fs from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import { runFfmpeg, type FfmpegProgress } from './ffmpeg-runner';

const MAX_CONCURRENT = 2;

let activeCount = 0;
const queue: Array<() => void> = [];

function drainQueue(): void {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()!;
    activeCount += 1;
    next();
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeCount -= 1;
          drainQueue();
        });
    });
    drainQueue();
  });
}

export function deriveProxyPath(screenPath: string): string {
  const dir = path.dirname(screenPath);
  const ext = path.extname(screenPath);
  const base = path.basename(screenPath, ext);
  return path.join(dir, `${base}-proxy.mp4`);
}

export interface GenerateProxyOpts {
  screenPath: string;
  proxyPath: string;
  onProgress?: (progress: FfmpegProgress) => void;
}

export interface GenerateProxyDeps {
  runFfmpeg?: typeof runFfmpeg;
  fs?: Pick<typeof fs, 'existsSync' | 'unlinkSync' | 'renameSync'>;
  ffmpegPath?: string;
}

export function generateProxy(
  opts: GenerateProxyOpts,
  deps: GenerateProxyDeps = {}
): Promise<void> {
  const runFfmpegImpl = deps.runFfmpeg ?? runFfmpeg;
  const fsImpl = deps.fs ?? fs;
  const ffmpegPath = deps.ffmpegPath ?? ffmpegStatic ?? undefined;

  return enqueue(async () => {
    const tmpPath = `${opts.proxyPath}.tmp`;

    if (fsImpl.existsSync(tmpPath)) {
      try {
        fsImpl.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }

    const args = [
      '-progress',
      'pipe:1',
      '-nostats',
      '-i',
      opts.screenPath,
      '-vf',
      'scale=960:540',
      '-c:v',
      'libx264',
      '-crf',
      '23',
      '-preset',
      'ultrafast',
      '-threads',
      '2',
      '-g',
      '15',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      '-y',
      tmpPath
    ];

    try {
      await runFfmpegImpl({ ffmpegPath, args, onProgress: opts.onProgress });
      fsImpl.renameSync(tmpPath, opts.proxyPath);
    } catch (err) {
      try {
        if (fsImpl.existsSync(tmpPath)) fsImpl.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

// Expose for testing
export function _getQueueState(): { activeCount: number; queueLength: number } {
  return { activeCount, queueLength: queue.length };
}

export function _resetQueue(): void {
  activeCount = 0;
  queue.length = 0;
}
