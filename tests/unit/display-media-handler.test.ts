import type { DesktopCapturer, Session } from 'electron';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  getPendingDisplayMediaSource,
  registerDisplayMediaHandler,
  setPendingDisplayMediaSource
} from '../../src/main/app/display-media-handler';

type Handler = (
  request: unknown,
  callback: (selection: { video?: unknown; audio?: unknown }) => void
) => void | Promise<void>;

function createSession() {
  let registered: Handler | null = null;
  const session = {
    setDisplayMediaRequestHandler(handler: Handler) {
      registered = handler;
    }
  } as unknown as Pick<Session, 'setDisplayMediaRequestHandler'>;
  return {
    session,
    getHandler: () => registered
  };
}

function stubDesktopCapturer(
  sources: Array<{ id: string; name: string }>
): Pick<DesktopCapturer, 'getSources'> {
  const stub = { getSources: vi.fn(async () => sources) };
  return stub as unknown as Pick<DesktopCapturer, 'getSources'>;
}

describe('display-media-handler', () => {
  afterEach(() => {
    setPendingDisplayMediaSource(null);
  });

  test('resolves the pending source with audio loopback', async () => {
    const { session, getHandler } = createSession();
    const desktopCapturer = stubDesktopCapturer([
      { id: 'screen:0', name: 'Display 1' },
      { id: 'window:1', name: 'Foo' }
    ]);

    registerDisplayMediaHandler({ session, desktopCapturer });
    setPendingDisplayMediaSource('window:1');

    const handler = getHandler();
    expect(handler).toBeDefined();
    const callback = vi.fn();
    await handler!({}, callback);

    expect(callback).toHaveBeenCalledWith({
      video: { id: 'window:1', name: 'Foo' },
      audio: 'loopback'
    });
    // Pending state is single-use so a stray later call does not accidentally
    // resolve with the previous source.
    expect(getPendingDisplayMediaSource()).toBeNull();
  });

  test('denies the request when no pending source is set', async () => {
    const { session, getHandler } = createSession();
    const desktopCapturer = stubDesktopCapturer([]);

    registerDisplayMediaHandler({ session, desktopCapturer });

    const handler = getHandler();
    const callback = vi.fn();
    await handler!({}, callback);

    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith({});
  });

  test('denies the request when the pending source id no longer matches any source', async () => {
    const { session, getHandler } = createSession();
    const desktopCapturer = stubDesktopCapturer([{ id: 'screen:0', name: 'Display 1' }]);

    registerDisplayMediaHandler({ session, desktopCapturer });
    setPendingDisplayMediaSource('screen:missing');

    const handler = getHandler();
    const callback = vi.fn();
    await handler!({}, callback);

    expect(callback).toHaveBeenCalledWith({});
  });

  test('ignores empty/whitespace source ids', () => {
    setPendingDisplayMediaSource('   ');
    expect(getPendingDisplayMediaSource()).toBeNull();
  });
});
