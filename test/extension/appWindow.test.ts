import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  closeScreenScanWindow,
  focusExistingAppWindow,
  focusCurrentAppWindow,
  getPageWindowId,
  needsFilePickerWindow,
  needsCameraWindow,
  openAppWindow,
  readAppRoute
} from '../../src/platform/windows';

const PAGE_URL = 'chrome-extension://abcdefghijklmnop/index.html';

interface FakeWindow {
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
  screen?: {
    availLeft: number;
    availTop: number;
    availWidth: number;
    availHeight: number;
  };
}

function installWindow(href = PAGE_URL): FakeWindow {
  const fakeWindow: FakeWindow = { location: { href }, close: vi.fn() };
  vi.stubGlobal('window', fakeWindow);
  return fakeWindow;
}

function installChrome(api: Record<string, unknown>): void {
  vi.stubGlobal('chrome', { runtime: { lastError: undefined }, ...api });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('readAppRoute ignores missing and unrecognized routes', () => {
  expect(readAppRoute(PAGE_URL)).toBeNull();
  expect(readAppRoute(`${PAGE_URL}?open=settings`)).toBeNull();
});

describe.each([
  ['Firefox', 'moz-extension:', true],
  ['Chromium', 'chrome-extension:', false],
  ['Safari', 'safari-web-extension:', false],
  ['Web preview', 'https:', false]
] as const)('%s dialog handoff', (_browser, protocol, expected) => {
  test('file dialogs hand off on Firefox and camera prompts hand off on every toolbar popup', () => {
    const popup = installWindow(`${protocol}//abcdefghijklmnop/index.html`);
    installChrome({ extension: { getViews: () => [popup] } });
    expect(needsFilePickerWindow()).toBe(expected);
    expect(needsCameraWindow()).toBe(true);
  });

  test('side panels, tabs and existing app windows keep their current surface', () => {
    installWindow(`${protocol}//abcdefghijklmnop/index.html`);
    installChrome({
      extension: { getViews: () => [{ location: { href: PAGE_URL } }] }
    });
    expect(needsFilePickerWindow()).toBe(false);
    expect(needsCameraWindow()).toBe(false);
  });
});

test('dialog handoff is disabled outside the extension environment', () => {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('chrome', undefined);
  expect(needsFilePickerWindow()).toBe(false);
  expect(needsCameraWindow()).toBe(false);
});

describe('openAppWindow', () => {
  test('camera handoff uses a normal browser window and preserves the source window active tab', async () => {
    const popup = installWindow();
    let currentWindowId = 7;
    const activeTabs = new Map([[7, 42]]);
    const create = vi.fn(
      (data: chrome.windows.CreateData, callback: () => void) => {
        currentWindowId = 99;
        activeTabs.set(99, 100);
        callback();
      }
    );
    const createTab = vi.fn();
    installChrome({
      tabs: { create: createTab },
      windows: {
        create,
        getCurrent: (callback: (data: { id: number }) => void) =>
          callback({ id: currentWindowId })
      }
    });
    await openAppWindow('add-qr', 'browser-window');
    const data = create.mock.calls[0]![0];
    expect(data.type).toBe('normal');
    const url = data.url as string;
    expect(readAppRoute(url)).toBe('add-qr');
    expect(new URL(url).searchParams.get('window')).toBe('7');
    expect(createTab).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledOnce();
    installWindow(url);
    const sourceWindowId = await getPageWindowId();
    expect(sourceWindowId).toBe(7);
    expect(activeTabs.get(sourceWindowId!)).toBe(42);
  });
  test('opens the route in a window that acts for the original browser window', async () => {
    const popup = installWindow();
    let currentWindowId = 7;
    const create = vi.fn(
      (_data: chrome.windows.CreateData, callback: () => void) => {
        expect(popup.close).not.toHaveBeenCalled();
        callback();
      }
    );
    installChrome({
      windows: {
        create,
        getCurrent: (callback: (current: { id: number }) => void) =>
          callback({ id: currentWindowId })
      }
    });

    await openAppWindow('add-qr');

    const [data] = create.mock.calls[0]!;
    expect(data.type).toBe('popup');
    expect(data.width).toBe(370);
    expect(data.height).toBeGreaterThanOrEqual(600);
    expect(popup.close).toHaveBeenCalledOnce();

    // Inside the new window, page context, page scans, and auto-paste must
    // still target the tab the user came from, not the extension window.
    installWindow(data.url as string);
    currentWindowId = 99;
    expect(readAppRoute(window.location.href)).toBe('add-qr');
    await expect(getPageWindowId()).resolves.toBe(7);
  });

  test('keeps the popup available when opening the camera tab fails', async () => {
    const popup = installWindow();
    const runtime: { lastError?: { message: string } } = {};
    installChrome({
      runtime,
      tabs: {
        create: (_data: unknown, callback: () => void) => {
          runtime.lastError = { message: 'Could not create tab.' };
          callback();
          runtime.lastError = undefined;
        }
      }
    });
    await expect(openAppWindow('add-qr', 'browser-window')).rejects.toThrow(
      'Could not create tab.'
    );
    expect(popup.close).not.toHaveBeenCalled();
  });

  test('falls back to a tab where windows cannot be created', async () => {
    const popup = installWindow();
    const create = vi.fn(
      (_data: chrome.tabs.CreateProperties, callback: () => void) => callback()
    );
    installChrome({ tabs: { create } });

    await openAppWindow('import');

    expect(readAppRoute(create.mock.calls[0]![0].url as string)).toBe('import');
    expect(popup.close).toHaveBeenCalledOnce();
  });

  test('keeps the popup open and reports why the window failed', async () => {
    const popup = installWindow();
    const runtime: { lastError?: { message?: string } } = {};
    const create = vi.fn(
      (_data: chrome.windows.CreateData, callback: () => void) => {
        runtime.lastError = { message: 'Window limit reached.' };
        callback();
        runtime.lastError = undefined;
      }
    );
    installChrome({ runtime, windows: { create } });

    await expect(openAppWindow('import')).rejects.toThrow(
      'Window limit reached.'
    );
    expect(popup.close).not.toHaveBeenCalled();
  });
});

test('camera handoff positions a taller normal window beside its source within the work area', async () => {
  const popup = installWindow();
  popup.screen = {
    availLeft: 0,
    availTop: 25,
    availWidth: 1920,
    availHeight: 1055
  };
  const create = vi.fn(
    (_data: chrome.windows.CreateData, callback: () => void) => callback()
  );
  const get = vi.fn((_id: number, callback: (data: unknown) => void) =>
    callback({ id: 7, left: 100, top: 80, width: 1000 })
  );
  installChrome({
    windows: {
      create,
      get,
      getCurrent: (callback: (data: { id: number }) => void) =>
        callback({ id: 7 })
    }
  });
  await openAppWindow('add-qr', 'browser-window');
  expect(get.mock.calls[0]![0]).toBe(7);
  expect(create.mock.calls[0]![0]).toMatchObject({
    left: 730,
    top: 165,
    width: 370,
    height: 800,
    type: 'normal'
  });
  expect(
    new URL(create.mock.calls[0]![0].url as string).searchParams.get('camera')
  ).toBe('1');
});

test('Firefox camera window aligns right with an 85px vertical offset and 370px width', async () => {
  const popup = installWindow('moz-extension://abcdefghijklmnop/index.html');
  popup.screen = {
    availLeft: 0,
    availTop: 25,
    availWidth: 1920,
    availHeight: 1055
  };
  const create = vi.fn(
    (_data: chrome.windows.CreateData, callback: () => void) => callback()
  );
  installChrome({
    windows: {
      create,
      get: (_id: number, callback: (data: unknown) => void) =>
        callback({ left: 500, top: 80, width: 1300 }),
      getCurrent: (callback: (data: { id: number }) => void) =>
        callback({ id: 7 })
    }
  });
  await openAppWindow('add-qr', 'browser-window');
  expect(create.mock.calls[0]![0]).toMatchObject({
    left: 1430,
    top: 165,
    width: 370,
    height: 800
  });
});

test.each([
  'import',
  'add-qr',
  'add-screen',
  'add-page',
  'passkey',
  'unlock-passkey'
] as const)(
  'file handoff for %s uses the browser right edge plus 85px',
  async (route) => {
    const popup = installWindow();
    popup.screen = {
      availLeft: 0,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1080
    };
    const create = vi.fn(
      (_data: chrome.windows.CreateData, callback: () => void) => callback()
    );
    installChrome({
      windows: {
        create,
        getCurrent: (callback: (data: unknown) => void) => callback({ id: 7 }),
        get: (_id: number, callback: (data: unknown) => void) =>
          callback({ left: 100, top: 80, width: 1000 })
      }
    });
    await openAppWindow(route);
    expect(
      new URL(create.mock.calls[0]![0].url as string).searchParams.get(
        'temporaryScan'
      )
    ).toBe(route === 'add-screen' ? '1' : null);
    const width = route === 'add-screen' ? 740 : 370;
    expect(create.mock.calls[0]![0]).toMatchObject({
      left: 1100 - width,
      top: 165,
      width,
      height: 755,
      type: 'popup'
    });
  }
);

test.each(['chrome-extension:', 'moz-extension:', 'safari-web-extension:'])(
  '%s toolbar click resumes the existing app without changing its URL',
  async (protocol) => {
    const popup = installWindow(`${protocol}//abcdefghijklmnop/index.html`);
    const updateTab = vi.fn((_id: number, _data: unknown, done: () => void) =>
      done()
    );
    const updateWindow = vi.fn(
      (_id: number, _data: unknown, done: () => void) => done()
    );
    installChrome({
      extension: { getViews: () => [popup] },
      tabs: { update: updateTab },
      windows: {
        getAll: (_options: unknown, done: (windows: unknown[]) => void) =>
          done([
            {
              id: 5,
              tabs: [{ id: 10, url: 'https://example.com/index.html' }]
            },
            {
              id: 6,
              tabs: [
                { id: 11, url: `${protocol}//another-extension/index.html` }
              ]
            },
            {
              id: 9,
              tabs: [
                { id: 12, url: `${protocol}//abcdefghijklmnop/other.html` }
              ]
            },
            {
              id: 7,
              tabs: [
                {
                  id: 42,
                  url: `${protocol}//abcdefghijklmnop/index.html?open=import&window=5`
                }
              ]
            }
          ]),
        update: updateWindow
      }
    });
    await expect(focusExistingAppWindow()).resolves.toBe(true);
    expect(updateTab).toHaveBeenCalledWith(
      42,
      { active: true },
      expect.any(Function)
    );
    expect(updateWindow).toHaveBeenCalledWith(
      7,
      { focused: true },
      expect.any(Function)
    );
    expect(popup.close).toHaveBeenCalledOnce();
  }
);

test.each(['none', 'closed', 'side panel'])(
  'existing window activation keeps the current surface usable: %s',
  async (state) => {
    const popup = installWindow();
    const runtime: { lastError?: { message: string } } = {};
    const getAll = vi.fn(
      (_options: unknown, done: (windows: unknown[]) => void) =>
        done(
          state === 'none' ? [] : [{ id: 7, tabs: [{ id: 42, url: PAGE_URL }] }]
        )
    );
    installChrome({
      runtime,
      extension: { getViews: () => (state === 'side panel' ? [] : [popup]) },
      windows: { getAll },
      tabs: {
        update: (_id: number, _data: unknown, done: () => void) => {
          runtime.lastError = { message: 'Tab no longer exists.' };
          done();
          runtime.lastError = undefined;
        }
      }
    });
    await expect(focusExistingAppWindow()).resolves.toBe(false);
    expect(popup.close).not.toHaveBeenCalled();
    if (state === 'side panel') expect(getAll).not.toHaveBeenCalled();
  }
);

test.each([
  ['', false],
  ['?open=add-screen', false],
  ['?open=import&temporaryScan=1', false],
  ['?open=add-screen&temporaryScan=1', true]
])(
  'successful scan closes only its explicitly temporary window: %s',
  (query, closes) => {
    const popup = installWindow(PAGE_URL + query);
    closeScreenScanWindow();
    expect(popup.close).toHaveBeenCalledTimes(closes ? 1 : 0);
  }
);

test.each(['success', 'lookup failed', 'activation failed'])(
  'screen failure restores its own window without reopening or closing: %s',
  async (state) => {
    const popup = installWindow(`${PAGE_URL}?open=add-screen&window=5`);
    const runtime: { lastError?: { message: string } } = {};
    const update = vi.fn((_id: number, _options: unknown, done: () => void) => {
      if (state === 'activation failed')
        runtime.lastError = { message: 'Window closed.' };
      done();
      runtime.lastError = undefined;
    });
    installChrome({
      runtime,
      windows: {
        getCurrent: (done: (window: unknown) => void) => {
          if (state === 'lookup failed')
            runtime.lastError = { message: 'Window closed.' };
          done({ id: 9 });
          runtime.lastError = undefined;
        },
        update
      }
    });
    await expect(focusCurrentAppWindow()).resolves.toBeUndefined();
    if (state === 'lookup failed') expect(update).not.toHaveBeenCalled();
    else
      expect(update).toHaveBeenCalledWith(
        9,
        { focused: true },
        expect.any(Function)
      );
    expect(popup.close).not.toHaveBeenCalled();
  }
);
