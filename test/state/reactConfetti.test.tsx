// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Confetti } from '../../src/shared/ui/Confetti';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frames() {
  let pending: FrameRequestCallback | undefined;
  let now = performance.now();
  vi.stubGlobal('innerWidth', 370);
  vi.stubGlobal('innerHeight', 720);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      pending = callback;
      return 1;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn(() => {
      pending = undefined;
    })
  );
  return async (seconds: number, hz = 60) => {
    await act(async () => {
      for (let index = 0; index < Math.round(seconds * hz); index++) {
        now += 1000 / hz;
        const next = pending;
        pending = undefined;
        next?.(now);
      }
    });
  };
}

const meanY = (container: HTMLElement) => {
  const pieces = [...container.querySelectorAll<HTMLElement>('.confetti i')];
  return (
    pieces.reduce(
      (sum, piece) =>
        sum + Number(piece.style.transform.split(',')[1].replace('px', '')),
      0
    ) / pieces.length
  );
};

test.each([60, 120])(
  'GiftDock confetti rises, falls and naturally completes at %s Hz',
  async (hz) => {
    const advance = frames();
    const complete = vi.fn();
    const { container, rerender, unmount } = render(
      <Confetti key={1} onComplete={complete} />
    );
    expect(container.querySelectorAll('.confetti i')).toHaveLength(140);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    await advance(0.3, hz);
    const first = meanY(container);
    await advance(0.45, hz);
    expect(meanY(container)).toBeLessThan(first);
    await advance(0.65, hz);
    const peak = meanY(container);
    await advance(1.4, hz);
    expect(meanY(container)).toBeGreaterThan(peak);
    await advance(1.4, hz);
    expect(container.querySelectorAll('.confetti i').length).toBeGreaterThan(0);
    await advance(15, hz);
    expect(container.childElementCount).toBe(0);
    expect(complete).toHaveBeenCalledOnce();
    rerender(<Confetti key={2} onComplete={complete} />);
    expect(container.querySelectorAll('.confetti i')).toHaveLength(140);
    const cancels = vi.mocked(cancelAnimationFrame).mock.calls.length;
    unmount();
    expect(vi.mocked(cancelAnimationFrame).mock.calls.length).toBeGreaterThan(
      cancels
    );
    await advance(20, hz);
    expect(complete).toHaveBeenCalledOnce();
  }
);

test('reduced motion skips the effect and completes the success flow', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  const complete = vi.fn();
  const { container } = render(<Confetti onComplete={complete} />);
  expect(window.matchMedia).toHaveBeenCalledWith(
    '(prefers-reduced-motion: reduce)'
  );
  expect(container.childElementCount).toBe(0);
  expect(complete).toHaveBeenCalledOnce();
});

test('changing reduced motion while playing stops particles and removes listeners', () => {
  frames();
  let changed: (() => void) | undefined;
  const media = {
    matches: false,
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      changed = listener;
    }),
    removeEventListener: vi.fn()
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media)
  );
  const complete = vi.fn();
  const { container } = render(<Confetti onComplete={complete} />);
  act(() => {
    media.matches = true;
    changed!();
  });
  expect(container.childElementCount).toBe(0);
  expect(complete).toHaveBeenCalledOnce();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', changed);
});
