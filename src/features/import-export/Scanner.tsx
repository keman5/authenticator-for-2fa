import { localizeQrError } from './importFeedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Monitor, Upload } from 'lucide-react';
import { useCopy, useVault } from '../../app/vault';
import { ErrorMessage, FilePicker, Select } from '../../shared/ui/controls';
import { decodeQrFiles } from '../../domain/qr';
import { decodeQrImageData } from '../../domain/image';
import { getErrorMessage } from '../../domain/feedback';
import {
  cameraConstraints,
  describeCameraFailure,
  type CameraFailure,
  type CameraStage
} from '../../platform/camera';
import {
  closeScreenScanWindow,
  focusCurrentAppWindow,
  getPageWindowId,
  isCameraWindow,
  readAppRoute,
  needsCameraWindow,
  openAppWindow
} from '../../platform/windows';

export function Scanner({
  onImported,
  onPageScan
}: {
  onImported: (accountIds: string[], onComplete?: () => void) => void;
  onPageScan: () => Promise<void>;
}) {
  const vault = useVault(),
    { ui, tr, feedback } = useCopy();
  const [mode, setMode] = useState<'shot' | 'upload' | 'cam'>(() =>
      isCameraWindow(location.href)
        ? 'cam'
        : readAppRoute(location.href) === 'add-qr'
          ? 'upload'
          : 'shot'
    ),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [cameraFailure, setCameraFailure] = useState<CameraFailure | null>(null),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false),
    [frameReady, setFrameReady] = useState(false),
    [cameras, setCameras] = useState<MediaDeviceInfo[]>([]),
    [selectedCamera, setSelectedCamera] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    screenVideo = useRef<HTMLVideoElement>(null),
    screenAbort = useRef<AbortController | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    generation = useRef(0),
    mounted = useRef(true),
    deviceRequest = useRef(0),
    pagePending = useRef(false),
    pageStarted = useRef(false);
  const refreshCameras = useCallback(async () => {
    const request = ++deviceRequest.current;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!mounted.current || request !== deviceRequest.current) return;
    const available = devices.filter(
      (device) => device.kind === 'videoinput' && device.deviceId
    );
    setCameras(available);
    setSelectedCamera((selected) =>
      available.some((device) => device.deviceId === selected) ? selected : ''
    );
  }, []);
  function stop() {
    generation.current += 1;
    screenAbort.current?.abort();
    screenAbort.current = null;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (screenVideo.current) screenVideo.current.srcObject = null;
    if (mounted.current) {
      setActive(false);
      setFrameReady(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  useEffect(() => {
    stop();
    setError('');
    setStatus('');
    vault.notice = '';
    setCameraFailure(null);
  }, [mode]);
  useEffect(() => {
    if (!busy || mode !== 'shot' || !screenAbort.current) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, [busy, mode]);
  useEffect(() => {
    if (mode !== 'cam' || needsCameraWindow()) return;
    const refresh = () => {
      void refreshCameras().catch(() => {});
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      deviceRequest.current += 1;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, [mode, refreshCameras]);
  function failCamera(error: unknown, stage: CameraStage, current: number) {
    if (!mounted.current || generation.current !== current) return;
    const failure = describeCameraFailure(error, stage);
    setCameraFailure(failure);
    const copy = {
      blocked: 'cameraAccessBlocked',
      missing: 'cameraNotFound',
      start: 'cameraStartFailed',
      playback: 'cameraPlaybackFailed',
      decode: 'cameraDecodeFailed',
      other: 'cameraAccessFailed'
    } as const;
    setError(
      tr(
        stage === 'playback' && failure.name === 'TimeoutError'
          ? 'cameraNoFrames'
          : copy[failure.reason]
      )
    );
    stop();
  }
  async function importDecoded(text: string, onComplete?: () => void) {
    const previousIds = new Set(vault.accounts.map((account) => account.id));
    const result = await vault.importText(text);
    if (!result.imported)
      throw new Error(
        result.errors[0] ??
          tr(result.skipped ? 'importAllDuplicates' : 'importNoneFound')
      );
    stop();
    setStatus(tr('importAddedCount', { count: result.imported }));
    onImported(
      vault.accounts
        .filter((account) => !previousIds.has(account.id))
        .map((account) => account.id),
      onComplete
    );
  }
  async function files(files: File[]) {
    setBusy(true);
    setStatus('');
    vault.notice = '';
    setError('');
    setCameraFailure(null);
    try {
      await importDecoded((await decodeQrFiles(files)).join('\n'));
    } catch (error) {
      if (mounted.current)
        setError(
          localizeQrError(getErrorMessage(error, tr('importFailed')), tr)
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function decodeFrame(element: HTMLVideoElement) {
    const width = element.videoWidth,
      height = element.videoHeight;
    if (!width || !height) return '';
    const scale = Math.min(1, 1920 / width, 1080 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return decodeQrImageData(
      context.getImageData(0, 0, canvas.width, canvas.height)
    );
  }
  async function startCamera(deviceId = selectedCamera) {
    stop();
    setBusy(true);
    setStatus('');
    vault.notice = '';
    setError('');
    setCameraFailure(null);
    const current = ++generation.current;
    const handoff = needsCameraWindow();
    let stage: CameraStage = 'access';
    try {
      if (handoff) {
        await openAppWindow('add-qr', 'browser-window');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(ui('noCamera'));
      const acquired = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(deviceId)
      );
      if (!mounted.current || generation.current !== current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      // Labels and additional devices may only become visible after permission.
      void refreshCameras().catch(() => {});
      for (const track of acquired.getTracks()) {
        track.addEventListener?.(
          'ended',
          () =>
            failCamera(
              new DOMException('Camera stream ended.', 'NotReadableError'),
              'playback',
              current
            ),
          { once: true }
        );
      }
      const element = video.current!;
      stage = 'playback';
      element.srcObject = acquired;
      setActive(true);
      timer.current = setTimeout(
        () =>
          failCamera(
            new DOMException(
              'Camera did not start video playback.',
              'TimeoutError'
            ),
            'playback',
            current
          ),
        15000
      );
      await element.play();
      if (!mounted.current || generation.current !== current) return;
      clearTimeout(timer.current);
      let lastFrameAt = Date.now(),
        lastVideoTime = -1;
      const scan = async () => {
        if (generation.current !== current || !mounted.current) return;
        let importing = false;
        try {
          if (
            !element.videoWidth ||
            !element.videoHeight ||
            element.readyState < 2 ||
            element.currentTime === lastVideoTime
          ) {
            if (Date.now() - lastFrameAt >= 15000) {
              failCamera(
                new DOMException(
                  'Camera stopped delivering video frames.',
                  'TimeoutError'
                ),
                'playback',
                current
              );
              return;
            }
          } else {
            lastFrameAt = Date.now();
            lastVideoTime = element.currentTime;
            setFrameReady(true);
            const text = await decodeFrame(element);
            if (generation.current !== current) return;
            if (text) {
              importing = true;
              await importDecoded(text);
              return;
            }
          }
        } catch (error) {
          if (generation.current === current) {
            if (importing)
              setError(
                localizeQrError(getErrorMessage(error, tr('importFailed')), tr)
              );
            else {
              setCameraFailure(describeCameraFailure(error, 'decode'));
              setError(tr('cameraDecodeFailed'));
            }
            stop();
          }
          return;
        }
        if (generation.current === current)
          timer.current = setTimeout(() => void scan(), 350);
      };
      void scan();
    } catch (error) {
      if (mounted.current && generation.current === current) {
        if (handoff) setError(getErrorMessage(error, tr('cameraAccessFailed')));
        else failCamera(error, stage, current);
        if (handoff) stop();
      }
    } finally {
      if (mounted.current && generation.current === current) setBusy(false);
    }
  }
  async function screenshot() {
    stop();
    setBusy(true);
    setStatus('');
    vault.notice = '';
    setError('');
    setCameraFailure(null);
    const current = ++generation.current;
    const controller = new AbortController();
    screenAbort.current = controller;
    const { signal } = controller;
    try {
      if (needsCameraWindow()) {
        await openAppWindow('add-screen');
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error(ui('noDisplayMedia'));
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      if (!mounted.current || generation.current !== current) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = captured;
      captured.getTracks().forEach((track) =>
        track.addEventListener?.(
          'ended',
          () => {
            if (generation.current === current) stop();
          },
          { once: true }
        )
      );
      const element = screenVideo.current!;
      element.srcObject = captured;
      setActive(true);
      // Bound playback and decoding together; the native picker remains user-controlled.
      timer.current = setTimeout(() => {
        if (generation.current !== current) return;
        setError(tr('qrUnavailable'));
        stop();
        void focusCurrentAppWindow();
      }, 15000);
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          element.removeEventListener('loadeddata', ready);
          element.removeEventListener('error', failed);
          signal.removeEventListener('abort', cancelled);
        };
        const ready = () => {
          if (!element.videoWidth || !element.videoHeight) return;
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new Error(tr('qrUnavailable')));
        };
        const cancelled = () => {
          cleanup();
          reject(new DOMException('Screen scan cancelled.', 'AbortError'));
        };
        element.addEventListener('loadeddata', ready);
        element.addEventListener('error', failed);
        signal.addEventListener('abort', cancelled, { once: true });
        // Some browsers deliver a usable frame before play() settles.
        void element.play().catch(failed);
        if (element.readyState >= 2) ready();
      });
      if (!mounted.current || generation.current !== current) return;
      const text = await decodeFrame(element);
      if (generation.current !== current) return;
      if (!text) throw new Error(ui('shotNoQr'));
      await importDecoded(text, closeScreenScanWindow);
    } catch (error) {
      const name =
        error && typeof error === 'object' && 'name' in error ? error.name : '';
      if (
        mounted.current &&
        generation.current === current &&
        name !== 'NotAllowedError' &&
        name !== 'AbortError'
      ) {
        setError(
          localizeQrError(getErrorMessage(error, tr('importFailed')), tr)
        );
        stop();
        void focusCurrentAppWindow();
      }
    } finally {
      if (generation.current === current) stop();
    }
  }
  async function scanPage() {
    setBusy(true);
    setError('');
    setStatus('');
    vault.notice = '';
    setCameraFailure(null);
    pagePending.current = true;
    try {
      await onPageScan();
    } catch (error) {
      pagePending.current = false;
      setBusy(false);
      setError(
        localizeQrError(getErrorMessage(error, tr('scanPageFailed')), tr)
      );
    }
  }
  useEffect(() => {
    let windowId: number | undefined;
    void getPageWindowId().then((id) => {
      windowId = id;
    });
    const listener = (message: {
      type?: string;
      ok?: boolean;
      message?: string;
      cancelled?: boolean;
      windowId?: number;
    }) => {
      if (!message || typeof message !== 'object') return;
      if (
        message.type !== 'page-scan:completed' ||
        !pagePending.current ||
        (message.windowId !== undefined && message.windowId !== windowId)
      )
        return;
      pagePending.current = false;
      setBusy(false);
      if (message.cancelled) return;
      if (message.ok) setStatus(message.message ?? '');
      else setError(message.message ?? 'Page scan failed.');
    };
    if (typeof chrome === 'undefined') return;
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);
  useEffect(() => {
    if (readAppRoute(location.href) === 'add-page' && !pageStarted.current) {
      pageStarted.current = true;
      void scanPage();
    }
  }, []);
  return (
    <>
      <div className="scan-ways">
        {(
          [
            { value: 'shot', key: 'wayShot', Icon: Monitor },
            { value: 'upload', key: 'wayUpload', Icon: Upload },
            { value: 'cam', key: 'wayCam', Icon: Camera }
          ] as const
        ).map(({ value, key, Icon }) => (
          <button
            className={`scan-way ${mode === value ? 'active' : ''}`}
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            <Icon size={19} />
            <span>{ui(key)}</span>
          </button>
        ))}
      </div>
      {mode === 'cam' && (
        <>
          <div className="field">
            <label>{tr('cameraDevice')}</label>
            <Select
              label={tr('cameraDevice')}
              value={selectedCamera}
              disabled={busy || needsCameraWindow()}
              options={[
                { value: '', label: tr('cameraDefault') },
                ...cameras.map((device, index) => ({
                  value: device.deviceId,
                  label:
                    device.label ||
                    tr('cameraDeviceNumber', { number: index + 1 })
                }))
              ]}
              onChange={(deviceId) => {
                setSelectedCamera(deviceId);
                if (active) void startCamera(deviceId);
              }}
            />
          </div>
          <p className="desc" style={{ marginBottom: 10 }}>
            {tr('cameraContinuityHint')}
          </p>
          <div className="cam-frame">
            <div className="cam-preview">
              <video
                ref={video}
                playsInline
                muted
                style={{ visibility: frameReady ? 'visible' : 'hidden' }}
              />
              {!frameReady && (
                <div className="cam-placeholder">
                  {active ? tr('cameraWaiting') : ui('camPh1')}
                  <br />
                  {ui('camPh2')}
                </div>
              )}
              <div className="scan-corners">
                <i />
                <i />
                <i />
                <i />
              </div>
              {frameReady && <div className="scan-line" />}
            </div>
            <div className="btn-row cam-actions">
              <button
                className="btn-primary"
                type="button"
                disabled={busy && !active}
                onClick={() => (active ? stop() : void startCamera())}
              >
                {ui(active ? 'camStop' : 'camStart')}
              </button>
              {!needsCameraWindow() && (
                <button
                  className="btn-soft"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void refreshCameras().catch((error) =>
                      failCamera(error, 'access', generation.current)
                    );
                  }}
                >
                  {tr('cameraRefresh')}
                </button>
              )}
              {needsCameraWindow() && (
                <span className="muted">{tr('cameraOpensInWindow')}</span>
              )}
            </div>
          </div>
        </>
      )}
      {mode === 'shot' && (
        <div className="screen-scan-panel">
          <Monitor size={36} aria-hidden="true" />
          <p className="desc">{ui('shotDesc')}</p>
          <div className="btn-row">
            <button
              className="btn-primary"
              type="button"
              disabled={busy && !screenAbort.current}
              onClick={() => (screenAbort.current ? stop() : void screenshot())}
            >
              {!screenAbort.current && <Monitor size={16} aria-hidden="true" />}
              {screenAbort.current ? tr('cancel') : ui('shotBtn')}
            </button>
            <button
              className="btn-soft"
              type="button"
              disabled={busy}
              onClick={() => void scanPage()}
            >
              {tr('scanPage')}
            </button>
          </div>
          <video
            ref={screenVideo}
            className="screen-preview"
            muted
            playsInline
            hidden={!active}
          />
        </div>
      )}
      {mode === 'upload' && (
        <>
          <div
            className="drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void files(Array.from(event.dataTransfer.files));
            }}
          >
            <p>{ui('dropMain')}</p>
            <p className="muted">{ui('dropSub')}</p>
            <FilePicker
              route="add-qr"
              accept="image/*"
              onFiles={(selection) => void files(selection)}
              onError={setError}
              disabled={busy}
            >
              {ui('wayUpload')}
            </FilePicker>
          </div>
        </>
      )}
      {busy && (
        <p className="scan-msg" role="status">
          {ui('recognizing')}
        </p>
      )}
      {status && (
        <p className="scan-msg ok" role="status">
          {feedback(status)}
        </p>
      )}
      {error && (
        <ErrorMessage>
          <p>{feedback(error)}</p>
          {cameraFailure && (
            <details>
              <summary>{tr('cameraErrorDetails')}</summary>
              <p>
                {
                  {
                    access: 'getUserMedia',
                    playback: 'video.play',
                    decode: 'QR decode'
                  }[cameraFailure.stage]
                }{' '}
                · {cameraFailure.name}
                {cameraFailure.message && `: ${cameraFailure.message}`}
              </p>
            </details>
          )}
        </ErrorMessage>
      )}
    </>
  );
}
