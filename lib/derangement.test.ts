import assert from "node:assert/strict";
import test from "node:test";
import { derangeIds } from "./derangement";

function assertNoExchange(source: string[], perm: string[]) {
  assert.equal(perm.length, source.length);
  assert.deepEqual([...perm].sort(), [...source].sort());
  const giverOf = new Map(source.map((id, index) => [id, perm[index]]));
  for (const [receiver, giver] of giverOf) {
    assert.notEqual(giver, receiver);
    assert.notEqual(giverOf.get(giver), receiver);
  }
}

test("two people cannot be assigned without swapping", () => {
  assert.throws(() => derangeIds(["a", "b"]), /NEED_THREE/);
});

test("larger groups never swap a pair", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assertNoExchange(ids, derangeIds(ids));
  }
});

test("four people avoid the double swap", () => {
  const ids = ["a", "b", "c", "d"];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    assertNoExchange(ids, derangeIds(ids));
  }
});

test("a single person cannot be assigned", () => {
  assert.throws(() => derangeIds(["only"]), /NEED_THREE/);
});
