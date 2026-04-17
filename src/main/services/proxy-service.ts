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

// Version suffix used so proxies produced by previous releases (which
// constant-framerate-normalized the source and therefore could not be mixed
// with the raw camera stream in editor playback) are treated as cache misses
// and regenerated on open. Bump this whenever the proxy filter graph or
// encoding parameters change in a way that affects editor-playback sync.
const PROXY_VERSION_SUFFIX = '-proxy-v2.mp4';

export function deriveProxyPath(screenPath: string): string {
  const dir = path.dirname(screenPath);
  const ext = path.extname(screenPath);
  const base = path.basename(screenPath, ext);
  return path.join(dir, `${base}${PROXY_VERSION_SUFFIX}`);
}

/**
 * Returns true when the given proxy path matches the version produced by
 * the current `deriveProxyPath` / `generateProxy` implementation. Older
 * proxies (timestamp-normalized CFR) will return false so the renderer can
 * discard them and trigger a fresh generation compatible with the raw
 * camera stream.
 */
export function isCurrentProxyPath(proxyPath: string | null | undefined): boolean {
  return typeof proxyPath === 'string' && proxyPath.endsWith(PROXY_VERSION_SUFFIX);
}

export interface GenerateProxyOpts {
  screenPath: string;
  proxyPath: string;
  onProgress?: (progress: FfmpegProgress) => void;
  signal?: AbortSignal;
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

    // Preserve the input's per-frame timestamps so the proxy can be played
    // side-by-side with the raw camera WebM in the editor without the two
    // clocks diverging. The previous generator ran `fps=30,setpts=N/(30*TB)`
    // which produced a strictly-30fps CFR file — playing such a proxy next
    // to a raw camera stream drifted visibly on long recordings because
    // dropped frames in the source ended up at different PTS than the
    // matching moments in the camera file. `-fps_mode passthrough` asks
    // ffmpeg to leave input PTS alone; we only scale and transcode.
    const args = [
      '-progress',
      'pipe:1',
      '-nostats',
      '-fflags',
      '+genpts',
      '-i',
      opts.screenPath,
      '-vf',
      'scale=960:540',
      '-fps_mode',
      'passthrough',
      '-c:v',
      'libx264',
      '-crf',
      '23',
      '-preset',
      'ultrafast',
      '-threads',
      '2',
      // Smaller keyframe interval keeps editor scrubbing on the proxy
      // responsive even though we no longer force a CFR grid.
      '-g',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      '-y',
      tmpPath
    ];

    try {
      await runFfmpegImpl({
        ffmpegPath,
        args,
        onProgress: opts.onProgress,
        signal: opts.signal
      });
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
