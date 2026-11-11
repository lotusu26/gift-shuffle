"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { clock } from "@/lib/clock";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Person = {
  id: string;
  name: string;
  revealed: boolean;
  giftCode: string | null;
};

type BoardResponse = {
  assigned: boolean;
  participants: { id: string; name: string; revealed: boolean }[];
};

type RosterResponse = {
  assigned: boolean;
  participants: { id: string; name: string; giftCode: string | null }[];
};

type RevealResponse = {
  giverName: string;
  giftCode: string;
};

type DialogState =
  | { kind: "loading"; receiverId: string; receiverName: string }
  | { kind: "spin"; receiverId: string; receiverName: string; shown: string }
  | {
      kind: "landed";
      receiverId: string;
      receiverName: string;
      giverName: string;
      giftCode: string;
    }
  | {
      kind: "result";
      receiverId: string;
      receiverName: string;
      giverName: string;
      giftCode: string;
    }
  | { kind: "error"; receiverId: string; receiverName: string; message: string };

type ConfirmState =
  | { kind: "delete"; id: string; name: string }
  | { kind: "reshuffle" }
  | { kind: "unlock" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(data?.error || "요청을 처리하지 못했어요.");
  }
  return data as T;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했어요.";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function GiftApp() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [banner, setBanner] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", giftCode: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", giftCode: "" });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const spinToken = useRef(0);
  const codeRef = useRef<HTMLParagraphElement>(null);

  const applyBoard = useCallback((board: BoardResponse) => {
    setAssigned(true);
    setPeople(
      board.participants.map((person) => ({
        id: person.id,
        name: person.name,
        revealed: person.revealed,
        giftCode: null,
      })),
    );
    setStatus("ready");
  }, []);

  const load = useCallback(async () => {
    const board = await api<BoardResponse>("/api/board");
    if (board.assigned) {
      applyBoard(board);
      return;
    }
    const roster = await api<RosterResponse>("/api/participants");
    setAssigned(false);
    setPeople(
      roster.participants.map((person) => ({
        id: person.id,
        name: person.name,
        revealed: false,
        giftCode: person.giftCode,
      })),
    );
    setStatus("ready");
  }, [applyBoard]);

  useEffect(() => {
    let cancelled = false;
    api<BoardResponse>("/api/board")
      .then(async (board) => {
        if (cancelled) return;
        if (board.assigned) {
          applyBoard(board);
          return;
        }
        const roster = await api<RosterResponse>("/api/participants");
        if (cancelled) return;
        setAssigned(false);
        setPeople(
          roster.participants.map((person) => ({
            id: person.id,
            name: person.name,
            revealed: false,
            giftCode: person.giftCode,
          })),
        );
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setLoadError(messageOf(error));
      });
    return () => {
      cancelled = true;
    };
  }, [applyBoard]);

  function closeDialog() {
    spinToken.current += 1;
    setDialog(null);
  }

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    setBanner("");
    setPending(true);
    try {
      await api("/api/participants", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "", giftCode: "" });
      await load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  async function saveEdit(id: string) {
    setBanner("");
    setPending(true);
    try {
      await api("/api/participants", {
        method: "PATCH",
        body: JSON.stringify({ id, ...draft }),
      });
      setEditingId(null);
      await load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  async function removePerson(id: string) {
    setBanner("");
    setPending(true);
    try {
      await api("/api/participants", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setConfirm(null);
      if (editingId === id) setEditingId(null);
      await load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  async function startDraw() {
    setBanner("");
    setPending(true);
    try {
      applyBoard(await api<BoardResponse>("/api/assign", { method: "POST" }));
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBanner("");
    setPending(true);
    try {
      if (confirm.kind === "delete") {
        await removePerson(confirm.id);
        return;
      }
      if (confirm.kind === "reshuffle") {
        applyBoard(
          await api<BoardResponse>("/api/reset", {
            method: "POST",
            body: JSON.stringify({ mode: "reshuffle" }),
          }),
        );
      } else {
        await api("/api/reset", {
          method: "POST",
          body: JSON.stringify({ mode: "unlock" }),
        });
        await load();
      }
      setConfirm(null);
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  async function openGift(person: Person) {
    const token = spinToken.current + 1;
    spinToken.current = token;
    setCopied(false);
    setCopyHint("");

    if (person.revealed) {
      setDialog({
        kind: "loading",
        receiverId: person.id,
        receiverName: person.name,
      });
      try {
        const result = await api<RevealResponse>("/api/reveal", {
          method: "POST",
          body: JSON.stringify({ id: person.id }),
        });
        if (spinToken.current !== token) return;
        setDialog({
          kind: "result",
          receiverId: person.id,
          receiverName: person.name,
          giverName: result.giverName,
          giftCode: result.giftCode,
        });
      } catch (error) {
        if (spinToken.current !== token) return;
        setDialog({
          kind: "error",
          receiverId: person.id,
          receiverName: person.name,
          message: messageOf(error),
        });
      }
      return;
    }

    const others = people
      .filter((item) => item.id !== person.id)
      .map((item) => item.name);
    setDialog({
      kind: "spin",
      receiverId: person.id,
      receiverName: person.name,
      shown: others[0] ?? "…",
    });

    let delay = 70;
    let stopped = false;
    const timers: number[] = [];
    const loop = () => {
      if (stopped || spinToken.current !== token) return;
      const shown = others[Math.floor(Math.random() * others.length)] ?? "…";
      setDialog((current) =>
        current && current.kind === "spin" && current.receiverId === person.id
          ? { ...current, shown }
          : current,
      );
      delay = Math.min(190, delay + 14);
      timers.push(window.setTimeout(loop, delay));
    };
    loop();

    const started = clock();
    try {
      const result = await api<RevealResponse>("/api/reveal", {
        method: "POST",
        body: JSON.stringify({ id: person.id }),
      });
      const remaining = 1400 - (clock() - started);
      if (remaining > 0) await wait(remaining);
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      setPeople((current) =>
        current.map((item) =>
          item.id === person.id ? { ...item, revealed: true } : item,
        ),
      );
      if (spinToken.current !== token) return;
      setDialog({
        kind: "landed",
        receiverId: person.id,
        receiverName: person.name,
        giverName: result.giverName,
        giftCode: result.giftCode,
      });
      await wait(520);
      if (spinToken.current !== token) return;
      setDialog({
        kind: "result",
        receiverId: person.id,
        receiverName: person.name,
        giverName: result.giverName,
        giftCode: result.giftCode,
      });
    } catch (error) {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      if (spinToken.current !== token) return;
      setDialog({
        kind: "error",
        receiverId: person.id,
        receiverName: person.name,
        message: messageOf(error),
      });
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyHint("");
    } catch {
      const node = codeRef.current;
      if (node) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyHint("코드가 선택되어 있어요. 직접 복사해 주세요.");
    }
  }

  const opened = people.filter((person) => person.revealed).length;

  return (
    <div className="relative flex flex-1 flex-col">
      <KnitBand />
      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
        <Sparkles />
        <header className="relative mx-auto max-w-xl text-center">
          <p className="text-xs tracking-[0.42em] text-[#c7271a]">메리 크리스마스</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-[#f6ead2] sm:text-5xl">
            랜덤 선물 뽑기
          </h1>
          <div className="mt-4 flex justify-center">
            <PixelFlake scale={2} />
          </div>
          <p className="mt-4 text-sm leading-6 text-[#eadcc8] sm:text-base">
            {assigned
              ? "자기 이름을 누르면 다른 사람의 선물이 열려요."
              : "이름과 카카오톡 선물하기 코드를 넣은 뒤, 한 번에 돌려요."}
          </p>
        </header>

        <div className="mt-10 flex flex-1 flex-col">
          {status === "loading" ? (
            <p className="py-20 text-center text-[#dee6ed]">명단을 불러오는 중</p>
          ) : null}

          {status === "error" ? (
            <div className="knit-patch mx-auto max-w-xl text-center">
              <div className="bg-[#c7271a] px-6 py-3 text-sm tracking-[0.2em] text-[#f7f4f2]">
                크리스마스
              </div>
              <div className="px-6 py-8">
              <p className="text-2xl font-bold">명단을 불러오지 못했어요</p>
              <p className="mt-2 text-sm text-[#3d5a86]">{loadError}</p>
              <Button
                className="mt-6 h-11 px-5"
                onClick={() => {
                  setStatus("loading");
                  load().catch((error: unknown) => {
                    setStatus("error");
                    setLoadError(messageOf(error));
                  });
                }}
              >
                다시 시도
              </Button>
              </div>
            </div>
          ) : null}

          {status === "ready" && !assigned ? (
            <SetupPanel
              people={people}
              form={form}
              draft={draft}
              editingId={editingId}
              pending={pending}
              banner={banner}
              onForm={setForm}
              onDraft={setDraft}
              onEdit={(person) => {
                setEditingId(person.id);
                setDraft({
                  name: person.name,
                  giftCode: person.giftCode ?? "",
                });
                setBanner("");
              }}
              onCancelEdit={() => setEditingId(null)}
              onAdd={addPerson}
              onSave={saveEdit}
              onAskDelete={(person) =>
                setConfirm({ kind: "delete", id: person.id, name: person.name })
              }
              onStart={startDraw}
            />
          ) : null}

          {status === "ready" && assigned ? (
            <section>
              <p className="text-center text-sm text-[#c5d4e6]">
                {opened === people.length
                  ? "모두 확인했어요. 연 이름은 다시 눌러 코드를 볼 수 있어요."
                  : `${opened}명 확인 · ${people.length - opened}명 남음`}
              </p>
              <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {people.map((person, index) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => openGift(person)}
                      className="flex min-h-52 w-full flex-col items-center justify-end gap-2 bg-transparent px-2 py-4 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6ead2]"
                    >
                      <PixelGift
                        open={person.revealed}
                        tone={index % 2 === 0 ? "berry" : "pine"}
                      />
                      <span className="line-clamp-2 break-keep text-2xl font-bold leading-tight text-[#f6ead2]">
                        {person.name}
                      </span>
                      <span className="text-xs tracking-[0.18em] text-[#f0c2b4]">
                        {person.revealed ? "다시 보기" : "눌러서 뽑기"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {banner ? (
                <p role="alert" className="mt-4 text-center text-sm text-[#ffd0c8]">
                  {banner}
                </p>
              ) : null}
              <div className="mx-auto mt-10 max-w-xl pt-2 text-center">
                <div className="dash-row" />
                <p className="mt-4 text-sm leading-6 text-[#c5d4e6]">
                  짝은 시작할 때 이미 정해져 있어요. 다시 섞거나 명단을 고치면
                  지금까지 연 결과도 사라집니다.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 border-[#c7271a] bg-[#e7eef4] px-4 text-[#042a6a] hover:bg-white"
                    onClick={() => setConfirm({ kind: "reshuffle" })}
                  >
                    다시 섞기
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4 text-[#dee6ed] hover:bg-[#dee6ed]/10"
                    onClick={() => setConfirm({ kind: "unlock" })}
                  >
                    명단 수정
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </main>
      <KnitBand flip />

      <Dialog open={dialog != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="knit-patch overflow-hidden p-6 sm:max-w-md">
          {dialog?.kind === "spin" || dialog?.kind === "landed" ? (
            <DialogHeader className="items-center text-center">
              <DialogTitle className="text-2xl font-bold">
                {dialog.kind === "landed" ? `${dialog.giverName}님의 선물` : "뽑는 중"}
              </DialogTitle>
              <DialogDescription>
                {dialog.receiverName}님 차례예요. 자기 이름은 나오지 않아요.
              </DialogDescription>
              <p className="sr-only">
                {dialog.kind === "landed"
                  ? `${dialog.giverName}님의 선물로 정해졌습니다.`
                  : "추첨 중입니다."}
              </p>
              <p
                aria-hidden
                className={`mt-4 min-h-16 text-center text-4xl font-bold text-[#c7271a] ${
                  dialog.kind === "landed" ? "settle-in" : ""
                }`}
              >
                {dialog.kind === "landed" ? dialog.giverName : dialog.shown}
              </p>
            </DialogHeader>
          ) : null}

          {dialog?.kind === "loading" ? (
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">선물을 여는 중</DialogTitle>
              <DialogDescription>잠시만 기다려 주세요.</DialogDescription>
            </DialogHeader>
          ) : null}

          {dialog?.kind === "result" ? (
            <DialogHeader>
              <DialogTitle className="text-center text-2xl font-bold">
                {dialog.giverName}님의 선물
              </DialogTitle>
              <DialogDescription className="text-center">
                {dialog.receiverName}님이 받는 카카오톡 선물하기 코드예요.
              </DialogDescription>
              <p
                ref={codeRef}
                className="mt-2 break-all bg-[#042a6a] px-4 py-4 text-center font-mono text-lg tracking-wide text-[#dee6ed]"
              >
                {dialog.giftCode}
              </p>
              <Button
                type="button"
                className="mt-1 h-11"
                onClick={() => copyCode(dialog.giftCode)}
              >
                {copied ? "복사했어요" : "코드 복사"}
              </Button>
              {copyHint ? (
                <p className="text-center text-sm text-[#c7271a]">{copyHint}</p>
              ) : null}
            </DialogHeader>
          ) : null}

          {dialog?.kind === "error" ? (
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">뽑지 못했어요</DialogTitle>
              <DialogDescription>{dialog.message}</DialogDescription>
              <Button
                type="button"
                className="h-11"
                onClick={() => {
                  const person = people.find((item) => item.id === dialog.receiverId);
                  if (person) void openGift(person);
                }}
              >
                다시 시도
              </Button>
            </DialogHeader>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm(null);
        }}
      >
        <DialogContent className="knit-patch overflow-hidden p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {confirm?.kind === "delete"
                ? "참가자를 뺄까요?"
                : confirm?.kind === "reshuffle"
                  ? "다시 섞을까요?"
                  : "명단을 수정할까요?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "delete"
                ? `${confirm.name}님을 명단에서 뺍니다. 선물 코드도 함께 지워져요.`
                : confirm?.kind === "reshuffle"
                  ? "모두에게 새 상대가 정해지고, 이미 연 결과도 처음 상태로 돌아갑니다."
                  : "배정이 취소됩니다. 이름과 코드를 바꾼 뒤 다시 돌려야 해요."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 border-[#9eb0c6] bg-white px-4 text-[#042a6a] hover:bg-[#d5e0ea]"
              disabled={pending}
              onClick={() => setConfirm(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => void runConfirm()}
            >
              {confirm?.kind === "delete"
                ? "빼기"
                : confirm?.kind === "reshuffle"
                  ? "다시 섞기"
                  : "배정 취소"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const FLAKE_CELLS: Array<[number, number]> = [
  [0, 0],
  [0, -1], [0, -2], [0, -3], [0, -4], [0, -5],
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [-1, 0], [-2, 0], [-3, 0], [-4, 0], [-5, 0],
  [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
  [-1, -1], [-2, -2], [-3, -3], [-4, -4],
  [1, -1], [2, -2], [3, -3], [4, -4],
  [-1, 1], [-2, 2], [-3, 3], [-4, 4],
  [1, 1], [2, 2], [3, 3], [4, 4],
  [-1, -4], [1, -4], [-4, -1], [-4, 1],
  [4, -1], [4, 1], [-1, 4], [1, 4],
  [-2, -5], [2, -5], [-5, -2], [5, -2],
  [-2, 5], [2, 5], [-5, 2], [5, 2],
];

const FLAKE_FILL = {
  white: "#dee6ed",
  navy: "#042a6a",
  red: "#c7271a",
} as const;

const SPARKS = [
  { top: "12%", left: "6%", size: 3, delay: "0s" },
  { top: "22%", left: "18%", size: 2, delay: "0.8s" },
  { top: "8%", left: "78%", size: 2, delay: "1.4s" },
  { top: "30%", left: "92%", size: 3, delay: "0.3s" },
  { top: "48%", left: "4%", size: 2, delay: "1.8s" },
  { top: "62%", left: "94%", size: 2, delay: "0.6s" },
  { top: "74%", left: "10%", size: 3, delay: "1.1s" },
  { top: "86%", left: "88%", size: 2, delay: "2s" },
  { top: "40%", left: "84%", size: 2, delay: "0.2s" },
  { top: "16%", left: "48%", size: 2, delay: "1.6s" },
];

function PixelFlake({
  scale = 3,
  tone = "white",
}: {
  scale?: number;
  tone?: keyof typeof FLAKE_FILL;
}) {
  const size = 12 * scale;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-6 -6 12 12"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {FLAKE_CELLS.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          x={x - 0.5}
          y={y - 0.5}
          width="1"
          height="1"
          fill={FLAKE_FILL[tone]}
        />
      ))}
    </svg>
  );
}

const HEART_CELLS: Array<[number, number]> = [
  [1, 0], [2, 0], [4, 0], [5, 0],
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
  [1, 3], [2, 3], [3, 3], [4, 3], [5, 3],
  [2, 4], [3, 4], [4, 4],
  [3, 5],
];

function PixelHeart() {
  return (
    <svg width="28" height="24" viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden>
      {HEART_CELLS.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill="#c44536" />
      ))}
    </svg>
  );
}

function PixelGift({
  open = false,
  tone = "berry",
  scale = 4,
}: {
  open?: boolean;
  tone?: "berry" | "pine";
  scale?: number;
}) {
  const yarn = tone === "pine" ? "#2f6b4f" : "#d4534a";
  const edge = tone === "pine" ? "#1d4a36" : "#a33b34";
  const wrap = open ? "#f6ead2" : yarn;
  const border = open ? "#e2d3b4" : edge;
  const ribbon = open ? yarn : "#f6ead2";
  const cells: Array<[number, number, string]> = [];
  for (let y = 6; y <= 16; y += 1) {
    for (let x = 1; x <= 14; x += 1) {
      const outline = x === 1 || x === 14 || y === 6 || y === 16;
      const band = x === 7 || x === 8 || y === 10 || y === 11;
      cells.push([x, y, outline ? border : band ? ribbon : wrap]);
    }
  }
  const bow = [
    [2, 1], [3, 1], [4, 1], [5, 1],
    [1, 2], [2, 2], [3, 2], [4, 2], [5, 2],
    [2, 3], [3, 3], [4, 3],
    [10, 1], [11, 1], [12, 1], [13, 1],
    [10, 2], [11, 2], [12, 2], [13, 2], [14, 2],
    [11, 3], [12, 3], [13, 3],
    [6, 2], [7, 1], [7, 2], [7, 3], [8, 1], [8, 2], [8, 3], [9, 2],
    [7, 4], [8, 4], [7, 5], [8, 5],
  ];
  for (const [x, y] of bow) cells.push([x, y, ribbon]);
  return (
    <svg
      width={16 * scale}
      height={18 * scale}
      viewBox="0 0 16 18"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {cells.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill={fill} />
      ))}
    </svg>
  );
}

const YOKE = ["heart", "flake", "gift", "heart", "flake", "gift", "heart"] as const;

function KnitBand({ flip = false }: { flip?: boolean }) {
  return (
    <div className={flip ? "sweater-yoke flex flex-col-reverse" : "sweater-yoke"} aria-hidden>
      <div className="dash-row" />
      <div className="flex items-end justify-evenly px-2 py-2">
        {YOKE.map((kind, index) => {
          if (kind === "heart") return <PixelHeart key={`${kind}-${index}`} />;
          if (kind === "flake") {
            return <PixelFlake key={`${kind}-${index}`} scale={2} tone="navy" />;
          }
          return (
            <PixelGift
              key={`${kind}-${index}`}
              scale={2}
              tone={index % 2 === 0 ? "berry" : "pine"}
            />
          );
        })}
      </div>
      <div className="dash-row dash-row-offset" />
    </div>
  );
}

function Sparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {SPARKS.map((spark) => (
        <span
          key={`${spark.top}-${spark.left}`}
          className="spark"
          style={{
            top: spark.top,
            left: spark.left,
            width: spark.size,
            height: spark.size,
            animationDelay: spark.delay,
          }}
        />
      ))}
    </div>
  );
}

function SetupPanel({
  people,
  form,
  draft,
  editingId,
  pending,
  banner,
  onForm,
  onDraft,
  onEdit,
  onCancelEdit,
  onAdd,
  onSave,
  onAskDelete,
  onStart,
}: {
  people: Person[];
  form: { name: string; giftCode: string };
  draft: { name: string; giftCode: string };
  editingId: string | null;
  pending: boolean;
  banner: string;
  onForm: (next: { name: string; giftCode: string }) => void;
  onDraft: (next: { name: string; giftCode: string }) => void;
  onEdit: (person: Person) => void;
  onCancelEdit: () => void;
  onAdd: (event: FormEvent) => void;
  onSave: (id: string) => void;
  onAskDelete: (person: Person) => void;
  onStart: () => void;
}) {
  return (
    <section className="knit-patch mx-auto w-full max-w-xl">
      <div className="flex items-baseline justify-between gap-3 bg-[#c7271a] px-5 py-4 text-[#f7f4f2] sm:px-7">
        <h2 className="text-2xl font-bold">참가자</h2>
        <p className="text-sm">{people.length}명</p>
      </div>
      <div className="px-5 py-6 sm:px-7">
      <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr_auto]">
        <label className="grid gap-1 text-sm">
          <span className="text-[#3d5a86]">이름</span>
          <Input
            value={form.name}
            onChange={(event) => onForm({ ...form, name: event.target.value })}
            placeholder="이름"
            maxLength={30}
            className="h-11 rounded-none border-[#9eb0c6] bg-white text-base text-[#042a6a]"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-[#3d5a86]">선물 코드</span>
          <Input
            value={form.giftCode}
            onChange={(event) => onForm({ ...form, giftCode: event.target.value })}
            placeholder="카카오톡 선물하기 코드"
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-none border-[#9eb0c6] bg-white text-base text-[#042a6a]"
          />
        </label>
        <Button type="submit" className="h-11 self-end px-4" disabled={pending}>
          추가
        </Button>
      </form>

      {banner ? (
        <p role="alert" className="mt-4 bg-[#c7271a]/10 px-3 py-2 text-sm text-[#c7271a]">
          {banner}
        </p>
      ) : null}

      {people.length === 0 ? (
        <p className="mt-6 border border-dashed border-[#c7271a]/50 bg-[#f7f4f2] px-4 py-8 text-center text-sm leading-6 text-[#042a6a]">
          아직 참가자가 없어요. 이름과 그 사람이 거는 선물 코드를 추가하세요.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-[#c5d3e0]">
          {people.map((person) => (
            <li key={person.id} className="py-3">
              {editingId === person.id ? (
                <div className="grid gap-2">
                  <Input
                    value={draft.name}
                    onChange={(event) => onDraft({ ...draft, name: event.target.value })}
                    aria-label={`${person.name} 이름 수정`}
                    maxLength={30}
                    className="h-11 rounded-none border-[#9eb0c6] bg-white text-[#042a6a]"
                  />
                  <Input
                    value={draft.giftCode}
                    onChange={(event) =>
                      onDraft({ ...draft, giftCode: event.target.value })
                    }
                    aria-label={`${person.name} 선물 코드 수정`}
                    maxLength={120}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-11 rounded-none border-[#9eb0c6] bg-white text-[#042a6a]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 border-[#9eb0c6] bg-white px-3 text-[#042a6a] hover:bg-[#d5e0ea]"
                      onClick={onCancelEdit}
                    >
                      취소
                    </Button>
                    <Button
                      type="button"
                      className="h-10 px-3"
                      disabled={pending}
                      onClick={() => onSave(person.id)}
                    >
                      저장
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{person.name}</p>
                    <p className="mt-0.5 break-all text-sm text-[#3d5a86]">
                      {person.giftCode}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 px-3"
                      onClick={() => onEdit(person)}
                    >
                      수정
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 px-3 text-[#c7271a] hover:text-[#c7271a]"
                      onClick={() => onAskDelete(person)}
                    >
                      빼기
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-[#c5d3e0] pt-5">
        <Button
          type="button"
          className="h-12 w-full text-base"
          disabled={pending || people.length < 3}
          onClick={onStart}
        >
          선물 돌리기
        </Button>
        <p className="mt-3 text-center text-sm leading-6 text-[#3d5a86]">
          {people.length < 3
            ? "세 명 이상이어야 돌릴 수 있어요. 두 명이면 서로 교환밖에 안 돼요."
            : "시작할 때 전체를 짝지어요. 자기 선물도, 둘이 맞바꾸는 일도 없어요."}
        </p>
      </div>
      </div>
    </section>
  );
}
