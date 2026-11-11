import assert from "node:assert/strict";
import test from "node:test";
import { BOARD_STORAGE_KEY, createBoard, type StorageLike } from "./board";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

function freshBoard() {
  return createBoard(memoryStorage());
}

test("assignment never gives anyone their own code", () => {
  const store = freshBoard();
  const people = [
    ["민수", "CODE-MINSU"],
    ["지연", "CODE-JIYEON"],
    ["하늘", "CODE-HANEUL"],
    ["서윤", "CODE-SEOYUN"],
  ] as const;

  const created = people.map(([name, giftCode]) => store.addParticipant(name, giftCode));
  const board = store.assignAll();
  assert.equal(board.assigned, true);
  assert.equal(
    board.participants.every((person) => person.revealed === false),
    true,
  );

  const pool = store.otherCodes(created[0].id);
  assert.equal(pool.length, people.length - 1);
  assert.equal(pool.includes("CODE-MINSU"), false);

  const reveals = created.map((person) => ({
    receiver: person.name,
    ...store.revealGift(person.id),
  }));

  const codes = new Set(reveals.map((item) => item.giftCode));
  assert.equal(codes.size, people.length);
  for (const item of reveals) {
    const own = people.find(([name]) => name === item.receiver);
    assert.ok(own);
    assert.notEqual(item.giftCode, own[1]);
    assert.notEqual(item.giverName, item.receiver);
    const partner = reveals.find((other) => other.receiver === item.giverName);
    assert.ok(partner);
    assert.notEqual(partner.giverName, item.receiver);
  }

  const again = store.revealGift(created[0].id);
  assert.equal(again.giftCode, reveals[0].giftCode);
  assert.equal(again.giverName, reveals[0].giverName);

  const hidden = store.getRoster();
  assert.equal(
    hidden.participants.every((person) => person.giftCode == null),
    true,
  );
  assert.equal(JSON.stringify(hidden).includes("CODE-"), false);
  const publicBoard = store.getBoard();
  assert.equal(
    publicBoard.participants.every((person) => person.revealed),
    true,
  );
  assert.equal(JSON.stringify(publicBoard).includes("CODE-"), false);
});

test("roster edits lock after assignment and unlock again", () => {
  const store = freshBoard();
  store.addParticipant("민수", "CODE-MINSU");
  assert.throws(() => store.assignAll(), /세 명 이상/);
  store.addParticipant("지연", "CODE-JIYEON");
  assert.throws(() => store.assignAll(), /세 명 이상/);
  store.addParticipant("하늘", "CODE-HANEUL");
  store.assignAll();
  assert.throws(() => store.addParticipant("서윤", "CODE-SEOYUN"), /명단을 바꿀 수 없어요/);
  store.unlockRoster();
  const added = store.addParticipant("서윤", "CODE-SEOYUN");
  assert.equal(added.name, "서윤");
});

test("duplicate names and blank fields are rejected", () => {
  const store = freshBoard();
  store.addParticipant("민수", "CODE-MINSU");
  assert.throws(() => store.addParticipant(" 민수 ", "OTHER"), /같은 이름/);
  assert.throws(() => store.addParticipant("   ", "CODE"), /이름을 입력/);
  assert.throws(() => store.addParticipant("지연", "  "), /선물 코드/);
});

test("the same storage keeps the roster for the next visit", () => {
  const storage = memoryStorage();
  createBoard(storage).addParticipant("민수", "CODE-MINSU");
  const roster = createBoard(storage).getRoster();
  assert.equal(roster.participants.length, 1);
  assert.equal(roster.participants[0].giftCode, "CODE-MINSU");
  assert.equal(storage.getItem(BOARD_STORAGE_KEY)?.includes("CODE-MINSU"), true);
});
