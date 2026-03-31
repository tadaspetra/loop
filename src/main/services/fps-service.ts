import { execFile } from 'node:child_process';

export const COMMON_FRAME_RATES = [24, 25, 30, 50, 60];

export function parseFpsToken(token: unknown): number | null {
  if (typeof token !== 'string') return null;
  const value = token.trim();
  if (!value) return null;

  if (value.includes('/')) {
    const [numRaw, denRaw] = value.split('/');
    const numerator = Number(numRaw);
    const denominator = Number(denRaw);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }

    return numerator / denominator;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface MediaProbeResult {
  fps: number | null;
  hasAudio: boolean;
}

export function parseHasAudioFromProbeOutput(output: unknown): boolean {
  if (typeof output !== 'string') return false;
  return /Stream\s+#\d+:\d+[^:]*:\s*Audio:/i.test(output);
}

export function parseVideoFpsFromProbeOutput(output: unknown): number | null {
  if (typeof output !== 'string' || !output.trim()) return null;

  const patterns = [
    /,\s*([0-9]+(?:\.[0-9]+)?(?:\/[0-9]+(?:\.[0-9]+)?)?)\s*fps\b/i,
    /,\s*([0-9]+(?:\.[0-9]+)?(?:\/[0-9]+(?:\.[0-9]+)?)?)\s*tbr\b/i
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (!match) continue;

    const fps = parseFpsToken(match[1]);
    if (fps !== null && fps > 0) return fps;
  }

  return null;
}

export function probeVideoFpsWithFfmpeg(
  ffmpegPath: string,
  filePath: string
): Promise<MediaProbeResult> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-i', filePath],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`;
        const fps = parseVideoFpsFromProbeOutput(output);
        const hasAudio = parseHasAudioFromProbeOutput(output);
        if (error && !fps) {
          console.warn(`[render-composite] FPS probe failed for ${filePath}:`, error.message);
        }
        resolve({ fps, hasAudio });
      }
    );
  });
}

export function chooseRenderFps(candidates: unknown[], hasCamera: boolean): number {
  const valid = (Array.isArray(candidates) ? candidates : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 10 && value <= 120);

  let base = valid.length > 0 ? Math.max(...valid) : 30;
  if (hasCamera) base = Math.min(base, 30);

  let best = COMMON_FRAME_RATES[0];
  for (const rate of COMMON_FRAME_RATES) {
    if (Math.abs(rate - base) < Math.abs(best - base)) best = rate;
  }

  return hasCamera ? Math.min(best, 30) : best;
}
