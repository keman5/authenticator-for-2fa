// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { configurePopupSize } from '../../src/platform/popupSize';

afterEach(() => {
  document.documentElement.className = '';
  vi.unstubAllGlobals();
});

test('toolbar sizing requests intrinsic dimensions before adapting to the host resize', () => {
  vi.stubGlobal('chrome', { extension: { getViews: () => [window] } });
  configurePopupSize();
  expect(document.documentElement.classList.contains('toolbar-popup')).toBe(
    true
  );
  expect(
    document.documentElement.classList.contains('toolbar-popup-sized')
  ).toBe(false);
  window.dispatchEvent(new Event('resize'));
  expect(
    document.documentElement.classList.contains('toolbar-popup-sized')
  ).toBe(true);
});

test('ordinary extension pages keep their responsive sizing', () => {
  vi.stubGlobal('chrome', { extension: { getViews: () => [] } });
  configurePopupSize();
  window.dispatchEvent(new Event('resize'));
  expect(document.documentElement.className).toBe('');
});
