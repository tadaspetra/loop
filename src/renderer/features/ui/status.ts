/**
 * Shared presentation rules for inline status text, banners, and stateful
 * export buttons. The renderer previously carried four near-identical copies
 * of these tone/class maps; every status surface should resolve its classes
 * through this module so tones stay visually consistent.
 */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'error';

const STATUS_TONE_TEXT_CLASSES: Record<StatusTone, string> = {
  neutral: 'text-neutral-500',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400'
};

export function statusToneTextClass(tone: unknown): string {
  return STATUS_TONE_TEXT_CLASSES[tone as StatusTone] || STATUS_TONE_TEXT_CLASSES.neutral;
}

export function hasStatusText(text: unknown): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}

/** Banner (project home message) tones: informational or error. */
export function bannerToneClasses(tone: unknown): string {
  return tone === 'info'
    ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
    : 'border-red-500/40 bg-red-500/10 text-red-200';
}

export type ExportButtonState = 'idle' | 'busy' | 'done' | 'error';

/**
 * Class string for the Render / Export to Premiere buttons across their
 * idle → busy → done/error lifecycle. `idleClass` carries the button's
 * resting look (e.g. `btn-primary`); `minWidthClass` keeps the width stable
 * while the label changes ("Render" → "Rendering..." → "Done!").
 */
export function exportButtonClass(
  state: unknown,
  { idleClass, minWidthClass = '' }: { idleClass: string; minWidthClass?: string }
): string {
  const base = ['btn', 'px-4', 'py-1.5', 'font-medium', 'text-center', minWidthClass]
    .filter(Boolean)
    .join(' ');
  if (state === 'busy') return `${base} bg-neutral-700 text-neutral-300 cursor-wait`;
  if (state === 'done') return `${base} bg-emerald-600 text-white`;
  if (state === 'error') return `${base} bg-red-600 text-white`;
  return `${base} ${idleClass}`;
}

export type PreviewStreamKind = 'screen' | 'camera' | 'microphone';

const PREVIEW_STREAM_LABELS: Record<PreviewStreamKind, string> = {
  screen: 'Screen preview',
  camera: 'Camera',
  microphone: 'Microphone'
};

export function previewStreamErrorMessage(kind: PreviewStreamKind): string {
  const label = PREVIEW_STREAM_LABELS[kind] || 'Device';
  return `${label} failed to start — check permissions or pick another device.`;
}

/**
 * One combined notice for stream failures during media initialization, so
 * three sequential failures do not overwrite each other on the single
 * recording notice line. Returns null when nothing failed.
 */
export function mediaInitFailureNotice(kinds: PreviewStreamKind[]): string | null {
  const labels = [...new Set(kinds)].map((kind) => PREVIEW_STREAM_LABELS[kind]).filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return previewStreamErrorMessage(kinds[0]);
  const rest = labels.slice(0, -1).join(', ');
  const last = labels[labels.length - 1];
  return `${rest} and ${last} failed to start — check permissions or pick different devices.`;
}

export const DEVICE_ENUMERATION_ERROR_MESSAGE =
  'Could not detect recording devices — reopen this view to retry.';

export const PROJECT_SAVE_ERROR_MESSAGE =
  'Saving the project failed — recent changes may not be on disk.';

export const CONTENT_PROTECTION_ERROR_MESSAGE =
  'Could not update "Invisible from recording" — this window may appear in captures.';
