import { describe, expect, test } from 'vitest';

import {
  getScribeFailureReason,
  getScribeStatusFromCloseEvent,
  getScribeStatusFromMessage
} from '../../src/renderer/features/transcript/scribe-status';

describe('scribe-status', () => {
  test('reports when the transcription session connects', () => {
    expect(getScribeStatusFromMessage({ message_type: 'session_started' })).toEqual({
      text: 'Transcription connected',
      tone: 'success'
    });
  });

  test('preserves exact server error types', () => {
    expect(getScribeStatusFromMessage({ message_type: 'insufficient_audio_activity' })).toEqual({
      text: 'Transcription error: insufficient_audio_activity',
      tone: 'error',
      failureReason: 'insufficient_audio_activity'
    });
  });

  test('combines explicit error details with the server error type', () => {
    expect(getScribeFailureReason({
      message_type: 'session_time_limit_exceeded',
      error: 'Maximum session time has been reached'
    })).toBe('session_time_limit_exceeded: Maximum session time has been reached');
  });

  test('uses generic error payloads as the failure reason', () => {
    expect(getScribeStatusFromMessage({
      message_type: 'error',
      error: 'quota_exceeded'
    })).toEqual({
      text: 'Transcription error: quota_exceeded',
      tone: 'error',
      failureReason: 'quota_exceeded'
    });
  });

  test('prefers the last known server failure when the socket closes', () => {
    expect(
      getScribeStatusFromCloseEvent({ code: 1006 }, 'insufficient_audio_activity')
    ).toEqual({
      text: 'Transcription disconnected: insufficient_audio_activity',
      tone: 'warning',
      failureReason: 'insufficient_audio_activity'
    });
  });

  test('falls back to the websocket close reason and code', () => {
    expect(getScribeStatusFromCloseEvent({ code: 4000, reason: 'network_changed' })).toEqual({
      text: 'Transcription disconnected: network_changed',
      tone: 'warning',
      failureReason: 'network_changed'
    });

    expect(getScribeStatusFromCloseEvent({ code: 1006 })).toEqual({
      text: 'Transcription disconnected (code 1006)',
      tone: 'warning',
      failureReason: 'code 1006'
    });
  });
});
