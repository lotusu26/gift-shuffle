function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = current;
  }
  return next;
}

function cycleShift<T>(items: readonly T[]): T[] {
  if (items.length < 2) return [...items];
  return [...items.slice(1), items[0]];
}

function isDerangement<T>(source: readonly T[], perm: readonly T[]): boolean {
  return (
    perm.length === source.length &&
    perm.every((item, index) => item !== source[index])
  );
}

export function derangeIds(ids: readonly string[]): string[] {
  if (ids.length < 2) {
    throw new Error("NEED_TWO");
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const perm = shuffle(ids);
    if (isDerangement(ids, perm)) return perm;
  }

  const shifted = cycleShift(ids);
  if (isDerangement(ids, shifted)) return shifted;

  const reversed = [...ids].reverse();
  if (isDerangement(ids, reversed)) return reversed;

  return shifted;
}
