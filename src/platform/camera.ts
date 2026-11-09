export type CameraStage = 'access' | 'playback' | 'decode';
export interface CameraFailure {
  stage: CameraStage;
  reason: 'blocked' | 'missing' | 'start' | 'playback' | 'decode' | 'other';
  name: string;
  message: string;
}

/** Desktop selection belongs to the browser; rear-camera hints apply to phones. */
export function cameraConstraints(deviceId = ''): MediaStreamConstraints {
  if (deviceId)
    return { video: { deviceId: { exact: deviceId } }, audio: false };
  const mobile =
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
      .userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return {
    video: mobile ? { facingMode: { ideal: 'environment' } } : true,
    audio: false
  };
}

/** Read native/cross-realm DOMExceptions without relying on instanceof Error. */
export function describeCameraFailure(
  error: unknown,
  stage: CameraStage
): CameraFailure {
  const value =
    error && typeof error === 'object'
      ? (error as { name?: unknown; message?: unknown })
      : {};
  const name =
    typeof value.name === 'string' &&
    /^[A-Za-z][A-Za-z0-9]*Error$/.test(value.name)
      ? value.name
      : 'Error';
  const message =
    typeof value.message === 'string'
      ? value.message
          .replace(/\p{Cc}/gu, ' ')
          .slice(0, 500)
          .trim()
      : '';
  const reason =
    stage === 'decode'
      ? 'decode'
      : stage === 'playback'
        ? 'playback'
        : ['NotAllowedError', 'SecurityError'].includes(name)
          ? 'blocked'
          : name === 'NotFoundError'
            ? 'missing'
            : ['NotReadableError', 'AbortError'].includes(name)
              ? 'start'
              : 'other';
  return { stage, reason, name, message };
}
