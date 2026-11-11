import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { derangeIds } from "./derangement";

const MAX_NAME = 30;
const MAX_CODE = 120;
const MAX_PEOPLE = 200;

export class StoreError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

export type Participant = {
  id: string;
  name: string;
  giftCode: string;
  createdAt: string;
};

export type Assignment = {
  receiverId: string;
  giverId: string;
  revealedAt: string | null;
};

export type BoardParticipant = {
  id: string;
  name: string;
  revealed: boolean;
};

export type Board = {
  assigned: boolean;
  participants: BoardParticipant[];
};

export type RosterParticipant = {
  id: string;
  name: string;
  giftCode: string | null;
};

export type Roster = {
  assigned: boolean;
  participants: RosterParticipant[];
};

type State = {
  participants: Participant[];
  assignments: Assignment[];
};

function storeFilePath() {
  return (
    process.env.GIFT_STORE_PATH || path.join(process.cwd(), "data", "store.json")
  );
}

function postgresEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function cleanName(value: unknown) {
  if (typeof value !== "string") {
    throw new StoreError("이름을 입력해 주세요.", 400);
  }
  const name = value.trim();
  if (!name) throw new StoreError("이름을 입력해 주세요.", 400);
  if (name.length > MAX_NAME) {
    throw new StoreError("이름은 30자까지 입력할 수 있어요.", 400);
  }
  return name;
}

function cleanCode(value: unknown) {
  if (typeof value !== "string") {
    throw new StoreError("선물 코드를 입력해 주세요.", 400);
  }
  const giftCode = value.trim();
  if (!giftCode) throw new StoreError("선물 코드를 입력해 주세요.", 400);
  if (giftCode.length > MAX_CODE) {
    throw new StoreError("선물 코드는 120자까지 입력할 수 있어요.", 400);
  }
  return giftCode;
}

function byCreated(left: Participant, right: Participant) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function ordered(state: State) {
  return [...state.participants].sort(byCreated);
}

function toBoard(state: State): Board {
  const revealed = new Map(
    state.assignments.map((assignment) => [
      assignment.receiverId,
      assignment.revealedAt != null,
    ]),
  );
  return {
    assigned: state.assignments.length > 0,
    participants: ordered(state).map((person) => ({
      id: person.id,
      name: person.name,
      revealed: revealed.get(person.id) ?? false,
    })),
  };
}

function toRoster(state: State): Roster {
  const assigned = state.assignments.length > 0;
  return {
    assigned,
    participants: ordered(state).map((person) => ({
      id: person.id,
      name: person.name,
      giftCode: assigned ? null : person.giftCode,
    })),
  };
}

function assertUnlocked(state: State) {
  if (state.assignments.length > 0) {
    throw new StoreError("배정이 끝난 뒤에는 명단을 바꿀 수 없어요.", 409);
  }
}

function assertUniqueName(state: State, name: string, ignoreId?: string) {
  const taken = state.participants.some(
    (person) => person.name === name && person.id !== ignoreId,
  );
  if (taken) throw new StoreError("같은 이름이 이미 있어요.", 409);
}

function buildAssignments(participants: Participant[]): Assignment[] {
  if (participants.length < 3) {
    throw new StoreError("세 명 이상이어야 돌릴 수 있어요.", 400);
  }
  const people = [...participants].sort(byCreated);
  const givers = derangeIds(people.map((person) => person.id));
  return people.map((person, index) => ({
    receiverId: person.id,
    giverId: givers[index],
    revealedAt: null,
  }));
}

let queue: Promise<void> = Promise.resolve();

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readState(): Promise<State> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ storeFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    };
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    if (code === "ENOENT") return { participants: [], assignments: [] };
    throw new StoreError("저장된 명단을 읽지 못했어요.", 500);
  }
}

async function writeState(state: State) {
  const filePath = storeFilePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), {
    recursive: true,
  });
  const temporary = `${filePath}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8");
  await rename(/* turbopackIgnore: true */ temporary, filePath);
}

const fileStore = {
  async getBoard() {
    return locked(async () => toBoard(await readState()));
  },
  async getRoster() {
    return locked(async () => toRoster(await readState()));
  },
  async addParticipant(name: unknown, giftCode: unknown) {
    return locked(async () => {
      const state = await readState();
      assertUnlocked(state);
      if (state.participants.length >= MAX_PEOPLE) {
        throw new StoreError("200명까지만 추가할 수 있어요.", 400);
      }
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName);
      const person: Participant = {
        id: randomUUID(),
        name: nextName,
        giftCode: nextCode,
        createdAt: new Date().toISOString(),
      };
      state.participants.push(person);
      await writeState(state);
      return { id: person.id, name: person.name, giftCode: person.giftCode };
    });
  },
  async updateParticipant(id: string, name: unknown, giftCode: unknown) {
    return locked(async () => {
      const state = await readState();
      assertUnlocked(state);
      const person = state.participants.find((item) => item.id === id);
      if (!person) throw new StoreError("참가자를 찾을 수 없어요.", 404);
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName, id);
      person.name = nextName;
      person.giftCode = nextCode;
      await writeState(state);
    });
  },
  async removeParticipant(id: string) {
    return locked(async () => {
      const state = await readState();
      assertUnlocked(state);
      const next = state.participants.filter((person) => person.id !== id);
      if (next.length === state.participants.length) {
        throw new StoreError("참가자를 찾을 수 없어요.", 404);
      }
      state.participants = next;
      await writeState(state);
    });
  },
  async assignAll() {
    return locked(async () => {
      const state = await readState();
      if (state.assignments.length > 0) {
        throw new StoreError(
          "이미 배정이 끝났어요. 다시 섞으려면 관리에서 진행해 주세요.",
          409,
        );
      }
      state.assignments = buildAssignments(state.participants);
      await writeState(state);
      return toBoard(state);
    });
  },
  async reshuffle() {
    return locked(async () => {
      const state = await readState();
      if (state.assignments.length === 0) {
        throw new StoreError("아직 배정하지 않았어요.", 409);
      }
      state.assignments = buildAssignments(state.participants);
      await writeState(state);
      return toBoard(state);
    });
  },
  async unlockRoster() {
    return locked(async () => {
      const state = await readState();
      state.assignments = [];
      await writeState(state);
      return toBoard(state);
    });
  },
  async revealGift(receiverId: string) {
    return locked(async () => {
      const state = await readState();
      const person = state.participants.find((item) => item.id === receiverId);
      if (!person) throw new StoreError("참가자를 찾을 수 없어요.", 404);
      const assignment = state.assignments.find(
        (item) => item.receiverId === receiverId,
      );
      if (!assignment) throw new StoreError("아직 배정하지 않았어요.", 409);
      if (!assignment.revealedAt) assignment.revealedAt = new Date().toISOString();
      const giver = state.participants.find((item) => item.id === assignment.giverId);
      if (!giver) throw new StoreError("선물 정보를 찾지 못했어요.", 500);
      await writeState(state);
      return { giverName: giver.name, giftCode: giver.giftCode };
    });
  },
};

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function ensureSchema() {
  schemaReady ??= (async () => {
    const sql = await readFile(
      path.join(process.cwd(), "migrations", "001_init.sql"),
      "utf8",
    );
    await getPool().query(sql);
  })();
  return schemaReady;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error);
  } finally {
    client.release();
  }
}

function mapPgError(error: unknown): unknown {
  if (error instanceof StoreError) return error;
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505") return new StoreError("같은 이름이 이미 있어요.", 409);
  return error;
}

function mapParticipant(row: {
  id: string;
  name: string;
  gift_code: string;
  created_at: Date | string;
}): Participant {
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  return {
    id: row.id,
    name: row.name,
    giftCode: row.gift_code,
    createdAt: created,
  };
}

async function readPgState(client: PoolClient): Promise<State> {
  await client.query("SELECT id FROM participants ORDER BY created_at, id FOR UPDATE");
  const people = await client.query(
    "SELECT id, name, gift_code, created_at FROM participants ORDER BY created_at, id",
  );
  const links = await client.query(
    "SELECT receiver_id, giver_id, revealed_at FROM assignments",
  );
  return {
    participants: people.rows.map(mapParticipant),
    assignments: links.rows.map((row) => ({
      receiverId: String(row.receiver_id),
      giverId: String(row.giver_id),
      revealedAt: row.revealed_at
        ? new Date(row.revealed_at as string).toISOString()
        : null,
    })),
  };
}

async function insertAssignments(client: PoolClient, assignments: Assignment[]) {
  await client.query("DELETE FROM assignments");
  if (assignments.length === 0) return;
  await client.query(
    `INSERT INTO assignments (receiver_id, giver_id)
     SELECT * FROM UNNEST($1::text[], $2::text[])`,
    [
      assignments.map((item) => item.receiverId),
      assignments.map((item) => item.giverId),
    ],
  );
}

const pgStore = {
  async getBoard() {
    return withTransaction(async (client) => toBoard(await readPgState(client)));
  },
  async getRoster() {
    return withTransaction(async (client) => toRoster(await readPgState(client)));
  },
  async addParticipant(name: unknown, giftCode: unknown) {
    return withTransaction(async (client) => {
      const state = await readPgState(client);
      assertUnlocked(state);
      if (state.participants.length >= MAX_PEOPLE) {
        throw new StoreError("200명까지만 추가할 수 있어요.", 400);
      }
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName);
      const person: Participant = {
        id: randomUUID(),
        name: nextName,
        giftCode: nextCode,
        createdAt: new Date().toISOString(),
      };
      await client.query(
        "INSERT INTO participants (id, name, gift_code, created_at) VALUES ($1, $2, $3, $4)",
        [person.id, person.name, person.giftCode, person.createdAt],
      );
      return { id: person.id, name: person.name, giftCode: person.giftCode };
    });
  },
  async updateParticipant(id: string, name: unknown, giftCode: unknown) {
    return withTransaction(async (client) => {
      const state = await readPgState(client);
      assertUnlocked(state);
      if (!state.participants.some((person) => person.id === id)) {
        throw new StoreError("참가자를 찾을 수 없어요.", 404);
      }
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName, id);
      await client.query(
        "UPDATE participants SET name = $2, gift_code = $3 WHERE id = $1",
        [id, nextName, nextCode],
      );
    });
  },
  async removeParticipant(id: string) {
    return withTransaction(async (client) => {
      const state = await readPgState(client);
      assertUnlocked(state);
      const result = await client.query("DELETE FROM participants WHERE id = $1", [id]);
      if ((result.rowCount ?? 0) === 0) {
        throw new StoreError("참가자를 찾을 수 없어요.", 404);
      }
    });
  },
  async assignAll() {
    return withTransaction(async (client) => {
      const state = await readPgState(client);
      if (state.assignments.length > 0) {
        throw new StoreError(
          "이미 배정이 끝났어요. 다시 섞으려면 관리에서 진행해 주세요.",
          409,
        );
      }
      const assignments = buildAssignments(state.participants);
      await insertAssignments(client, assignments);
      state.assignments = assignments;
      return toBoard(state);
    });
  },
  async reshuffle() {
    return withTransaction(async (client) => {
      const state = await readPgState(client);
      if (state.assignments.length === 0) {
        throw new StoreError("아직 배정하지 않았어요.", 409);
      }
      const assignments = buildAssignments(state.participants);
      await insertAssignments(client, assignments);
      state.assignments = assignments;
      return toBoard(state);
    });
  },
  async unlockRoster() {
    return withTransaction(async (client) => {
      await client.query("DELETE FROM assignments");
      const state = await readPgState(client);
      state.assignments = [];
      return toBoard(state);
    });
  },
  async revealGift(receiverId: string) {
    return withTransaction(async (client) => {
      const person = await client.query("SELECT id FROM participants WHERE id = $1", [
        receiverId,
      ]);
      if ((person.rowCount ?? 0) === 0) {
        throw new StoreError("참가자를 찾을 수 없어요.", 404);
      }
      const assignment = await client.query(
        `SELECT giver_id, revealed_at
         FROM assignments
         WHERE receiver_id = $1
         FOR UPDATE`,
        [receiverId],
      );
      if ((assignment.rowCount ?? 0) === 0) {
        throw new StoreError("아직 배정하지 않았어요.", 409);
      }
      const giverId = String(assignment.rows[0].giver_id);
      if (!assignment.rows[0].revealed_at) {
        await client.query(
          "UPDATE assignments SET revealed_at = NOW() WHERE receiver_id = $1",
          [receiverId],
        );
      }
      const giver = await client.query(
        "SELECT name, gift_code FROM participants WHERE id = $1",
        [giverId],
      );
      if ((giver.rowCount ?? 0) === 0) {
        throw new StoreError("선물 정보를 찾지 못했어요.", 500);
      }
      return {
        giverName: String(giver.rows[0].name),
        giftCode: String(giver.rows[0].gift_code),
      };
    });
  },
};

function backend() {
  return postgresEnabled() ? pgStore : fileStore;
}

export function getBoard() {
  return backend().getBoard();
}

export function getRoster() {
  return backend().getRoster();
}

export function addParticipant(name: unknown, giftCode: unknown) {
  return backend().addParticipant(name, giftCode);
}

export function updateParticipant(id: string, name: unknown, giftCode: unknown) {
  return backend().updateParticipant(id, name, giftCode);
}

export function removeParticipant(id: string) {
  return backend().removeParticipant(id);
}

export function assignAll() {
  return backend().assignAll();
}

export function reshuffle() {
  return backend().reshuffle();
}

export function unlockRoster() {
  return backend().unlockRoster();
}

export function revealGift(receiverId: string) {
  return backend().revealGift(receiverId);
}
