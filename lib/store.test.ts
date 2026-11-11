import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATABASE_URL = "";
process.env.GIFT_STORE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gift-")),
  "store.json",
);

type Store = typeof import("./store");

async function loadStore(): Promise<Store> {
  return import("./store");
}

async function reset(store: Store) {
  await store.unlockRoster();
  const roster = await store.getRoster();
  for (const person of roster.participants) {
    await store.removeParticipant(person.id);
  }
}

test("assignment never gives anyone their own code", async () => {
  const store = await loadStore();
  await reset(store);
  const people = [
    ["민수", "CODE-MINSU"],
    ["지연", "CODE-JIYEON"],
    ["하늘", "CODE-HANEUL"],
    ["서윤", "CODE-SEOYUN"],
  ] as const;

  const created = [];
  for (const [name, giftCode] of people) {
    created.push(await store.addParticipant(name, giftCode));
  }

  const board = await store.assignAll();
  assert.equal(board.assigned, true);
  assert.equal(
    board.participants.every((person) => person.revealed === false),
    true,
  );

  const reveals = [];
  for (const person of created) {
    reveals.push({
      receiver: person.name,
      ...(await store.revealGift(person.id)),
    });
  }

  const codes = new Set(reveals.map((item) => item.giftCode));
  assert.equal(codes.size, people.length);
  for (const item of reveals) {
    const own = people.find(([name]) => name === item.receiver);
    assert.ok(own);
    assert.notEqual(item.giftCode, own[1]);
    assert.notEqual(item.giverName, item.receiver);
  }

  const again = await store.revealGift(created[0].id);
  assert.equal(again.giftCode, reveals[0].giftCode);
  assert.equal(again.giverName, reveals[0].giverName);

  const hidden = await store.getRoster();
  assert.equal(
    hidden.participants.every((person) => person.giftCode == null),
    true,
  );
  assert.equal(JSON.stringify(hidden).includes("CODE-"), false);
  const publicBoard = await store.getBoard();
  assert.equal(
    publicBoard.participants.every((person) => person.revealed),
    true,
  );
  assert.equal(JSON.stringify(publicBoard).includes("CODE-"), false);
});

test("roster edits lock after assignment and unlock again", async () => {
  const store = await loadStore();
  await reset(store);
  await store.addParticipant("민수", "CODE-MINSU");
  await assert.rejects(() => store.assignAll(), /두 명 이상/);
  await store.addParticipant("지연", "CODE-JIYEON");
  await store.assignAll();
  await assert.rejects(
    () => store.addParticipant("하늘", "CODE-HANEUL"),
    /명단을 바꿀 수 없어요/,
  );
  await store.unlockRoster();
  const added = await store.addParticipant("하늘", "CODE-HANEUL");
  assert.equal(added.name, "하늘");
});

test("duplicate names and blank fields are rejected", async () => {
  const store = await loadStore();
  await reset(store);
  await store.addParticipant("민수", "CODE-MINSU");
  await assert.rejects(() => store.addParticipant(" 민수 ", "OTHER"), /같은 이름/);
  await assert.rejects(() => store.addParticipant("   ", "CODE"), /이름을 입력/);
  await assert.rejects(() => store.addParticipant("지연", "  "), /선물 코드/);
});
