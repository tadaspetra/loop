export type TranscriptStatusTone = 'neutral' | 'success' | 'warning' | 'error';

export interface TranscriptStatus {
  text: string;
  tone: TranscriptStatusTone;
  failureReason?: string;
}

interface ScribeMessageLike {
  message_type?: string;
  error?: string;
}

interface ScribeCloseLike {
  code?: number;
  reason?: string;
}

const SCRIBE_ERROR_TYPES = new Set([
  'auth_error',
  'quota_exceeded',
  'transcriber_error',
  'input_error',
  'error',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'chunk_size_exceeded',
  'insufficient_audio_activity'
]);

function normalizeReason(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getScribeFailureReason(
  message: ScribeMessageLike | null | undefined
): string | null {
  const messageType = normalizeReason(message?.message_type);
  const error = normalizeReason(message?.error);

  if (messageType === 'error') {
    return error || 'error';
  }

  if (SCRIBE_ERROR_TYPES.has(messageType)) {
    return error && error !== messageType ? `${messageType}: ${error}` : messageType;
  }

  if (!messageType && error) {
    return error;
  }

  return null;
}

export function getScribeStatusFromMessage(
  message: ScribeMessageLike | null | undefined
): TranscriptStatus | null {
  const messageType = normalizeReason(message?.message_type);

  if (messageType === 'session_started') {
    return {
      text: 'Transcription connected',
      tone: 'success'
    };
  }

  const failureReason = getScribeFailureReason(message);
  if (failureReason) {
    return {
      text: `Transcription error: ${failureReason}`,
      tone: 'error',
      failureReason
    };
  }

  return null;
}

export function getScribeStatusFromCloseEvent(
  event: ScribeCloseLike | null | undefined,
  lastFailureReason?: string | null
): TranscriptStatus {
  const previousReason = normalizeReason(lastFailureReason);
  if (previousReason) {
    return {
      text: `Transcription disconnected: ${previousReason}`,
      tone: 'warning',
      failureReason: previousReason
    };
  }

  const closeReason = normalizeReason(event?.reason);
  if (closeReason) {
    return {
      text: `Transcription disconnected: ${closeReason}`,
      tone: 'warning',
      failureReason: closeReason
    };
  }

  const closeCode = Number.isFinite(event?.code) ? Number(event?.code) : null;
  if (closeCode !== null) {
    return {
      text: `Transcription disconnected (code ${closeCode})`,
      tone: 'warning',
      failureReason: `code ${closeCode}`
    };
  }

  return {
    text: 'Transcription disconnected',
    tone: 'warning'
  };
}
