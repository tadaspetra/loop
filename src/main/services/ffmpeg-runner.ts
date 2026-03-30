import { spawn } from 'node:child_process';

interface FfmpegProgressFields {
  [key: string]: string | undefined;
}

export interface FfmpegProgress {
  status: string;
  frame: number | null;
  fps: number | null;
  speed: number | null;
  outTimeSec: number | null;
  raw: FfmpegProgressFields;
}

export function parseTimeToSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  const parts = value.trim().split(':');
  if (parts.length !== 3) return null;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function parseNumericField(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSpeedField(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  return parseNumericField(value.replace(/x$/i, ''));
}

export function parseFfmpegProgress(
  fields: FfmpegProgressFields | null | undefined
): FfmpegProgress | null {
  if (!fields || typeof fields !== 'object') return null;
  const status = typeof fields.progress === 'string' ? fields.progress : null;
  if (!status) return null;

  const outTimeSec = parseTimeToSeconds(fields.out_time);
  return {
    status,
    frame: parseNumericField(fields.frame),
    fps: parseNumericField(fields.fps),
    speed: parseSpeedField(fields.speed),
    outTimeSec,
    raw: { ...fields }
  };
}

export function runFfmpeg({
  ffmpegPath,
  args,
  spawnImpl = spawn,
  onProgress
}: {
  ffmpegPath?: string;
  args?: string[];
  spawnImpl?: typeof spawn;
  onProgress?: (progress: FfmpegProgress) => void;
} = {}): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ffmpegPath as string, Array.isArray(args) ? args : [], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    let stderr = '';
    let currentProgress: FfmpegProgressFields = {};
    let settled = false;

    function resolveOnce(value: { stderr: string }) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    function rejectOnce(error: Error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function processStdoutChunk(chunk: Buffer | string) {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) continue;

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);
        currentProgress[key] = value;

        if (key === 'progress') {
          const parsed = parseFfmpegProgress(currentProgress);
          if (parsed && typeof onProgress === 'function') onProgress(parsed);
          currentProgress = {};
        }
      }
    }

    child.stdout.on('data', processStdoutChunk);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      rejectOnce(error);
    });

    child.once('close', (code) => {
      if (stdoutBuffer.trim()) processStdoutChunk('\n');
      if (code === 0) {
        resolveOnce({ stderr });
        return;
      }

      rejectOnce(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}
