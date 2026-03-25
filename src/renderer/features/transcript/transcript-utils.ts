/**
 * Transcript cleanup and token helpers for the renderer.
 */

export interface TranscriptToken {
  text?: string;
  type?: string;
  start?: number;
  end?: number;
}

/**
 * Normalizes transcript text by collapsing whitespace and trimming.
 */
export function normalizeTranscriptText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Strips non-speech annotations (brackets, parens) from transcript text.
 */
export function stripNonSpeechAnnotations(text: string): string {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*$/g, ' ')
    .replace(/\([^)]*$/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts spoken word tokens from Scribe token array, excluding annotations.
 */
export function extractSpokenWordTokens(
  tokens: TranscriptToken[],
): TranscriptToken[] {
  const spoken: TranscriptToken[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;

  for (const token of Array.isArray(tokens) ? tokens : []) {
    const rawText = typeof token?.text === 'string' ? token.text : '';
    const text = rawText.trim();
    if (!text) continue;

    const isInsideAnnotation =
      parenDepth > 0 || bracketDepth > 0 || /[()[\]]/.test(rawText);

    if (token.type === 'word' && !isInsideAnnotation) {
      spoken.push(token);
    }

    const openParens = (rawText.match(/\(/g) || []).length;
    const closeParens = (rawText.match(/\)/g) || []).length;
    const openBrackets = (rawText.match(/\[/g) || []).length;
    const closeBrackets = (rawText.match(/\]/g) || []).length;

    parenDepth = Math.max(0, parenDepth + openParens - closeParens);
    bracketDepth = Math.max(0, bracketDepth + openBrackets - closeBrackets);
  }

  return spoken;
}
