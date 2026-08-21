import { describe, expect, test, vi } from 'vitest';

import {
  detectRetakesWithLlm,
  RETAKE_LLM_DEFAULT_MODEL,
  RetakeLlmUnavailableError
} from '../../src/main/services/retake-llm-service';

const CHUNKS = [
  { index: 0, text: 'You can now use the CLI from your terminal. For example...', gapAfterSec: 2 },
  { index: 1, text: 'You can now use your s--', gapAfterSec: 3 },
  { index: 2, text: 'You can now use ElevenLabs directly from the command line.', gapAfterSec: 0 }
];

function fakeFetchReturning(content: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => ''
  })) as unknown as typeof fetch;
}

describe('detectRetakesWithLlm', () => {
  test('throws the unavailable error when no API key is configured', async () => {
    await expect(
      detectRetakesWithLlm({ chunks: CHUNKS }, { apiKey: '', fetchImpl: fakeFetchReturning('{}') })
    ).rejects.toBeInstanceOf(RetakeLlmUnavailableError);
  });

  test('sends chunk lines to the OpenAI chat completions endpoint and returns validated indices', async () => {
    const fetchImpl = fakeFetchReturning('{"removed": [0, 1]}');
    const result = await detectRetakesWithLlm({ chunks: CHUNKS }, { apiKey: 'sk-test', fetchImpl });

    expect(result.removedIndices).toEqual([0, 1]);
    expect(result.model).toBe(RETAKE_LLM_DEFAULT_MODEL);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');

    const body = JSON.parse(init.body);
    expect(body.model).toBe(RETAKE_LLM_DEFAULT_MODEL);
    expect(body.response_format).toEqual({ type: 'json_object' });
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('You can now use your s--');
    expect(userMessage.content).toContain('pause_after=3s');
  });

  test('filters indices the payload never offered', async () => {
    const fetchImpl = fakeFetchReturning('{"removed": [1, 7, -2, 0.5, "x"]}');
    const result = await detectRetakesWithLlm({ chunks: CHUNKS }, { apiKey: 'sk-test', fetchImpl });
    expect(result.removedIndices).toEqual([1]);
  });

  test('throws on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'server exploded'
    })) as unknown as typeof fetch;
    await expect(
      detectRetakesWithLlm({ chunks: CHUNKS }, { apiKey: 'sk-test', fetchImpl })
    ).rejects.toThrow(/500/);
  });

  test('throws on a response that is not the expected JSON shape', async () => {
    await expect(
      detectRetakesWithLlm(
        { chunks: CHUNKS },
        { apiKey: 'sk-test', fetchImpl: fakeFetchReturning('not json at all') }
      )
    ).rejects.toThrow(/response/i);
  });

  test('rejects payloads without at least two valid chunks', async () => {
    const fetchImpl = fakeFetchReturning('{"removed": []}');
    await expect(
      detectRetakesWithLlm({ chunks: [] }, { apiKey: 'sk-test', fetchImpl })
    ).rejects.toThrow(/chunks/i);
    await expect(
      detectRetakesWithLlm(
        { chunks: [{ index: 0, text: 'only one' }] },
        { apiKey: 'sk-test', fetchImpl }
      )
    ).rejects.toThrow(/chunks/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
