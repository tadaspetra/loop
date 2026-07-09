import { describe, expect, test } from 'vitest';

import {
  bannerToneClasses,
  exportButtonClass,
  hasStatusText,
  mediaInitFailureNotice,
  previewStreamErrorMessage,
  statusToneTextClass
} from '../../src/renderer/features/ui/status';

describe('statusToneTextClass', () => {
  test('maps each known tone to its text color class', () => {
    expect(statusToneTextClass('neutral')).toBe('text-neutral-500');
    expect(statusToneTextClass('success')).toBe('text-emerald-400');
    expect(statusToneTextClass('warning')).toBe('text-amber-400');
    expect(statusToneTextClass('error')).toBe('text-red-400');
  });

  test('falls back to neutral for unknown or missing tones', () => {
    expect(statusToneTextClass('loud')).toBe('text-neutral-500');
    expect(statusToneTextClass(undefined)).toBe('text-neutral-500');
    expect(statusToneTextClass(null)).toBe('text-neutral-500');
  });
});

describe('hasStatusText', () => {
  test('true only for non-blank strings', () => {
    expect(hasStatusText('Saved')).toBe(true);
    expect(hasStatusText('  x ')).toBe(true);
    expect(hasStatusText('')).toBe(false);
    expect(hasStatusText('   ')).toBe(false);
    expect(hasStatusText(undefined)).toBe(false);
    expect(hasStatusText(null)).toBe(false);
    expect(hasStatusText(42)).toBe(false);
  });
});

describe('bannerToneClasses', () => {
  test('info tone gets blue banner classes', () => {
    expect(bannerToneClasses('info')).toBe('border-blue-500/40 bg-blue-500/10 text-blue-200');
  });

  test('everything else (including error and unknown) gets red banner classes', () => {
    const red = 'border-red-500/40 bg-red-500/10 text-red-200';
    expect(bannerToneClasses('error')).toBe(red);
    expect(bannerToneClasses('warning')).toBe(red);
    expect(bannerToneClasses(undefined)).toBe(red);
  });
});

describe('exportButtonClass', () => {
  const opts = { idleClass: 'btn-primary', minWidthClass: 'min-w-[80px]' };

  test('idle state uses the provided idle class', () => {
    const cls = exportButtonClass('idle', opts);
    expect(cls).toContain('btn');
    expect(cls).toContain('btn-primary');
    expect(cls).toContain('min-w-[80px]');
    expect(cls).not.toContain('cursor-wait');
  });

  test('busy state swaps to muted background with wait cursor', () => {
    const cls = exportButtonClass('busy', opts);
    expect(cls).toContain('bg-neutral-700');
    expect(cls).toContain('cursor-wait');
    expect(cls).not.toContain('btn-primary');
  });

  test('done and error states use success/error backgrounds', () => {
    expect(exportButtonClass('done', opts)).toContain('bg-emerald-600');
    expect(exportButtonClass('error', opts)).toContain('bg-red-600');
  });

  test('unknown state falls back to idle styling', () => {
    expect(exportButtonClass('mystery', opts)).toBe(exportButtonClass('idle', opts));
  });

  test('min width class is optional', () => {
    const cls = exportButtonClass('idle', { idleClass: 'btn-secondary' });
    expect(cls).toContain('btn-secondary');
    expect(cls).not.toContain('min-w-');
  });
});

describe('previewStreamErrorMessage', () => {
  test('names the failing device with actionable guidance', () => {
    expect(previewStreamErrorMessage('screen')).toContain('Screen preview');
    expect(previewStreamErrorMessage('camera')).toContain('Camera');
    expect(previewStreamErrorMessage('microphone')).toContain('Microphone');
    expect(previewStreamErrorMessage('camera')).toMatch(/permission/i);
  });
});

describe('mediaInitFailureNotice', () => {
  test('returns null when nothing failed', () => {
    expect(mediaInitFailureNotice([])).toBeNull();
  });

  test('single failure reads like a single-device message', () => {
    const notice = mediaInitFailureNotice(['camera']);
    expect(notice).toContain('Camera');
    expect(notice).not.toContain('and');
  });

  test('multiple failures are joined into one sentence', () => {
    const notice = mediaInitFailureNotice(['camera', 'microphone']);
    expect(notice).toContain('Camera');
    expect(notice).toContain('Microphone');
    expect(notice).toContain('and');
  });

  test('duplicate kinds are collapsed', () => {
    expect(mediaInitFailureNotice(['camera', 'camera'])).toBe(mediaInitFailureNotice(['camera']));
  });
});
