import { describe, expect, test } from 'vitest';

import {
  detectBadTakes,
  groupAttemptUnits,
  RESTART_MAX_HOP_GAP_SEC
} from '../../src/renderer/features/transcript/restart-detection';

/** Spreads a sentence into per-word segments, contiguous from `start`. */
function wordSegments(text: string, start: number, wordDuration = 0.3) {
  return text.split(/\s+/).map((word, index) => ({
    start: start + index * wordDuration,
    end: start + (index + 1) * wordDuration,
    text: word
  }));
}

describe('groupAttemptUnits', () => {
  test('splits units at gaps larger than the utterance gap', () => {
    const units = groupAttemptUnits([
      { start: 0, end: 1, text: 'hello there' },
      { start: 2.5, end: 3.5, text: 'next thought' }
    ]);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ start: 0, end: 1, text: 'hello there' });
    expect(units[1]).toMatchObject({ start: 2.5, end: 3.5, text: 'next thought' });
  });

  test('splits units after a segment ending with a cutoff marker, even without a gap', () => {
    const units = groupAttemptUnits([
      ...wordSegments('You can use ElevenLabs from, from--', 0),
      ...wordSegments('You can use ElevenLabs from the command line.', 2.1)
    ]);
    expect(units).toHaveLength(2);
    expect(units[0].text).toBe('You can use ElevenLabs from, from--');
    expect(units[1].text).toBe('You can use ElevenLabs from the command line.');
  });

  test('handles invalid input', () => {
    expect(groupAttemptUnits(null)).toEqual([]);
    expect(groupAttemptUnits([{ start: Number.NaN, end: 1, text: 'x' }])).toEqual([]);
  });
});

describe('detectBadTakes — restart clusters', () => {
  test('detects rephrased, stuttered, and slow restarts (real transcript scenario)', () => {
    // The user's actual failed case: three abandoned attempts, each ending in
    // a cutoff marker, rephrased rather than exact prefixes, with pauses
    // longer than the conservative 1.5s retry gap.
    const segments = [
      {
        start: 11,
        end: 15,
        text: 'You can now use the ElevenLabs CLI directly from your command line. For example...'
      },
      { start: 16.8, end: 18.5, text: 'You can now use your s--' },
      { start: 20.4, end: 22.4, text: 'You can now use ElevenLabs directly from, from--' },
      {
        start: 23.5,
        end: 40,
        text: 'You can now use ElevenLabs directly from the command line. Every single API that we support is in the CLI. For example, this is our text-to-speech.'
      }
    ];

    const removed = detectBadTakes(segments);
    expect(removed.map((r) => [r.start, r.end])).toEqual([
      [11, 15],
      [16.8, 18.5],
      [20.4, 22.4]
    ]);
    expect(removed[1].text).toBe('You can now use your s--');
  });

  test('detects a restart inside one contiguous utterance at word precision', () => {
    const flubWords = wordSegments('You can use ElevenLabs from, from--', 10);
    const retryWords = wordSegments(
      'You can use ElevenLabs from the command line every day.',
      10 + flubWords.length * 0.3
    );

    const removed = detectBadTakes([...flubWords, ...retryWords]);
    expect(removed).toHaveLength(1);
    expect(removed[0].start).toBe(flubWords[0].start);
    expect(removed[0].end).toBe(flubWords[flubWords.length - 1].end);
    expect(removed[0].text).toBe('You can use ElevenLabs from, from--');
  });

  test('removes only the flubbed tail when a good section ending flows into a botched next section', () => {
    // The user's chained pattern: the final good take of section N runs
    // without a pause straight into a flubbed start of section N+1, forming
    // one continuous unit that is part-good, part-bad.
    const unitWords = wordSegments(
      'And it works perfectly every time. Now let’s look at the s--',
      10
    );
    const retryWords = wordSegments(
      'Now let’s look at the settings page and configure the voice.',
      10 + unitWords.length * 0.3 + 1
    );

    const removed = detectBadTakes([...unitWords, ...retryWords]);
    expect(removed).toHaveLength(1);
    // Removal starts exactly at the word "Now" (index 6), keeping the good
    // section ending before it.
    expect(removed[0].start).toBeCloseTo(unitWords[6].start, 5);
    expect(removed[0].end).toBe(unitWords[unitWords.length - 1].end);
    expect(removed[0].text).toBe('Now let’s look at the s--');
  });

  test('handles chained partial units where the retry itself ends in a new flub', () => {
    // U1: good ending of section A + flubbed start of section B.
    // U2: good take of section B + flubbed start of section C.
    // U3: good take of section C.
    const u1 = wordSegments('And that works perfectly. In the settings you--', 0);
    const u2 = wordSegments(
      'In the settings you can change every option. Now for the final--',
      u1[u1.length - 1].end + 1
    );
    const u3 = wordSegments(
      'Now for the final part we export the whole video.',
      u2[u2.length - 1].end + 1
    );

    const removed = detectBadTakes([...u1, ...u2, ...u3]);
    expect(removed).toHaveLength(2);
    // U1's tail "In the settings you--" starts at word index 4.
    expect(removed[0].start).toBeCloseTo(u1[4].start, 5);
    expect(removed[0].end).toBe(u1[u1.length - 1].end);
    expect(removed[0].text).toBe('In the settings you--');
    // U2's tail "Now for the final--" starts at word index 8.
    expect(removed[1].start).toBeCloseTo(u2[8].start, 5);
    expect(removed[1].end).toBe(u2[u2.length - 1].end);
    expect(removed[1].text).toBe('Now for the final--');
  });

  test('removes a multi-unit attempt where only the last unit carries the cutoff marker', () => {
    // Diagnosed real-world miss: the attempt is split by a mid-thought pause
    // into a completed first sentence and a cut-off second sentence; the
    // retry restarts from the FIRST sentence's opening, reworded.
    const attempt1 = wordSegments(
      "today we're launching the ElevenLabs CLI, which brings the ElevenLabs API directly into your terminal.",
      86
    );
    const attempt2 = wordSegments(
      'Every endpoint we publish on our OpenAPI spec automatically becomes a sub...',
      attempt1[attempt1.length - 1].end + 0.6
    );
    const retry = wordSegments(
      "Today we're launching the ElevenLabs CLI, which brings our ElevenLabs API directly in your terminal. So every endpoint we publish on the OpenAPI spec becomes a subcommand inside this terminal.",
      attempt2[attempt2.length - 1].end + 3.1
    );

    const removed = detectBadTakes([...attempt1, ...attempt2, ...retry]);
    expect(removed).toHaveLength(1);
    expect(removed[0].start).toBe(attempt1[0].start);
    expect(removed[0].end).toBe(attempt2[attempt2.length - 1].end);
    expect(removed[0].text).toContain("today we're launching");
    expect(removed[0].text).toContain('becomes a sub...');
  });

  test('backward extension does not cross an earlier flub marker', () => {
    // Two independent chained flubs: each should resolve on its own, not as
    // one giant span swallowing the first flub twice.
    const flubA = wordSegments('In the settings you can change every--', 0);
    const flubB = wordSegments(
      'In the settings you can--',
      flubA[flubA.length - 1].end + 1
    );
    const retry = wordSegments(
      'In the settings you can change every option and voice.',
      flubB[flubB.length - 1].end + 1
    );

    const removed = detectBadTakes([...flubA, ...flubB, ...retry]);
    expect(removed).toHaveLength(2);
    expect(removed[0].start).toBe(flubA[0].start);
    expect(removed[0].end).toBe(flubA[flubA.length - 1].end);
    expect(removed[1].start).toBe(flubB[0].start);
    expect(removed[1].end).toBe(flubB[flubB.length - 1].end);
  });

  test('keeps deliberate repeats without cutoff markers', () => {
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'This part is really important.' },
      { start: 3, end: 5, text: 'This part is really important.' }
    ]);
    expect(removed).toEqual([]);
  });

  test('keeps a cutoff followed by a different thought', () => {
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'So the first thing we need--' },
      { start: 3, end: 6, text: 'Anyway, let me just show you the dashboard instead.' }
    ]);
    expect(removed).toEqual([]);
  });

  test('keeps short trailing-off list items that the next item barely extends', () => {
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'You can use it for podcasts...' },
      { start: 3, end: 5, text: 'You can use it for audiobooks.' }
    ]);
    expect(removed).toEqual([]);
  });

  test('keeps a cutoff when the retry is too far away', () => {
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'You can now use the ElevenLabs CLI to--' },
      {
        start: 2 + RESTART_MAX_HOP_GAP_SEC + 1,
        end: 12,
        text: 'You can now use the ElevenLabs CLI to generate speech from anywhere.'
      }
    ]);
    expect(removed).toEqual([]);
  });

  test('keeps a cutoff whose opening is shorter than the minimum shared opening', () => {
    const removed = detectBadTakes([
      { start: 0, end: 1, text: 'And then I--' },
      { start: 2, end: 5, text: 'And then I went ahead and generated the audio file.' }
    ]);
    // Only 3 shared tokens — left for the conservative prefix detector,
    // which requires more distinctive evidence.
    expect(removed).toEqual([]);
  });

  test('still detects conservative exact-prefix retakes without cutoff markers', () => {
    // The pre-existing conservative path: clearly incomplete distinctive
    // prefix, immediately re-recorded (gap between 0.5s and 1.5s).
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'the quick brown fox jumped over and' },
      { start: 3, end: 7, text: 'the quick brown fox jumped over and landed on the lazy dog' }
    ]);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ start: 0, end: 2 });
  });

  test('merges overlapping findings from both detectors into one range', () => {
    // Ends with a cutoff marker AND is an exact prefix — both detectors fire
    // on the same span; the result reports it once.
    const removed = detectBadTakes([
      { start: 0, end: 2, text: 'the quick brown fox jumped over and--' },
      { start: 3, end: 7, text: 'the quick brown fox jumped over and landed on the lazy dog' }
    ]);
    expect(removed).toHaveLength(1);
  });

  test('returns empty for invalid or empty input', () => {
    expect(detectBadTakes(null)).toEqual([]);
    expect(detectBadTakes([])).toEqual([]);
  });
});
