import assert from "node:assert/strict";
import test from "node:test";
import { derangeIds } from "./derangement";

function assertDerangement(source: string[], perm: string[]) {
  assert.equal(perm.length, source.length);
  assert.deepEqual([...perm].sort(), [...source].sort());
  perm.forEach((id, index) => {
    assert.notEqual(id, source[index]);
  });
}

test("two people always swap", () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.deepEqual(derangeIds(["a", "b"]), ["b", "a"]);
  }
});

test("larger groups never keep a fixed point", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assertDerangement(ids, derangeIds(ids));
  }
});

test("a single person cannot be assigned", () => {
  assert.throws(() => derangeIds(["only"]), /NEED_TWO/);
});
