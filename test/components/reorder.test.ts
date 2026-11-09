import { expect, test } from 'vitest';
import {
  isReorderCurrent,
  moveItem
} from '../../src/features/accounts/reorder';

test('drag snapshots compare identities and order, allowing unrelated account edits', () => {
  const captured = ['a', 'b', 'c'];
  const accounts = (ids: string[]) =>
    ids.map((id) => ({ id, label: 'edited' }));
  expect(isReorderCurrent(accounts(captured), captured)).toBe(true);
  for (const changed of [
    ['a', 'b'],
    ['a', 'b', 'c', 'd'],
    ['a', 'x', 'c'],
    ['c', 'b', 'a']
  ]) {
    expect(isReorderCurrent(accounts(changed), captured)).toBe(false);
  }
  expect(isReorderCurrent([], [])).toBe(true);
});

test('all valid moves preserve item identities, intervening order and the frozen source', () => {
  const source = Object.freeze(Array.from({ length: 8 }, (_, id) => ({ id })));
  for (let origin = 0; origin < source.length; origin++) {
    for (let destination = 0; destination < source.length; destination++) {
      const expected = source.slice();
      expected.splice(destination, 0, ...expected.splice(origin, 1));
      const result = moveItem(source, origin, destination);
      expect(result).toEqual(expected);
      expect(result[destination]).toBe(source[origin]);
      expect(new Set(result).size).toBe(source.length);
    }
  }
  expect(source.map((item) => item.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('invalid and no-op moves return a separate unchanged list', () => {
  const source = Object.freeze(['first', 'second']);
  for (const index of [-1, 2, 0.5, NaN, Infinity]) {
    for (const result of [
      moveItem(source, index, 1),
      moveItem(source, 0, index)
    ]) {
      expect(result).toEqual(source);
      expect(result).not.toBe(source);
    }
  }
  expect(moveItem(source, 0, 0)).toEqual(source);
  expect(moveItem([], 0, 0)).toEqual([]);
});
