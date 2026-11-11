import { derangeIds } from "./derangement";

const MAX_NAME = 30;
const MAX_CODE = 120;
const MAX_PEOPLE = 200;

export const BOARD_STORAGE_KEY = "gift-shuffle.board";

export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

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

function emptyState(): State {
  return { participants: [], assignments: [] };
}

function cleanName(value: unknown) {
  if (typeof value !== "string") {
    throw new BoardError("이름을 입력해 주세요.");
  }
  const name = value.trim();
  if (!name) throw new BoardError("이름을 입력해 주세요.");
  if (name.length > MAX_NAME) {
    throw new BoardError("이름은 30자까지 입력할 수 있어요.");
  }
  return name;
}

function cleanCode(value: unknown) {
  if (typeof value !== "string") {
    throw new BoardError("선물 코드를 입력해 주세요.");
  }
  const giftCode = value.trim();
  if (!giftCode) throw new BoardError("선물 코드를 입력해 주세요.");
  if (giftCode.length > MAX_CODE) {
    throw new BoardError("선물 코드는 120자까지 입력할 수 있어요.");
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
    throw new BoardError("배정이 끝난 뒤에는 명단을 바꿀 수 없어요.");
  }
}

function assertUniqueName(state: State, name: string, ignoreId?: string) {
  const taken = state.participants.some(
    (person) => person.name === name && person.id !== ignoreId,
  );
  if (taken) throw new BoardError("같은 이름이 이미 있어요.");
}

function buildAssignments(participants: Participant[]): Assignment[] {
  if (participants.length < 3) {
    throw new BoardError("세 명 이상이어야 돌릴 수 있어요.");
  }
  const people = [...participants].sort(byCreated);
  const givers = derangeIds(people.map((person) => person.id));
  return people.map((person, index) => ({
    receiverId: person.id,
    giverId: givers[index],
    revealedAt: null,
  }));
}

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== "object") return false;
  const person = value as Partial<Participant>;
  return (
    typeof person.id === "string" &&
    typeof person.name === "string" &&
    typeof person.giftCode === "string" &&
    typeof person.createdAt === "string"
  );
}

function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const assignment = value as Partial<Assignment>;
  return (
    typeof assignment.receiverId === "string" &&
    typeof assignment.giverId === "string" &&
    (assignment.revealedAt === null || typeof assignment.revealedAt === "string")
  );
}

function parseState(raw: string | null): State {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<State>;
    if (!Array.isArray(parsed.participants) || !Array.isArray(parsed.assignments)) {
      return emptyState();
    }
    if (!parsed.participants.every(isParticipant) || !parsed.assignments.every(isAssignment)) {
      return emptyState();
    }
    return { participants: parsed.participants, assignments: parsed.assignments };
  } catch {
    return emptyState();
  }
}

export function createBoard(storage: StorageLike, key = BOARD_STORAGE_KEY) {
  function read() {
    return parseState(storage.getItem(key));
  }

  function write(state: State) {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      throw new BoardError("이 브라우저에 명단을 저장하지 못했어요.");
    }
  }

  return {
    getBoard() {
      return toBoard(read());
    },
    getRoster() {
      return toRoster(read());
    },
    addParticipant(name: unknown, giftCode: unknown) {
      const state = read();
      assertUnlocked(state);
      if (state.participants.length >= MAX_PEOPLE) {
        throw new BoardError("200명까지만 추가할 수 있어요.");
      }
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName);
      const person: Participant = {
        id: crypto.randomUUID(),
        name: nextName,
        giftCode: nextCode,
        createdAt: new Date().toISOString(),
      };
      write({ ...state, participants: [...state.participants, person] });
      return { id: person.id, name: person.name, giftCode: person.giftCode };
    },
    updateParticipant(id: string, name: unknown, giftCode: unknown) {
      const state = read();
      assertUnlocked(state);
      const index = state.participants.findIndex((person) => person.id === id);
      if (index < 0) throw new BoardError("참가자를 찾을 수 없어요.");
      const nextName = cleanName(name);
      const nextCode = cleanCode(giftCode);
      assertUniqueName(state, nextName, id);
      const participants = state.participants.slice();
      participants[index] = {
        ...participants[index],
        name: nextName,
        giftCode: nextCode,
      };
      write({ ...state, participants });
    },
    removeParticipant(id: string) {
      const state = read();
      assertUnlocked(state);
      const participants = state.participants.filter((person) => person.id !== id);
      if (participants.length === state.participants.length) {
        throw new BoardError("참가자를 찾을 수 없어요.");
      }
      write({ ...state, participants });
    },
    assignAll() {
      const state = read();
      if (state.assignments.length > 0) {
        throw new BoardError(
          "이미 배정이 끝났어요. 다시 섞으려면 관리에서 진행해 주세요.",
        );
      }
      const next = { ...state, assignments: buildAssignments(state.participants) };
      write(next);
      return toBoard(next);
    },
    reshuffle() {
      const state = read();
      if (state.assignments.length === 0) {
        throw new BoardError("아직 배정하지 않았어요.");
      }
      const next = { ...state, assignments: buildAssignments(state.participants) };
      write(next);
      return toBoard(next);
    },
    unlockRoster() {
      const state = read();
      const next = { ...state, assignments: [] };
      write(next);
      return toBoard(next);
    },
    otherCodes(receiverId: string) {
      const state = read();
      if (!state.participants.some((person) => person.id === receiverId)) {
        throw new BoardError("참가자를 찾을 수 없어요.");
      }
      return state.participants
        .filter((person) => person.id !== receiverId)
        .map((person) => person.giftCode)
        .sort();
    },
    revealGift(receiverId: string) {
      const state = read();
      const person = state.participants.find((item) => item.id === receiverId);
      if (!person) throw new BoardError("참가자를 찾을 수 없어요.");
      const index = state.assignments.findIndex((item) => item.receiverId === receiverId);
      if (index < 0) throw new BoardError("아직 배정하지 않았어요.");
      const assignment = state.assignments[index];
      const giver = state.participants.find((item) => item.id === assignment.giverId);
      if (!giver) throw new BoardError("선물 정보를 찾지 못했어요.");
      if (!assignment.revealedAt) {
        const assignments = state.assignments.slice();
        assignments[index] = {
          ...assignment,
          revealedAt: new Date().toISOString(),
        };
        write({ ...state, assignments });
      }
      return { giverName: giver.name, giftCode: giver.giftCode };
    },
  };
}

export function browserBoard() {
  return createBoard(window.localStorage);
}
