/**
 * LLM-assisted retake detection (main process only). Sends the transcript as
 * numbered sentence chunks to the OpenAI chat completions API and asks which
 * chunks are abandoned attempts that a later chunk re-delivers. The model can
 * only pick among the offered chunk indices — time ranges are resolved back
 * in the renderer from our own chunk boundaries, so a confabulated response
 * can at worst flag a wrong chunk (which stays restorable), never an
 * arbitrary span. The API key stays in this process and is read from env.
 */

export interface RetakeChunkInput {
  index: number;
  text: string;
  gapAfterSec?: number;
}

export interface DetectRetakesLlmResult {
  removedIndices: number[];
  model: string;
}

export interface RetakeLlmDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export const RETAKE_LLM_DEFAULT_MODEL = 'gpt-5.6-sol';
// Reasoning models legitimately take upward of a minute on a long
// recording's chunk list; the button shows a busy state meanwhile.
export const RETAKE_LLM_TIMEOUT_MS = 180_000;
export const RETAKE_LLM_MAX_CHUNKS = 500;
export const RETAKE_LLM_MAX_CHUNK_CHARS = 2_000;

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = [
  'You clean up screen-recording voiceovers. The speaker records in one',
  'continuous session; when they flub a line they pause and re-record it,',
  'sometimes several times and often rephrasing. The LAST attempt at any',
  'piece of content is the one to keep.',
  '',
  'You get the transcript as numbered chunks in recording order, each with',
  'the pause that follows it. Identify chunks that are abandoned attempts:',
  'false starts, flubbed lines cut off mid-word, or earlier versions of',
  'content that a later chunk delivers again, even reworded.',
  '',
  'Flag a chunk only when the ENTIRE chunk is superseded. If a chunk',
  'contains both an abandoned attempt and its good retry, or any content',
  'that no later chunk re-delivers, do not flag it. Rewording does not',
  'make content unique: if a later chunk conveys the same information',
  'with different words, the earlier chunk is superseded.',
  '',
  'Also flag brief reactions to mistakes that are clearly not part of the',
  'delivered script: frustration outbursts, swearing, sighs put into words,',
  'or self-directed comments like "what the frick" or "let me try that',
  'again".',
  '',
  'Do NOT flag: the final attempt of any piece of content, deliberate',
  'repetition or emphasis, lists of similar items, or unique content that',
  'is never re-recorded. When unsure, do not flag.',
  '',
  'Reply with JSON only, in the form {"removed": [chunk indices]}.'
].join('\n');

/** Raised when no OpenAI API key is configured — callers fall back. */
export class RetakeLlmUnavailableError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not configured');
    this.name = 'RetakeLlmUnavailableError';
  }
}

function sanitizeChunks(rawChunks: unknown): RetakeChunkInput[] {
  if (!Array.isArray(rawChunks)) return [];
  const chunks: RetakeChunkInput[] = [];
  for (const raw of rawChunks.slice(0, RETAKE_LLM_MAX_CHUNKS)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as { index?: unknown; text?: unknown; gapAfterSec?: unknown };
    if (!Number.isInteger(candidate.index) || (candidate.index as number) < 0) continue;
    if (typeof candidate.text !== 'string' || !candidate.text.trim()) continue;
    const gap = Number(candidate.gapAfterSec);
    chunks.push({
      index: candidate.index as number,
      text: candidate.text.trim().slice(0, RETAKE_LLM_MAX_CHUNK_CHARS),
      gapAfterSec: Number.isFinite(gap) && gap > 0 ? Number(gap.toFixed(1)) : 0
    });
  }
  return chunks;
}

function buildUserPrompt(chunks: RetakeChunkInput[]): string {
  return chunks
    .map((chunk) => `${chunk.index} | pause_after=${chunk.gapAfterSec}s | ${chunk.text}`)
    .join('\n');
}

function parseRemovedIndices(content: unknown, offeredIndices: Set<number>): number[] {
  if (typeof content !== 'string') {
    throw new Error('LLM retake response had no message content');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM retake response was not valid JSON');
  }
  const removed = (parsed as { removed?: unknown })?.removed;
  if (!Array.isArray(removed)) {
    throw new Error('LLM retake response was missing the "removed" array');
  }
  return [...new Set(removed)]
    .filter((index): index is number => Number.isInteger(index) && offeredIndices.has(index))
    .sort((left, right) => left - right);
}

export async function detectRetakesWithLlm(
  { chunks }: { chunks: RetakeChunkInput[] },
  deps: RetakeLlmDeps = {}
): Promise<DetectRetakesLlmResult> {
  const sanitized = sanitizeChunks(chunks);
  if (sanitized.length < 2) {
    throw new Error('retake detection requires at least two transcript chunks');
  }

  const apiKey = (deps.apiKey ?? process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) throw new RetakeLlmUnavailableError();

  const model =
    (deps.model ?? process.env.OPENAI_RETAKE_MODEL ?? '').trim() || RETAKE_LLM_DEFAULT_MODEL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? RETAKE_LLM_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(sanitized) }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`OpenAI retake request failed with status ${response.status}: ${detail}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const offeredIndices = new Set(sanitized.map((chunk) => chunk.index));
    return {
      removedIndices: parseRemovedIndices(payload?.choices?.[0]?.message?.content, offeredIndices),
      model
    };
  } finally {
    clearTimeout(timeout);
  }
}
