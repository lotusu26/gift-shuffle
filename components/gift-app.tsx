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
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <Snow />
      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-14">
        <header className="mx-auto max-w-xl text-center">
          <p className="text-xs tracking-[0.42em] text-[#f2d48a]">메리 크리스마스</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-[#fffaf3] sm:text-5xl">
            랜덤 선물 뽑기
          </h1>
          <Lights />
          <p className="mt-4 text-sm leading-6 text-[#d7efe0] sm:text-base">
            {assigned
              ? "자기 이름을 누르면 다른 사람의 선물이 열려요."
              : "이름과 카카오톡 선물하기 코드를 넣은 뒤, 한 번에 돌려요."}
          </p>
        </header>

        <div className="mt-10 flex flex-1 flex-col">
          {status === "loading" ? (
            <p className="py-20 text-center text-[#d7efe0]">명단을 불러오는 중</p>
          ) : null}

          {status === "error" ? (
            <div className="mx-auto max-w-xl overflow-hidden rounded-[1.6rem] bg-[#fffaf3] text-center text-[#1a3d2c] shadow-[0_24px_70px_rgba(4,20,12,0.35)]">
              <div className="bg-[#c23b2e] px-6 py-3 text-sm tracking-[0.2em] text-[#fffaf3]">
                크리스마스
              </div>
              <div className="px-6 py-8">
              <p className="font-serif text-2xl">명단을 불러오지 못했어요</p>
              <p className="mt-2 text-sm text-[#5d6b5a]">{loadError}</p>
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
              <p className="text-center text-sm text-[#d7efe0]">
                {opened === people.length
                  ? "모두 확인했어요. 연 이름은 다시 눌러 코드를 볼 수 있어요."
                  : `${opened}명 확인 · ${people.length - opened}명 남음`}
              </p>
              <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => openGift(person)}
                      className={
                        person.revealed
                          ? "relative flex min-h-52 w-full flex-col items-center justify-end gap-2 overflow-hidden rounded-[1.4rem] bg-[#fffaf3] px-3 pb-5 pt-8 text-[#1a3d2c] shadow-[0_18px_40px_rgba(4,20,12,0.28)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2d48a]"
                          : "relative flex min-h-52 w-full flex-col items-center justify-end gap-2 overflow-hidden rounded-[1.4rem] bg-[#1c6b45] px-3 pb-5 pt-6 text-[#f7fff8] shadow-[0_18px_40px_rgba(4,20,12,0.35)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2d48a]"
                      }
                    >
                      {person.revealed ? (
                        <span className="absolute inset-x-0 top-0 h-2 bg-[#c23b2e]" />
                      ) : (
                        <>
                          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-[#e7c56a]" />
                          <span className="pointer-events-none absolute inset-x-0 top-[42%] h-3 bg-[#c23b2e]" />
                        </>
                      )}
                      {person.revealed ? (
                        <span className="relative text-xs tracking-[0.22em] text-[#c23b2e]">
                          받음
                        </span>
                      ) : (
                        <GiftBow />
                      )}
                      <span
                        className={
                          person.revealed
                            ? "relative line-clamp-2 break-keep font-serif text-2xl leading-tight"
                            : "relative line-clamp-2 break-keep rounded-full bg-[#fffaf3] px-3 py-1 font-serif text-xl leading-tight text-[#1a3d2c]"
                        }
                      >
                        {person.name}
                      </span>
                      <span
                        className={
                          person.revealed
                            ? "relative text-xs text-[#5d6b5a]"
                            : "relative text-xs text-[#f7fff8]/85"
                        }
                      >
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
              <div className="mx-auto mt-10 max-w-xl border-t border-[#f2d48a]/25 pt-6 text-center">
                <p className="text-sm leading-6 text-[#d7efe0]/85">
                  짝은 시작할 때 이미 정해져 있어요. 다시 섞거나 명단을 고치면
                  지금까지 연 결과도 사라집니다.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 border-[#f2d48a]/40 bg-[#fffaf3]/10 px-4 text-[#fffaf3] hover:bg-[#fffaf3]/20"
                    onClick={() => setConfirm({ kind: "reshuffle" })}
                  >
                    다시 섞기
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4 text-[#fffaf3] hover:bg-[#fffaf3]/15"
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

      <Dialog open={dialog != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="overflow-hidden border-t-8 border-[#c23b2e] bg-[#fffaf3] p-6 text-[#1a3d2c] sm:max-w-md">
          {dialog?.kind === "spin" || dialog?.kind === "landed" ? (
            <DialogHeader className="items-center text-center">
              <DialogTitle className="font-serif text-2xl">
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
                className={`mt-4 min-h-16 text-center font-serif text-4xl text-[#c23b2e] ${
                  dialog.kind === "landed" ? "settle-in" : ""
                }`}
              >
                {dialog.kind === "landed" ? dialog.giverName : dialog.shown}
              </p>
            </DialogHeader>
          ) : null}

          {dialog?.kind === "loading" ? (
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">선물을 여는 중</DialogTitle>
              <DialogDescription>잠시만 기다려 주세요.</DialogDescription>
            </DialogHeader>
          ) : null}

          {dialog?.kind === "result" ? (
            <DialogHeader>
              <DialogTitle className="text-center font-serif text-2xl">
                {dialog.giverName}님의 선물
              </DialogTitle>
              <DialogDescription className="text-center">
                {dialog.receiverName}님이 받는 카카오톡 선물하기 코드예요.
              </DialogDescription>
              <p
                ref={codeRef}
                className="mt-2 break-all rounded-2xl bg-[#143528] px-4 py-4 text-center font-mono text-lg tracking-wide text-[#fffaf3]"
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
                <p className="text-center text-sm text-[#c23b2e]">{copyHint}</p>
              ) : null}
            </DialogHeader>
          ) : null}

          {dialog?.kind === "error" ? (
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">뽑지 못했어요</DialogTitle>
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
        <DialogContent className="overflow-hidden border-t-8 border-[#1c6b45] bg-[#fffaf3] p-6 text-[#1a3d2c] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
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
              className="h-11 px-4"
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

const FLAKES = [
  { left: "6%", delay: "0s", duration: "13s", size: 5, opacity: 0.75 },
  { left: "14%", delay: "2s", duration: "16s", size: 3, opacity: 0.5 },
  { left: "23%", delay: "5s", duration: "12s", size: 6, opacity: 0.85 },
  { left: "31%", delay: "1s", duration: "18s", size: 4, opacity: 0.6 },
  { left: "40%", delay: "7s", duration: "14s", size: 3, opacity: 0.45 },
  { left: "48%", delay: "3s", duration: "15s", size: 7, opacity: 0.8 },
  { left: "57%", delay: "6s", duration: "11s", size: 4, opacity: 0.55 },
  { left: "66%", delay: "0.5s", duration: "17s", size: 5, opacity: 0.7 },
  { left: "74%", delay: "4s", duration: "13s", size: 3, opacity: 0.5 },
  { left: "83%", delay: "8s", duration: "16s", size: 6, opacity: 0.8 },
  { left: "91%", delay: "2.5s", duration: "12s", size: 4, opacity: 0.6 },
  { left: "97%", delay: "9s", duration: "19s", size: 3, opacity: 0.4 },
];

const BULBS = ["#e24b4b", "#f2d48a", "#7dcea0", "#8ec8ff", "#e24b4b", "#f2d48a", "#7dcea0"];

function Snow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {FLAKES.map((flake) => (
        <span
          key={flake.left}
          className="snowflake"
          style={{
            left: flake.left,
            width: flake.size,
            height: flake.size,
            opacity: flake.opacity,
            animationDuration: flake.duration,
            animationDelay: flake.delay,
          }}
        />
      ))}
    </div>
  );
}

function Lights() {
  return (
    <div className="mt-4 flex items-center justify-center gap-3" aria-hidden>
      <span className="h-px w-8 bg-[#f2d48a]/50" />
      {BULBS.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="size-2.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}` }}
        />
      ))}
      <span className="h-px w-8 bg-[#f2d48a]/50" />
    </div>
  );
}

function GiftBow() {
  return (
    <span aria-hidden className="relative z-10 mb-1 h-14 w-16">
      <span className="absolute left-0 top-1 h-7 w-8 rounded-[50%] border-[3px] border-[#f6e3a4] bg-[#e7c56a]" />
      <span className="absolute right-0 top-1 h-7 w-8 rounded-[50%] border-[3px] border-[#f6e3a4] bg-[#e7c56a]" />
      <span className="absolute left-1/2 top-4 size-4 -translate-x-1/2 rounded-full bg-[#c23b2e] ring-2 ring-[#f6e3a4]" />
      <span className="absolute left-2 top-8 h-6 w-3 -rotate-[28deg] rounded-b-full bg-[#f2d48a]" />
      <span className="absolute right-2 top-8 h-6 w-3 rotate-[28deg] rounded-b-full bg-[#f2d48a]" />
    </span>
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
    <section className="mx-auto w-full max-w-xl overflow-hidden rounded-[1.6rem] bg-[#fffaf3] text-[#1a3d2c] shadow-[0_24px_70px_rgba(4,20,12,0.35)]">
      <div className="flex items-baseline justify-between gap-3 bg-[#c23b2e] px-5 py-4 text-[#fffaf3] sm:px-7">
        <h2 className="font-serif text-2xl">참가자</h2>
        <p className="text-sm text-[#ffe8e4]">{people.length}명</p>
      </div>
      <div className="px-5 py-6 sm:px-7">
      <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr_auto]">
        <label className="grid gap-1 text-sm">
          <span className="text-[#5d6b5a]">이름</span>
          <Input
            value={form.name}
            onChange={(event) => onForm({ ...form, name: event.target.value })}
            placeholder="이름"
            maxLength={30}
            className="h-11 bg-white text-base text-[#1a3d2c]"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-[#5d6b5a]">선물 코드</span>
          <Input
            value={form.giftCode}
            onChange={(event) => onForm({ ...form, giftCode: event.target.value })}
            placeholder="카카오톡 선물하기 코드"
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            className="h-11 bg-white text-base text-[#1a3d2c]"
          />
        </label>
        <Button type="submit" className="h-11 self-end px-4" disabled={pending}>
          추가
        </Button>
      </form>

      {banner ? (
        <p role="alert" className="mt-4 rounded-xl bg-[#c23b2e]/10 px-3 py-2 text-sm text-[#c23b2e]">
          {banner}
        </p>
      ) : null}

      {people.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-[#1c6b45]/30 bg-[#e7f3ea] px-4 py-8 text-center text-sm leading-6 text-[#1a3d2c]">
          아직 참가자가 없어요. 이름과 그 사람이 거는 선물 코드를 추가하세요.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-[#eadfcd]">
          {people.map((person) => (
            <li key={person.id} className="py-3">
              {editingId === person.id ? (
                <div className="grid gap-2">
                  <Input
                    value={draft.name}
                    onChange={(event) => onDraft({ ...draft, name: event.target.value })}
                    aria-label={`${person.name} 이름 수정`}
                    maxLength={30}
                    className="h-11 bg-white text-[#1a3d2c]"
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
                    className="h-11 bg-white text-[#1a3d2c]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 px-3"
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
                    <p className="mt-0.5 break-all text-sm text-[#5d6b5a]">
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
                      className="h-10 px-3 text-[#c23b2e] hover:text-[#c23b2e]"
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

      <div className="mt-6 border-t border-[#eadfcd] pt-5">
        <Button
          type="button"
          className="h-12 w-full text-base"
          disabled={pending || people.length < 2}
          onClick={onStart}
        >
          선물 돌리기
        </Button>
        <p className="mt-3 text-center text-sm leading-6 text-[#5d6b5a]">
          {people.length < 2
            ? "두 명 이상이어야 돌릴 수 있어요."
            : "시작할 때 전체를 짝지어요. 마지막에 눌러도 자기 선물은 나오지 않아요."}
        </p>
      </div>
      </div>
    </section>
  );
}
