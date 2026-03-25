import { afterEach, describe, expect, test } from 'vitest';

import { getRequiredEnv } from '../../src/main/services/scribe-service';

describe('main/services/scribe-service', () => {
  const OLD_ENV = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (OLD_ENV === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = OLD_ENV;
    }
  });

  test('getRequiredEnv returns configured values', () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    expect(getRequiredEnv('ELEVENLABS_API_KEY')).toBe('test-key');
  });

  test('getRequiredEnv throws when variable is missing', () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => getRequiredEnv('ELEVENLABS_API_KEY')).toThrow(
      /Missing required environment variable/
    );
  });
});
