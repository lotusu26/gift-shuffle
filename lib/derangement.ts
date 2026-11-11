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

function isDerangement(source: readonly string[], perm: readonly string[]): boolean {
  return (
    perm.length === source.length &&
    perm.every((item, index) => item !== source[index])
  );
}

function hasPairSwap(source: readonly string[], perm: readonly string[]): boolean {
  const giverOf = new Map(
    source.map((receiver, index) => [receiver, perm[index]]),
  );
  for (const [receiver, giver] of giverOf) {
    if (giver !== receiver && giverOf.get(giver) === receiver) return true;
  }
  return false;
}

function cycleGivers(ids: readonly string[]): string[] {
  const ring = shuffle(ids);
  const giverOf = new Map<string, string>();
  ring.forEach((receiver, index) => {
    giverOf.set(receiver, ring[(index + 1) % ring.length]);
  });
  return ids.map((id) => {
    const giver = giverOf.get(id);
    if (!giver) throw new Error("NEED_THREE");
    return giver;
  });
}

export function derangeIds(ids: readonly string[]): string[] {
  if (ids.length < 3) {
    throw new Error("NEED_THREE");
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const perm = shuffle(ids);
    if (isDerangement(ids, perm) && !hasPairSwap(ids, perm)) return perm;
  }

  return cycleGivers(ids);
}
