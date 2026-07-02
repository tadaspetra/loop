import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import ffmpegStatic from 'ffmpeg-static';

import { runFfmpeg } from './ffmpeg-runner';
import { getRequiredEnv } from './scribe-service';

export interface TranscriptionWord {
  text: string;
  start?: number;
  end?: number;
  type?: string;
}

export interface TranscribeRecordingResult {
  words: TranscriptionWord[];
  languageCode?: string;
}

export interface TranscribeRecordingOptions {
  /** Finalized recording file that carries the mic audio (audio-only or camera webm). */
  sourcePath: string;
  languageCode?: string;
}

export interface TranscriptionDeps {
  runFfmpegImpl?: typeof runFfmpeg;
  ffmpegPath?: string;
  /**
   * Performs the batch speech-to-text request. Defaults to the ElevenLabs SDK;
   * injectable so tests never touch the network.
   */
  convertImpl?: (request: {
    modelId: string;
    file: { path: string };
    timestampsGranularity: string;
    tagAudioEvents: boolean;
    diarize: boolean;
    languageCode?: string;
  }) => Promise<unknown>;
}

async function defaultConvertImpl(request: {
  modelId: string;
  file: { path: string };
  timestampsGranularity: string;
  tagAudioEvents: boolean;
  diarize: boolean;
  languageCode?: string;
}): Promise<unknown> {
  const apiKey = getRequiredEnv('ELEVENLABS_API_KEY');
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const client = new ElevenLabsClient({ apiKey });
  return client.speechToText.convert(request as never);
}

function normalizeWords(rawWords: unknown): TranscriptionWord[] {
  if (!Array.isArray(rawWords)) return [];
  const words: TranscriptionWord[] = [];
  for (const raw of rawWords) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as { text?: unknown; start?: unknown; end?: unknown; type?: unknown };
    if (typeof candidate.text !== 'string') continue;
    const word: TranscriptionWord = { text: candidate.text };
    if (typeof candidate.start === 'number' && Number.isFinite(candidate.start)) {
      word.start = candidate.start;
    }
    if (typeof candidate.end === 'number' && Number.isFinite(candidate.end)) {
      word.end = candidate.end;
    }
    if (typeof candidate.type === 'string') {
      word.type = candidate.type;
    }
    words.push(word);
  }
  return words;
}

/**
 * Transcribes a finalized recording file with batch Scribe.
 *
 * The source recording is never modified: audio is stream-copied (no
 * re-encode) into a temp file with ffmpeg first, both to drop video payload
 * from the upload and to rewrite the container headers MediaRecorder leaves
 * incomplete (partial WebM metadata). The temp file is always removed, and
 * every failure surfaces as a rejection for the caller to handle — this
 * service must never affect the durability of the recording itself.
 */
export async function transcribeRecordingFile(
  { sourcePath, languageCode = 'eng' }: TranscribeRecordingOptions,
  deps: TranscriptionDeps = {}
): Promise<TranscribeRecordingResult> {
  const runFfmpegImpl = deps.runFfmpegImpl || runFfmpeg;
  const convertImpl = deps.convertImpl || defaultConvertImpl;

  // Fail fast before doing any work when the key is absent, so the renderer
  // gets a clear, actionable error instead of a late SDK failure.
  getRequiredEnv('ELEVENLABS_API_KEY');

  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('Transcription source path is required');
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch {
    throw new Error(`Transcription source not found: ${sourcePath}`);
  }
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`Transcription source is empty: ${sourcePath}`);
  }

  const tempAudioPath = path.join(
    os.tmpdir(),
    `loop-transcribe-${crypto.randomBytes(6).toString('hex')}.webm`
  );

  try {
    await runFfmpegImpl({
      ffmpegPath: deps.ffmpegPath ?? ffmpegStatic ?? undefined,
      args: ['-hide_banner', '-nostdin', '-i', sourcePath, '-vn', '-c:a', 'copy', '-y', tempAudioPath]
    });

    const response = (await convertImpl({
      modelId: 'scribe_v2',
      file: { path: tempAudioPath },
      timestampsGranularity: 'word',
      tagAudioEvents: false,
      diarize: false,
      languageCode
    })) as { words?: unknown; languageCode?: unknown } | null;

    const result: TranscribeRecordingResult = {
      words: normalizeWords(response?.words)
    };
    if (typeof response?.languageCode === 'string') {
      result.languageCode = response.languageCode;
    }
    return result;
  } finally {
    try {
      fs.rmSync(tempAudioPath, { force: true });
    } catch {
      // Best-effort temp cleanup; never mask the primary error.
    }
  }
}
