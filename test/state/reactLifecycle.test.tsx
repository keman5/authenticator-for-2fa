// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react';
import { AuthenticatorVault } from '../../src/platform/controller';
import { useAutoLock } from '../../src/app/useAutoLock';
import { VaultProvider } from '../../src/app/vault';
import * as appWindow from '../../src/platform/windows';
import * as qrDecoder from '../../src/domain/image';
import App from '../../src/app/App';
import { Scanner } from '../../src/features/import-export/Scanner';
import { MemoryStorage, installStructuredCloneChromeStorage } from '../helpers/storage';

declare const jsdom: { reconfigure(options: { url: string }): void };
const initialUrl = window.location.href;

afterEach(() => {
  jsdom.reconfigure({ url: initialUrl });
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function vaultWithProtection(minutes: number) {
  installStructuredCloneChromeStorage();
  localStorage.clear();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example'
  );
  await vault.changePassword('', 'password-protected');
  await vault.updateSettings({ autoLockMinutes: minutes });
  return vault;
}
function useObservedAutoLock(vault: AuthenticatorVault) {
  useSyncExternalStore(vault.subscribe, vault.getSnapshot);
  useAutoLock(vault);
}
test('a held pointer prevents locking, then the idle deadline clears accounts and codes', async () => {
  const vault = await vaultWithProtection(1);
  vi.useFakeTimers();
  renderHook(() => useObservedAutoLock(vault));
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  await advance(59000);
  fireEvent.pointerDown(document.body);
  await advance(61000);
  expect(vault.locked).toBe(false);

  fireEvent.pointerUp(document.body);
  await advance(59000);
  expect(vault.locked).toBe(false);
  fireEvent.keyDown(document.body, { key: 'Tab' });
  await advance(59000);
  expect(vault.locked).toBe(false);

  await advance(1000);
  expect(vault.locked).toBe(true);
  expect(vault.accounts).toEqual([]);
  expect(vault.codes).toEqual({});
});
test('never disables automatic locking, while immediate locks on pagehide', async () => {
  const vault = await vaultWithProtection(-1);
  vi.useFakeTimers();
  const hook = renderHook(() => useObservedAutoLock(vault));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000);
  });
  expect(vault.locked).toBe(false);
  hook.unmount();
  await vault.updateSettings({ autoLockMinutes: 0 });
  renderHook(() => useObservedAutoLock(vault));
  await act(async () => {
    fireEvent(window, new Event('pagehide'));
  });
  expect(vault.locked).toBe(true);
});
test('a camera permission result arriving after navigation releases every acquired track', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  let resolve!: (stream: MediaStream) => void;
  const pending = new Promise<MediaStream>((done) => {
    resolve = done;
  });
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => pending }
  });
  const view = render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  view.unmount();
  await act(async () => {
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await pending;
  });
  expect(stop).toHaveBeenCalledOnce();
});

test('closing every page does not reset the persisted inactivity deadline on reopen', async () => {
  const vault = await vaultWithProtection(1);
  vi.useFakeTimers();
  const hook = renderHook(() => useObservedAutoLock(vault));
  hook.unmount();
  await vi.advanceTimersByTimeAsync(120000);
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.locked).toBe(true);
  expect(reopened.accounts).toEqual([]);
});

test('never retains an unlocked session after all pages close and reopen', async () => {
  const vault = await vaultWithProtection(-1);
  vi.useFakeTimers();
  const hook = renderHook(() => useObservedAutoLock(vault));
  hook.unmount();
  await vi.advanceTimersByTimeAsync(3600000);
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.locked).toBe(false);
  expect(reopened.accounts).toHaveLength(1);
});

test('activity extends the shared deadline without reopening an expired session', async () => {
  const idle = await vaultWithProtection(1);
  vi.useFakeTimers();
  renderHook(() => useObservedAutoLock(idle));
  await act(() => vi.advanceTimersByTimeAsync(59000));
  const active = new AuthenticatorVault();
  await active.initialize();
  await active.recordActivity();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(idle.locked).toBe(false);

  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.locked).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(idle.locked).toBe(true);
  await active.recordActivity();
  await reopened.checkAutoLock();
  expect(reopened.locked).toBe(true);
});

test('a workspace without an authenticated timestamp stays locked after reopening', async () => {
  const vault=await vaultWithProtection(1);await vault.lock();
  const reopened=new AuthenticatorVault();await reopened.initialize();
  expect(reopened.locked).toBe(true);expect(reopened.accounts).toEqual([]);
});
test('an initially valid persisted deadline expires while mounted without initialization renewing it', async () => {
  await vaultWithProtection(1);vi.useFakeTimers();await vi.advanceTimersByTimeAsync(59000);
  const reopened=new AuthenticatorVault();await reopened.initialize();expect(reopened.locked).toBe(false);
  await vi.advanceTimersByTimeAsync(1001);await reopened.checkAutoLock();expect(reopened.locked).toBe(true);
});

test.each([-1, 1])(
  'a stale page checks the latest shared auto-lock policy %s before expiring its session',
  async (minutes) => {
    const idle = await vaultWithProtection(minutes === -1 ? 1 : -1);
    const active = new AuthenticatorVault();
    await active.initialize();
    await active.updateSettings({ autoLockMinutes: minutes });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(61000);
    await idle.checkAutoLock();
    expect(idle.locked).toBe(minutes === 1);
  }
);

test.each([true, false])(
  'camera startup hands off Firefox and Chromium toolbar popups (Firefox: %s)',
  async (firefox) => {
    jsdom.reconfigure({
      url: `${firefox ? 'moz' : 'chrome'}-extension://abcdefghijklmnop/index.html`
    });
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(
        new DOMException('Camera unavailable', 'NotFoundError')
      );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    });
    const create = vi.fn(
      (_data: chrome.windows.CreateData, callback: () => void) => callback()
    );
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    Object.assign(chrome, {
      extension: { getViews: () => [window] },
      windows: {
        create,
        getCurrent: (callback: (data: { id: number }) => void) =>
          callback({ id: 8 })
      }
    });
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={() => {}} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
    expect(
      Boolean(
        screen.queryByText('Camera access continues in a new browser window.')
      )
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(create.mock.calls[0]![0].type).toBe('normal');
    expect(
      new URL(create.mock.calls[0]![0].url as string).searchParams.get('open')
    ).toBe('add-qr');
    expect(close).toHaveBeenCalledOnce();
    close.mockRestore();
  }
);

test('camera rejection gives localized recovery guidance without claiming the user denied it', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.updateSettings({ language: 'zh', languageMode: 'manual' });
  const getUserMedia = vi
    .fn()
    .mockRejectedValue(
      new DOMException(
        'The request is not allowed by the user agent or the platform in the current context.',
        'NotAllowedError'
      )
    );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  });
  render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: '摄像头扫码' }));
  fireEvent.click(screen.getByRole('button', { name: '开启摄像头' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('摄像头权限');
  expect(error.textContent).toContain('上传');
  expect(error.querySelector('p')?.textContent).not.toContain('The request');
});

test('camera hardware startup failure retains the access stage and browser diagnostic', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const getUserMedia = vi
    .fn()
    .mockRejectedValue(new DOMException('Starting video failed', 'AbortError'));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  });
  render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('Close other camera apps');
  expect(error.textContent).toContain('getUserMedia');
  expect(error.textContent).toContain('AbortError');
  expect(error.textContent).toContain('Starting video failed');
  expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
});

test('video playback rejection reports playback rather than camera permissions and releases acquired tracks', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
    new DOMException('Playback was interrupted', 'AbortError')
  );
  render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('Camera connected');
  expect(error.textContent).toContain('video.play');
  expect(error.textContent).toContain('Playback was interrupted');
  expect(stop).toHaveBeenCalledOnce();
});

test('playback resolving after a scan-mode change cannot reactivate the stopped camera', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const stop = vi.fn();
  let resolvePlay!: () => void;
  const playback = new Promise<void>((resolve) => {
    resolvePlay = resolve;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    }
  });
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockReturnValue(playback);
  render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  await waitFor(() => expect(play).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
  await act(async () => {
    resolvePlay();
    await playback;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  expect(screen.queryByRole('button', { name: 'Turn off camera' })).toBeNull();
  expect(stop).toHaveBeenCalledOnce();
});

test('a frame read failure reports the QR decode stage and stops the camera', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
    640
  );
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
    480
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {},
    getImageData: () => {
      throw new DOMException('Canvas readback failed', 'SecurityError');
    }
  } as unknown as CanvasRenderingContext2D);
  render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('QR scanning failed');
  expect(error.textContent).toContain('QR decode');
  expect(error.textContent).toContain('Canvas readback failed');
  expect(stop).toHaveBeenCalledOnce();
});

test('a newly connected iPhone can be detected after NotFoundError and selected explicitly', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const devices = new EventTarget();
  const iphone = {
    kind: 'videoinput',
    deviceId: 'continuity',
    label: 'iPhone Camera'
  };
  const enumerateDevices = vi.fn().mockResolvedValue([]);
  const stop = vi.fn();
  const getUserMedia = vi
    .fn()
    .mockRejectedValueOnce(new DOMException('No device', 'NotFoundError'))
    .mockResolvedValue({ getTracks: () => [{ stop }] });
  Object.assign(devices, { getUserMedia, enumerateDevices });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: devices
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const view = render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'No camera is available'
  );
  enumerateDevices.mockResolvedValue([
    iphone,
    { kind: 'audioinput', deviceId: 'microphone' }
  ]);
  await act(async () => {
    devices.dispatchEvent(new Event('devicechange'));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
  fireEvent.click(await screen.findByRole('button', { name: 'iPhone Camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  await waitFor(() =>
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: 'continuity' } },
      audio: false
    })
  );
  const stopButton = await screen.findByRole('button', {
    name: 'Turn off camera'
  });
  expect(stopButton.closest('.cam-frame')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Turn on camera' })).toBeNull();
  expect(
    view.container.querySelector('.cam-placeholder')?.textContent
  ).toContain('Waiting for camera video…');
  expect(view.container.querySelector('.scan-line')).toBeNull();
  fireEvent.click(stopButton);
  expect(
    screen.getByRole('button', { name: 'Turn on camera' }).closest('.cam-frame')
  ).toBeTruthy();
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
  const calls = enumerateDevices.mock.calls.length;
  devices.dispatchEvent(new Event('devicechange'));
  expect(enumerateDevices).toHaveBeenCalledTimes(calls);
});

test.each(['no frames', 'pending playback', 'frozen video'])(
  'camera reports a bounded playback failure for %s',
  async (condition) => {
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
      }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(
      condition === 'pending playback'
        ? new Promise(() => {})
        : Promise.resolve()
    );
    if (condition === 'frozen video') {
      vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
        2
      );
      vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
        640
      );
      vi.spyOn(
        HTMLVideoElement.prototype,
        'videoHeight',
        'get'
      ).mockReturnValue(480);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: () => {},
        getImageData: () => ({})
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(qrDecoder, 'decodeQrImageData').mockResolvedValue('');
    }
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={() => {}} onPageScan={async () => {}} />
      </VaultProvider>
    );
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'No video received'
    );
    expect(screen.getByRole('alert').textContent).toContain('video.play');
    expect(stop).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole('button', {
          name: 'Turn on camera'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  }
);

test('switching cameras releases the old stream and a disconnected camera stops scanning', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const first = Object.assign(new EventTarget(), { stop: vi.fn() });
  const second = Object.assign(new EventTarget(), { stop: vi.fn() });
  const getUserMedia = vi
    .fn()
    .mockResolvedValueOnce({ getTracks: () => [first] })
    .mockResolvedValueOnce({ getTracks: () => [second] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          { kind: 'videoinput', deviceId: 'iphone', label: 'iPhone' }
        ])
    }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
    640
  );
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
    480
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {},
    getImageData: () => ({})
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(qrDecoder, 'decodeQrImageData').mockResolvedValue('');
  const view = render(
    <VaultProvider vault={vault}>
      <Scanner onImported={() => {}} onPageScan={async () => {}} />
    </VaultProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
  await waitFor(() =>
    expect(view.container.querySelector('.scan-line')).toBeTruthy()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
  fireEvent.click(await screen.findByRole('button', { name: 'iPhone' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.container.querySelector('.scan-line')).toBeTruthy()
  );
  expect(first.stop).toHaveBeenCalledOnce();
  await act(async () => {
    second.dispatchEvent(new Event('ended'));
  });
  expect(screen.getByRole('alert').textContent).toContain('video.play');
  expect(second.stop).toHaveBeenCalledOnce();
  expect(view.container.querySelector('.scan-line')).toBeNull();
});

test.each(['AbortError', 'NotAllowedError'])(
  'cancelling screen sharing (%s) is silent',
  async (name) => {
    const focus = vi
      .spyOn(appWindow, 'focusCurrentAppWindow')
      .mockResolvedValue();
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('User cancelled', name))
      }
    });
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={() => {}} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Capture screen & detect'
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  }
);

test.each([false, true])(
  'screen capture saves and leaves time for confetti before closing a temporary window (%s)',
  async (temporary) => {
    if (temporary)
      jsdom.reconfigure({
        url: 'https://extension.test/index.html?open=add-screen&temporaryScan=1'
      });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const stop = vi.fn(),
      imported = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop }] })
      }
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockReturnValue(new Promise(() => {}));
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      0
    );
    const width = vi
      .spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get')
      .mockReturnValue(0);
    const height = vi
      .spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get')
      .mockReturnValue(0);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({})
    } as unknown as CanvasRenderingContext2D);
    const decode = vi
      .spyOn(qrDecoder, 'decodeQrImageData')
      .mockResolvedValue(
        'otpauth://totp/Scanned:alice?secret=JBSWY3DPEHPK3PXP&issuer=Scanned'
      );
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={imported} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    );
    await waitFor(() => expect(play).toHaveBeenCalled());
    const video = play.mock.instances[0] as HTMLVideoElement;
    expect(decode).not.toHaveBeenCalled();
    width.mockReturnValue(640);
    height.mockReturnValue(480);
    await act(async () => {
      video!.dispatchEvent(new Event('loadeddata'));
    });
    await waitFor(() =>
      expect(imported).toHaveBeenCalledWith(
        [vault.accounts[0].id], expect.any(Function)
      )
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Authenticator accounts added: 1'
    );
    expect(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    ).toBeTruthy();
    expect(vault.accounts[0].issuer).toBe('Scanned');
    expect(close).not.toHaveBeenCalled();
    imported.mock.calls[0][1]();
    expect(close).toHaveBeenCalledTimes(temporary ? 1 : 0);
    const reopened = new AuthenticatorVault();
    await reopened.initialize();
    expect(reopened.accounts[0].issuer).toBe('Scanned');
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  }
);

test.each(['button', 'Escape', 'navigation'] as const)(
  'screen capture cancelled by %s releases late permission results',
  async (cancel) => {
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    let resolve!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((done) => {
      resolve = done;
    });
    const stop = vi.fn(),
      imported = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: () => pending }
    });
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={imported} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    if (cancel === 'button')
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    else if (cancel === 'Escape')
      fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await pending;
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(imported).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  }
);

test.each(['playback', 'decode'] as const)(
  'screen capture has bounded %s and discards late results',
  async (stage) => {
    jsdom.reconfigure({
      url: 'https://extension.test/index.html?open=add-screen&temporaryScan=1'
    });
    const focus = vi
      .spyOn(appWindow, 'focusCurrentAppWindow')
      .mockResolvedValue();
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const stop = vi.fn(),
      imported = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => ({ getTracks: () => [{ stop }] }) }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(
      new Promise(() => {})
    );
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      stage === 'decode' ? 2 : 0
    );
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
      640
    );
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
      480
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({})
    } as unknown as CanvasRenderingContext2D);
    let resolve!: (text: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const decode = vi
      .spyOn(qrDecoder, 'decodeQrImageData')
      .mockReturnValue(pending);
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={imported} onPageScan={async () => {}} />
      </VaultProvider>
    );
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'QR scanning is unavailable'
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledTimes(stage === 'decode' ? 1 : 0);
    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    await act(async () => {
      resolve('otpauth://totp/Late?secret=JBSWY3DPEHPK3PXP');
      await pending;
    });
    expect(imported).not.toHaveBeenCalled();
    expect(vault.accounts).toHaveLength(0);
  }
);

test.each(['failure', 'cancel', 'success'] as const)(
  'page scan keeps its interface and resolves progress on %s',
  async (outcome) => {
    installStructuredCloneChromeStorage();
    const listeners = new Set<(message: unknown) => void>();
    Object.assign(chrome.runtime, {
      onMessage: {
        addListener: (listener: (message: unknown) => void) =>
          listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) =>
          listeners.delete(listener)
      }
    });
    const vault = new AuthenticatorVault();
    await vault.initialize();
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={vi.fn()} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan page' }));
    expect(screen.getByRole('status').textContent).toContain('Recognizing');
    await act(async () => {
      for (const listener of listeners)
        listener({
          type: 'page-scan:completed',
          ok: outcome === 'success',
          cancelled: outcome === 'cancel',
          message:
            outcome === 'success'
              ? '1 account imported.'
              : 'No QR code was found near that click or in the selected area.'
        });
    });
    expect(
      screen.getByRole('button', { name: 'Scan page' }).hasAttribute('disabled')
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    ).toBeTruthy();
    if (outcome === 'failure')
      expect(screen.getByRole('alert').textContent).not.toBe('');
    else if (outcome === 'success')
      expect(screen.getByRole('status').textContent).toBe(
        'Authenticator accounts added: 1'
      );
    else {
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    }
  }
);

test.each(['no QR', 'decode failed', 'invalid account'])(
  'screen recognition failure restores the existing window: %s',
  async (outcome) => {
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const stop = vi.fn();
    const focus = vi
      .spyOn(appWindow, 'focusCurrentAppWindow')
      .mockImplementation(async () => {
        expect(stop).toHaveBeenCalledOnce();
      });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => ({ getTracks: () => [{ stop }] }) }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      2
    );
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
      640
    );
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
      480
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({})
    } as unknown as CanvasRenderingContext2D);
    const decode = vi.spyOn(qrDecoder, 'decodeQrImageData');
    if (outcome === 'decode failed')
      decode.mockRejectedValue(new Error('Decoder unavailable.'));
    else decode.mockResolvedValue(outcome === 'no QR' ? '' : 'not an account');
    render(
      <VaultProvider vault={vault}>
        <Scanner onImported={vi.fn()} onPageScan={async () => {}} />
      </VaultProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture screen & detect' })
    );
    expect((await screen.findByRole('alert')).textContent).not.toBe('');
    expect(focus).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(vault.accounts).toHaveLength(0);
    expect(
      (
        screen.getByRole('button', {
          name: 'Capture screen & detect'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  }
);

test.each([false, true])(
  'Firefox passkey entry hands off before authorization, window failure: %s',
  async (failure) => {
    jsdom.reconfigure({ url: 'moz-extension://abcdefghijklmnop/index.html' });
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    const vault = await vaultWithProtection(0);
    const register = vi.spyOn(vault, 'registerPasskey');
    const request = vi.fn();
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const runtime = chrome.runtime;
    const create = vi.fn(
      (_data: chrome.windows.CreateData, callback: () => void) => {
        expect(close).not.toHaveBeenCalled();
        if (failure)
          Object.defineProperty(runtime, 'lastError', {
            configurable: true,
            value: { message: 'Window limit reached.' }
          });
        callback();
        if (failure)
          Object.defineProperty(runtime, 'lastError', {
            configurable: true,
            value: undefined
          });
      }
    );
    Object.assign(chrome, {
      permissions: { request },
      extension: { getViews: () => [window] },
      windows: {
        create,
        getCurrent: (callback: (data: { id: number }) => void) =>
          callback({ id: 8 })
      }
    });
    render(<App vault={vault} />);
    await screen.findByRole('button', { name: 'Copy: Example alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Passkey & shortcuts/ })
    );
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const options = create.mock.calls[0]![0];
    expect(new URL(options.url as string).searchParams.get('open')).toBe(
      'passkey'
    );
    expect(options).toMatchObject({ type: 'popup', width: 370 });
    expect(request).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    if (failure) {
      expect(close).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(vault.error).toBe('Window limit reached.');
    } else await waitFor(() => expect(close).toHaveBeenCalledOnce());
  }
);

test('a passkey window keeps its route through password unlock and waits for a fresh Register click', async () => {
  jsdom.reconfigure({
    url: 'moz-extension://abcdefghijklmnop/index.html?open=passkey'
  });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  const vault = await vaultWithProtection(0);
  await vault.lock();
  const request = vi.fn().mockResolvedValue(false);
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  Object.assign(chrome, {
    permissions: { request },
    extension: { getViews: () => [] }
  });
  render(<App vault={vault} />);
  const password = await screen.findByLabelText('Password');
  fireEvent.change(password, { target: { value: 'password-protected' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  const register = await screen.findByRole('button', { name: 'Register' });
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(register);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ origins: ['https://macseek.cc/*'] })
  );
  fireEvent(window, new Event('blur'));
  expect(close).not.toHaveBeenCalled();
  expect(vault.locked).toBe(false);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
});
