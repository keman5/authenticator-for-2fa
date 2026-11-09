/** A drag may commit only against the list it started with. */
export function isReorderCurrent(
  visible: ReadonlyArray<{ id: string }>,
  captured: ReadonlyArray<string>
): boolean {
  if (captured.length !== visible.length) return false;
  for (let position = 0; position < captured.length; position++) {
    if (captured[position] !== visible[position].id) return false;
  }
  return true;
}

/** Shift the intervening range, leaving the source array untouched. */
export function moveItem<T>(
  source: readonly T[],
  origin: number,
  destination: number
): T[] {
  const valid = (index: number) =>
    Number.isInteger(index) && index >= 0 && index < source.length;
  if (!valid(origin) || !valid(destination)) return source.slice();
  return Array.from(source, (entry, position) => {
    if (position === destination) return source[origin];
    if (origin < destination && position >= origin && position < destination)
      return source[position + 1];
    if (origin > destination && position <= origin && position > destination)
      return source[position - 1];
    return entry;
  });
}
