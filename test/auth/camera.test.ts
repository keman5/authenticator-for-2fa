import { afterEach, expect, test, vi } from 'vitest';
import {
  cameraConstraints,
  describeCameraFailure
} from '../../src/platform/camera';

afterEach(() => vi.unstubAllGlobals());

test('desktop camera requests respect browser selection without a rear-camera preference', () => {
  vi.stubGlobal('navigator', {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0'
  });
  expect(cameraConstraints()).toEqual({ video: true, audio: false });
});

test('mobile scanning keeps only an ideal rear-camera preference', () => {
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)'
  });
  expect(cameraConstraints()).toEqual({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
});

test.each([
  ['NotAllowedError', 'blocked'],
  ['SecurityError', 'blocked'],
  ['NotFoundError', 'missing'],
  ['NotReadableError', 'start'],
  ['AbortError', 'start']
])(
  'acquisition %s preserves its browser reason and classifies recovery as %s',
  (name, reason) => {
    expect(
      describeCameraFailure(
        { name, message: 'Starting video failed' },
        'access'
      )
    ).toMatchObject({
      name,
      message: 'Starting video failed',
      stage: 'access',
      reason
    });
  }
);

test('playback errors are distinct from camera permission/acquisition failures', () => {
  expect(
    describeCameraFailure(
      new DOMException('The play() request was interrupted.', 'AbortError'),
      'playback'
    )
  ).toMatchObject({
    stage: 'playback',
    reason: 'playback',
    name: 'AbortError'
  });
});

test('browser diagnostic text is bounded and contains no control characters', () => {
  const failure = describeCameraFailure(
    { name: 'NotReadableError', message: '\u0000\n' + 'x'.repeat(2000) },
    'access'
  );
  expect(failure.message.length).toBeLessThanOrEqual(500);
  expect(
    failure.message.split('').some((character) => character.charCodeAt(0) < 32)
  ).toBe(false);
});

test('QR decode failures remain separate from device and playback failures', () => {
  expect(
    describeCameraFailure(
      new DOMException('Canvas readback failed', 'SecurityError'),
      'decode'
    )
  ).toMatchObject({
    stage: 'decode',
    reason: 'decode',
    name: 'SecurityError',
    message: 'Canvas readback failed'
  });
});

test('an explicitly selected iPhone or USB camera is requested by device ID on desktop and mobile', () => {
  expect(cameraConstraints('continuity-camera')).toEqual({
    video: { deviceId: { exact: 'continuity-camera' } },
    audio: false
  });
});
