import { expect, test } from 'vitest';
import { cameraWindowBounds } from '../../src/platform/windowPlacement';

const screen = { left: 0, top: 25, width: 1920, height: 1055 };

test('camera window aligns inside the right edge of its source and uses a taller height', () => {
  expect(
    cameraWindowBounds({ left: 100, top: 80, width: 1000 }, screen)
  ).toEqual({ left: 730, top: 165, width: 370, height: 800 });
});

test('when there is no room beside the browser, it aligns inside the browser right edge', () => {
  expect(
    cameraWindowBounds({ left: 500, top: 900, width: 1300 }, screen)
  ).toEqual({ left: 1430, top: 280, width: 370, height: 800 });
});

test('negative monitor coordinates and a short work area remain valid', () => {
  expect(
    cameraWindowBounds(
      { left: -1600, top: -100, width: 1200 },
      { left: -1920, top: -200, width: 1920, height: 700 }
    )
  ).toEqual({ left: -770, top: -200, width: 370, height: 700 });
});

test('off-screen source bounds clamp to the available screen', () => {
  expect(
    cameraWindowBounds({ left: 3000, top: -500, width: 1000 }, screen)
  ).toEqual({ left: 1550, top: 25, width: 370, height: 800 });
});

test('a work area narrower than the preferred window constrains its width', () => {
  expect(
    cameraWindowBounds(undefined, {
      left: -300,
      top: 0,
      width: 300,
      height: 500
    })
  ).toEqual({ left: -300, top: 0, width: 300, height: 500 });
});

test('vertical offset stays visible when the browser is near the screen bottom', () => {
  expect(
    cameraWindowBounds({ left: 500, top: 900, width: 1300 }, screen, 500, 85)
  ).toEqual({ left: 1300, top: 280, width: 500, height: 800 });
});
