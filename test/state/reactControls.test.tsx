// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Confirm,
  FilePicker,
  Logo,
  Password,
  Select
} from '../../src/shared/ui/controls';
afterEach(cleanup);
test('Escape cancels destructive confirmation without accepting and does not take initial focus', () => {
  const cancel = vi.fn(),
    accept = vi.fn();
  render(<Confirm title="Delete vault" onCancel={cancel} onConfirm={accept} />);
  expect(screen.getByRole('heading', { name: 'Warning' })).toBeTruthy();
  expect(screen.getByText('Delete vault')).toBeTruthy();
  expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(cancel).toHaveBeenCalledOnce();
  expect(accept).not.toHaveBeenCalled();
});
test('password reveal preserves the controlled secret and labels its action', () => {
  const change = vi.fn();
  render(<Password label="Secret" value="sensitive" onChange={change} />);
  const input = screen.getByLabelText('Secret') as HTMLInputElement;
  expect(input.type).toBe('password');
  expect(document.activeElement).not.toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(input.type).toBe('text');
  expect(input.value).toBe('sensitive');
  fireEvent.change(input, { target: { value: 'edited' } });
  expect(change).toHaveBeenCalledWith('edited');
});
test('dropdown Escape closes without selecting an option', () => {
  const change = vi.fn();
  render(
    <Select
      label="Theme"
      value="light"
      options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' }
      ]}
      onChange={change}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
  expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

test('logo follows supplied code time and stays complete without time-based codes', () => {
  const { container, rerender } = render(<Logo />);
  const ring = () =>
    Array.from(container.querySelectorAll('circle[stroke-dasharray]')).map(
      (circle) => circle.getAttribute('stroke-dasharray')
    );
  expect(ring()).toEqual(Array(4).fill('31.17 135.09'));
  rerender(<Logo remaining={15} period={30} />);
  expect(ring()).toEqual([
    '31.17 135.09',
    '31.17 135.09',
    '0.00 135.09',
    '0.00 135.09'
  ]);
  rerender(<Logo />);
  expect(ring()).toEqual(Array(4).fill('31.17 135.09'));
});

test('auto-lock menu survives body scroll and resize while allowing selection', () => {
  const change = vi.fn();
  const { container } = render(
    <main className="p-body">
      <Select
        label="Auto lock"
        value="5"
        options={[
          { value: '5', label: '5 minutes' },
          { value: '30', label: '30 minutes' }
        ]}
        onChange={change}
      />
    </main>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Auto lock' }));
  fireEvent.scroll(container.querySelector('.p-body')!);
  fireEvent.resize(window);
  expect(
    screen
      .getByRole('button', { name: 'Auto lock' })
      .getAttribute('aria-expanded')
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '30 minutes' }));
  expect(change).toHaveBeenCalledWith('30');
});

test('file picker accepts clicks and drops once, and rejects drops while busy', () => {
  const imported = vi.fn(),
    outerDrop = vi.fn();
  const file = new File(['backup'], 'backup.json', {
    type: 'application/json'
  });
  const picker = (disabled = false) => (
    <div onDrop={outerDrop}>
      <FilePicker
        route="import"
        accept=".json,image/*"
        onFiles={imported}
        onError={vi.fn()}
        disabled={disabled}
      >
        Choose backup
      </FilePicker>
    </div>
  );
  const { container, rerender } = render(picker());
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  const browse = vi.spyOn(input, 'click');
  const button = screen.getByRole('button', { name: 'Choose backup' });
  fireEvent.click(button);
  expect(browse).toHaveBeenCalledOnce();
  fireEvent.drop(button, { dataTransfer: { files: [file] } });
  expect(imported).toHaveBeenCalledExactlyOnceWith([file]);
  expect(outerDrop).not.toHaveBeenCalled();
  fireEvent.drop(button, { dataTransfer: { files: [] } });
  expect(imported).toHaveBeenCalledOnce();
  rerender(picker(true));
  fireEvent.drop(button, { dataTransfer: { files: [file] } });
  expect(imported).toHaveBeenCalledOnce();
});

test.each([30, 60, 120])(
  'logo turns red with the code and resets for a %ss period',
  (period) => {
    const { container, rerender } = render(
      <Logo remaining={5} period={period} />
    );
    const arcs = () =>
      Array.from(container.querySelectorAll('circle[stroke-dasharray]'));
    expect(
      arcs().every((arc) => arc.getAttribute('stroke') === '#EA4335')
    ).toBe(true);
    rerender(<Logo remaining={period} period={period} />);
    expect(arcs().map((arc) => arc.getAttribute('stroke-dasharray'))).toEqual(
      Array(4).fill('31.17 135.09')
    );
    expect(arcs().map((arc) => arc.getAttribute('stroke'))).toEqual([
      '#EA4335',
      '#FBBC05',
      '#4285F4',
      '#34A853'
    ]);
  }
);
