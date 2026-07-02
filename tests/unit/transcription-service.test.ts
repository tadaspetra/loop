import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  transcribeRecordingFile,
  type TranscriptionDeps
} from '../../src/main/services/transcription-service';

const OLD_ENV = process.env.ELEVENLABS_API_KEY;

function makeTempSource(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-transcribe-test-'));
  const sourcePath = path.join(dir, 'recording-take-1-camera.webm');
  fs.writeFileSync(sourcePath, Buffer.from('fake-webm-bytes'));
  return sourcePath;
}

function makeDeps(overrides: Partial<TranscriptionDeps> = {}): {
  deps: TranscriptionDeps;
  extractedPaths: string[];
  convertCalls: Array<Record<string, unknown>>;
} {
  const extractedPaths: string[] = [];
  const calls: Array<Record<string, unknown>> = [];

  const deps: TranscriptionDeps = {
    runFfmpegImpl: vi.fn(async (opts: { args?: string[] } = {}) => {
      // The output path is the last ffmpeg argument; write a fake extracted file
      const args = opts.args;
      const outPath = args?.[args.length - 1];
      if (typeof outPath === 'string') {
        fs.writeFileSync(outPath, Buffer.from('fake-extracted-audio'));
        extractedPaths.push(outPath);
      }
      return { stderr: '' };
    }) as TranscriptionDeps['runFfmpegImpl'],
    convertImpl: vi.fn(async (request: Record<string, unknown>) => {
      calls.push(request);
      return {
        languageCode: 'eng',
        languageProbability: 0.99,
        text: 'hello world',
        words: [
          { text: 'hello', start: 0.1, end: 0.4, type: 'word', logprob: -0.01 },
          { text: ' ', start: 0.4, end: 0.5, type: 'spacing', logprob: 0 },
          { text: 'world', start: 0.5, end: 0.9, type: 'word', logprob: -0.02 }
        ]
      };
    }),
    ...overrides
  };
  return { deps, extractedPaths, convertCalls: calls };
}

describe('main/services/transcription-service', () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (OLD_ENV === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = OLD_ENV;
    }
    vi.restoreAllMocks();
  });

  test('extracts audio with ffmpeg then transcribes the extracted file', async () => {
    const sourcePath = makeTempSource();
    const { deps, extractedPaths, convertCalls } = makeDeps();

    const result = await transcribeRecordingFile({ sourcePath }, deps);

    // ffmpeg was invoked with -vn (drop video) and stream-copied audio
    expect(deps.runFfmpegImpl).toHaveBeenCalledTimes(1);
    const ffmpegArgs = (deps.runFfmpegImpl as ReturnType<typeof vi.fn>).mock.calls[0][0].args;
    expect(ffmpegArgs).toContain('-vn');
    expect(ffmpegArgs).toContain(sourcePath);

    // The transcription request used the extracted audio file, not the source
    expect(convertCalls).toHaveLength(1);
    const uploaded = convertCalls[0].file as { path?: string };
    expect(uploaded?.path).toBe(extractedPaths[0]);
    expect(convertCalls[0].modelId).toBe('scribe_v2');

    // Words are normalized to plain serializable objects
    expect(result.words).toEqual([
      { text: 'hello', start: 0.1, end: 0.4, type: 'word' },
      { text: ' ', start: 0.4, end: 0.5, type: 'spacing' },
      { text: 'world', start: 0.5, end: 0.9, type: 'word' }
    ]);
    expect(result.languageCode).toBe('eng');
  });

  test('cleans up the extracted temp file on success', async () => {
    const sourcePath = makeTempSource();
    const { deps, extractedPaths } = makeDeps();

    await transcribeRecordingFile({ sourcePath }, deps);

    expect(extractedPaths).toHaveLength(1);
    expect(fs.existsSync(extractedPaths[0])).toBe(false);
  });

  test('cleans up the extracted temp file when transcription fails', async () => {
    const sourcePath = makeTempSource();
    const { deps, extractedPaths } = makeDeps({
      convertImpl: vi.fn(async () => {
        throw new Error('quota exceeded');
      })
    });

    await expect(transcribeRecordingFile({ sourcePath }, deps)).rejects.toThrow(
      /quota exceeded/
    );
    expect(extractedPaths).toHaveLength(1);
    expect(fs.existsSync(extractedPaths[0])).toBe(false);
  });

  test('propagates ffmpeg extraction failures', async () => {
    const sourcePath = makeTempSource();
    const { deps } = makeDeps({
      runFfmpegImpl: vi.fn(async () => {
        throw new Error('ffmpeg exploded');
      })
    });

    await expect(transcribeRecordingFile({ sourcePath }, deps)).rejects.toThrow(
      /ffmpeg exploded/
    );
    expect(deps.convertImpl).not.toHaveBeenCalled();
  });

  test('rejects when the source file does not exist', async () => {
    const { deps } = makeDeps();
    await expect(
      transcribeRecordingFile({ sourcePath: '/nonexistent/take.webm' }, deps)
    ).rejects.toThrow(/not found|no such file|does not exist/i);
    expect(deps.runFfmpegImpl).not.toHaveBeenCalled();
    expect(deps.convertImpl).not.toHaveBeenCalled();
  });

  test('rejects when the source file is empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-transcribe-test-'));
    const sourcePath = path.join(dir, 'empty.webm');
    fs.writeFileSync(sourcePath, Buffer.alloc(0));
    const { deps } = makeDeps();

    await expect(transcribeRecordingFile({ sourcePath }, deps)).rejects.toThrow(/empty/i);
    expect(deps.convertImpl).not.toHaveBeenCalled();
  });

  test('rejects early when ELEVENLABS_API_KEY is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const sourcePath = makeTempSource();
    const { deps } = makeDeps({ convertImpl: undefined });

    await expect(transcribeRecordingFile({ sourcePath }, deps)).rejects.toThrow(
      /ELEVENLABS_API_KEY/
    );
    expect(deps.runFfmpegImpl).not.toHaveBeenCalled();
  });

  test('passes the resolved ffmpeg binary path to the runner', async () => {
    const sourcePath = makeTempSource();
    const { deps } = makeDeps({ ffmpegPath: '/custom/ffmpeg' });

    await transcribeRecordingFile({ sourcePath }, deps);

    const call = (deps.runFfmpegImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.ffmpegPath).toBe('/custom/ffmpeg');
  });

  test('tolerates responses with missing words array', async () => {
    const sourcePath = makeTempSource();
    const { deps } = makeDeps({
      convertImpl: vi.fn(async () => ({ text: '', languageCode: 'eng' }))
    });

    const result = await transcribeRecordingFile({ sourcePath }, deps);
    expect(result.words).toEqual([]);
  });

  test('drops malformed word entries instead of failing', async () => {
    const sourcePath = makeTempSource();
    const { deps } = makeDeps({
      convertImpl: vi.fn(async () => ({
        text: 'ok',
        words: [
          { text: 'ok', start: 0, end: 0.3, type: 'word' },
          null,
          'garbage',
          { start: 1, end: 2 }
        ]
      }))
    });

    const result = await transcribeRecordingFile({ sourcePath }, deps);
    expect(result.words).toEqual([{ text: 'ok', start: 0, end: 0.3, type: 'word' }]);
  });
});
