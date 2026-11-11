"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { browserBoard, type Board } from "@/lib/board";
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
import { PixelGarland } from "@/components/pixel-garland";

type Person = {
  id: string;
  name: string;
  revealed: boolean;
  giftCode: string | null;
};

type GiftTone = "blue" | "gold" | "teal" | "purple";

type GiftOrigin = { x: number; y: number };

type DialogState = {
  receiverId: string;
  receiverName: string;
  tone: GiftTone;
  origin: GiftOrigin;
  width: number;
} & (
  | { kind: "spin"; shown: string; codes: string[] }
  | { kind: "landed"; giftCode: string; codes: string[] }
  | { kind: "result"; giftCode: string }
  | { kind: "error"; message: string }
);

type ConfirmState =
  | { kind: "delete"; id: string; name: string }
  | { kind: "reshuffle" }
  | { kind: "unlock" };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "처리하지 못했어요.";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const GIFT_TONES = ["blue", "gold", "teal", "purple"] as const;

function toneFor(index: number): GiftTone {
  return GIFT_TONES[index % GIFT_TONES.length];
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mix(hash: number, salt: number) {
  let value = Math.imul(hash ^ salt, 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function giftSpots(people: Person[]) {
  const base = (people.length > 8 ? 44 : people.length > 6 ? 50 : 62) * 1.5;
  const treePx = 340;
  const spots = people.map((person) => {
    const hash = hashString(person.id);
    return {
      id: person.id,
      hash,
      width: Math.round(base * (0.78 + mix(hash, 3) * 0.36)),
      tilt: Math.round((mix(hash, 4) - 0.5) * 8),
      bottom: 0,
      left: 0,
      z: 8,
    };
  });
  const ordered = [...spots].sort((a, b) => a.hash - b.hash);
  const left = ordered.filter((_, index) => index % 2 === 0);
  const right = ordered.filter((_, index) => index % 2 === 1);
  for (const spot of left) spot.left = 33;
  for (const spot of right) spot.left = 67;
  const separate = (group: typeof spots, side: "left" | "right") => {
    const line = [...group].sort((a, b) => a.left - b.left);
    const gapFor = (spot: (typeof spots)[number]) => {
      const gapPx = 6 + mix(spot.hash, 6) * 16;
      return (gapPx / treePx) * 100;
    };
    if (side === "right") {
      for (let index = 1; index < line.length; index += 1) {
        const previous = line[index - 1];
        const current = line[index];
        const minLeft =
          previous.left +
          ((previous.width / treePx) * 100) / 2 +
          gapFor(current) +
          ((current.width / treePx) * 100) / 2;
        if (current.left < minLeft) current.left = minLeft;
      }
      return;
    }
    for (let index = line.length - 2; index >= 0; index -= 1) {
      const next = line[index + 1];
      const current = line[index];
      const maxLeft =
        next.left -
        ((next.width / treePx) * 100) / 2 -
        gapFor(current) -
        ((current.width / treePx) * 100) / 2;
      if (current.left > maxLeft) current.left = maxLeft;
    }
  };
  separate(left, "left");
  separate(right, "right");
  return spots;
}

function centerOf(node: HTMLElement): GiftOrigin {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
  const slotRef = useRef<HTMLDivElement>(null);

  const applyBoard = useCallback((board: Board) => {
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

  const load = useCallback(() => {
    const saved = browserBoard();
    const board = saved.getBoard();
    if (board.assigned) {
      applyBoard(board);
      return;
    }
    const roster = saved.getRoster();
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
    try {
      load();
    } catch (error) {
      setStatus("error");
      setLoadError(messageOf(error));
    }
  }, [load]);

  function closeDialog() {
    spinToken.current += 1;
    setDialog(null);
  }

  useEffect(() => {
    if (!dialog) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        spinToken.current += 1;
        setDialog(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  function addPerson(event: FormEvent) {
    event.preventDefault();
    setBanner("");
    setPending(true);
    try {
      browserBoard().addParticipant(form.name, form.giftCode);
      setForm({ name: "", giftCode: "" });
      load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  function saveEdit(id: string) {
    setBanner("");
    setPending(true);
    try {
      browserBoard().updateParticipant(id, draft.name, draft.giftCode);
      setEditingId(null);
      load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  function removePerson(id: string) {
    setBanner("");
    setPending(true);
    try {
      browserBoard().removeParticipant(id);
      setConfirm(null);
      if (editingId === id) setEditingId(null);
      load();
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  function startDraw() {
    setBanner("");
    setPending(true);
    try {
      applyBoard(browserBoard().assignAll());
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  function runConfirm() {
    if (!confirm) return;
    setBanner("");
    setPending(true);
    try {
      if (confirm.kind === "delete") {
        removePerson(confirm.id);
        return;
      }
      if (confirm.kind === "reshuffle") {
        applyBoard(browserBoard().reshuffle());
      } else {
        browserBoard().unlockRoster();
        load();
      }
      setConfirm(null);
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  function stageOf(person: Person, source?: HTMLElement) {
    const index = people.findIndex((item) => item.id === person.id);
    const origin = source
      ? centerOf(source)
      : { x: window.innerWidth / 2, y: window.innerHeight * 0.36 };
    return {
      receiverId: person.id,
      receiverName: person.name,
      tone: toneFor(Math.max(index, 0)),
      origin,
      width: source && source.offsetWidth > 0 ? source.offsetWidth : people.length > 6 ? 78 : 96,
    };
  }

  async function openGift(person: Person, source?: HTMLElement) {
    const token = spinToken.current + 1;
    spinToken.current = token;
    setCopied(false);
    setCopyHint("");
    const stage = stageOf(person, source);

    if (person.revealed) {
      try {
        const result = browserBoard().revealGift(person.id);
        if (spinToken.current !== token) return;
        setDialog({
          ...stage,
          kind: "result",
          giftCode: result.giftCode,
        });
      } catch (error) {
        if (spinToken.current !== token) return;
        setDialog({
          ...stage,
          kind: "error",
          message: messageOf(error),
        });
      }
      return;
    }

    const codes = browserBoard().otherCodes(person.id);
    setDialog({
      ...stage,
      kind: "spin",
      shown: codes[0] ?? "…",
      codes,
    });

    let delay = 70;
    let stopped = false;
    const timers: number[] = [];
    const loop = () => {
      if (stopped || spinToken.current !== token) return;
      const shown = codes[Math.floor(Math.random() * codes.length)] ?? "…";
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
      const result = browserBoard().revealGift(person.id);
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
        ...stage,
        kind: "landed",
        giftCode: result.giftCode,
        codes,
      });
      await wait(1300);
      if (spinToken.current !== token) return;
      setDialog({
        ...stage,
        kind: "result",
        giftCode: result.giftCode,
      });
    } catch (error) {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      if (spinToken.current !== token) return;
      setDialog({
        ...stage,
        kind: "error",
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
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <CursorSnow />
      <FittedPage>
      <main className="relative w-full px-6 py-8">
        <Sparkles />
        <header className="relative text-center">
          <h1 className="mt-3 text-[3.3rem] font-bold tracking-tight whitespace-nowrap text-[#f6ead2]">
            MERRY CHRISTMAS
          </h1>
          <h2 className="mt-3 text-[1.7rem] leading-tight font-bold text-[#FFD166]">
            랜덤 선물 뽑기
          </h2>
          <div className="mt-4 flex justify-center">
            <PixelFlake scale={2} />
          </div>
          <p className="mt-4 text-lg leading-6 font-bold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
            {assigned
              ? "트리 아래 선물을 눌러 코드를 확인하세요."
              : "이름과 카카오톡 선물하기 코드를 넣은 뒤, 한 번에 돌려요."}
          </p>
        </header>

        <div className="mt-8">
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
                  try {
                    load();
                  } catch (error) {
                    setStatus("error");
                    setLoadError(messageOf(error));
                  }
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
            <section className="mt-2 flex flex-col items-center">
              {/* <p className="rounded-[20px] bg-white/15 px-[14px] py-[6px] text-center text-base font-bold text-[#A8E6CF]">
                {opened === people.length
                  ? "모두 확인했어요. 연 상자는 다시 눌러 코드를 볼 수 있어요."
                  : `${opened}명 확인 · ${people.length - opened}명 남음`}
              </p> */}
              <div className="relative mx-auto mt-2 w-fit">
                <ChristmasTree />
                {giftSpots(people).map((spot) => {
                  const person = people.find((item) => item.id === spot.id);
                  if (!person) return null;
                  const index = people.findIndex((item) => item.id === person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      aria-label={`${person.name} ${person.revealed ? "다시 보기" : "열기"}`}
                      onClick={(event) => {
                        const gift = event.currentTarget.querySelector(".gift-sprite");
                        openGift(
                          person,
                          gift instanceof HTMLElement ? gift : event.currentTarget,
                        );
                      }}
                      className="group absolute bg-transparent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6ead2]"
                      style={{
                        left: `${spot.left}%`,
                        bottom: `${spot.bottom}%`,
                        zIndex: spot.z,
                        transform: "translateX(-50%)",
                      }}
                    >
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap bg-[#f6ead2] px-2 py-1 text-xs font-bold text-[#042a6a] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                        {person.name}
                      </span>
                      <span className="block transition duration-200 group-hover:-translate-y-1">
                        <span className="block" style={{ transform: `rotate(${spot.tilt}deg)` }}>
                          <PixelGift tone={toneFor(index)} width={spot.width} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {banner ? (
                <p role="alert" className="mt-4 text-center text-sm text-[#ffd0c8]">
                  {banner}
                </p>
              ) : null}
              <div className="mx-auto mt-6 max-w-xl pt-2 text-center">
                <div className="dash-row" />
                <p className="mt-4 text-sm leading-6 text-[#c5d4e6]">
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
      </FittedPage>

      {dialog ? (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="presentation">
          <div className="relative flex min-h-full items-center justify-center px-4 py-6">
            <button
              type="button"
              className="absolute inset-0 bg-[#10243a]/80"
              aria-label="닫기"
              onClick={closeDialog}
            />
            <div className="gift-stage pointer-events-none relative z-[72] flex flex-col items-center">
              <div ref={slotRef} className="h-28 w-28 shrink-0" aria-hidden />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="gift-stage-title"
                className="gift-popup-card pointer-events-auto relative mt-12 w-[min(27rem,calc(100vw-2rem))] px-6 pb-7 pt-24 text-center text-[var(--ink)]"
              >
              <PixelGarland />
              {dialog.kind === "spin" || dialog.kind === "landed" ? (
                <>
                  <h2 id="gift-stage-title" className="text-2xl font-bold">
                    {dialog.kind === "landed" ? "선물 코드" : "코드 뽑는 중"}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {dialog.receiverName}님 차례예요.
                  </p>
                  <p className="sr-only">
                    {dialog.kind === "landed"
                      ? "선물 코드가 정해졌습니다."
                      : "추첨 중입니다."}
                  </p>
                  <Roulette
                    entries={dialog.codes}
                    winner={dialog.kind === "landed" ? dialog.giftCode : null}
                  />
                </>
              ) : null}

              {dialog.kind === "result" ? (
                <>
                  <h2 id="gift-stage-title" className="text-2xl font-bold">
                    선물 코드
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {dialog.receiverName}님이 받는 카카오톡 선물하기 코드예요.
                  </p>
                  <p
                    ref={codeRef}
                    className="mt-3 break-all rounded-2xl bg-[var(--night)] px-4 py-4 font-mono text-lg tracking-wide text-[var(--cream)]"
                  >
                    {dialog.giftCode}
                  </p>
                  <Button
                    type="button"
                    className="mt-3 h-11 w-full rounded-full"
                    onClick={() => copyCode(dialog.giftCode)}
                  >
                    {copied ? "복사했어요" : "코드 복사"}
                  </Button>
                  {copyHint ? (
                    <p className="mt-2 text-sm text-[var(--berry)]">{copyHint}</p>
                  ) : null}
                </>
              ) : null}

              {dialog.kind === "error" ? (
                <>
                  <h2 id="gift-stage-title" className="text-2xl font-bold">뽑지 못했어요</h2>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">{dialog.message}</p>
                  <Button
                    type="button"
                    className="mt-4 h-11 rounded-full px-6"
                    onClick={() => {
                      const person = people.find((item) => item.id === dialog.receiverId);
                      if (person) void openGift(person);
                    }}
                  >
                    다시 시도
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          </div>
          <GiftFlight origin={dialog.origin} slot={slotRef}>
            <CenterGift
              tone={dialog.tone}
              width={dialog.width}
              reveal={dialog.kind === "landed" || dialog.kind === "result"}
            />
          </GiftFlight>
        </div>
      ) : null}

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
  { top: "8%", left: "6%", size: 3, delay: "0s", duration: "2.2s", gold: false },
  { top: "14%", left: "18%", size: 2, delay: "0.6s", duration: "2.8s", gold: true },
  { top: "6%", left: "32%", size: 2, delay: "1.4s", duration: "2.4s", gold: false },
  { top: "11%", left: "48%", size: 3, delay: "0.2s", duration: "3s", gold: true },
  { top: "7%", left: "64%", size: 2, delay: "1.1s", duration: "2.1s", gold: false },
  { top: "16%", left: "78%", size: 3, delay: "0.4s", duration: "2.6s", gold: true },
  { top: "9%", left: "90%", size: 2, delay: "1.8s", duration: "2.3s", gold: false },
  { top: "24%", left: "4%", size: 2, delay: "0.9s", duration: "2.7s", gold: false },
  { top: "28%", left: "92%", size: 3, delay: "0.3s", duration: "2.5s", gold: true },
  { top: "36%", left: "12%", size: 2, delay: "1.6s", duration: "2.2s", gold: true },
  { top: "40%", left: "86%", size: 2, delay: "0.1s", duration: "3.1s", gold: false },
  { top: "48%", left: "3%", size: 3, delay: "1.2s", duration: "2.4s", gold: false },
  { top: "52%", left: "94%", size: 2, delay: "0.7s", duration: "2.9s", gold: true },
  { top: "60%", left: "8%", size: 2, delay: "1.5s", duration: "2.2s", gold: true },
  { top: "64%", left: "90%", size: 3, delay: "0.5s", duration: "2.6s", gold: false },
  { top: "72%", left: "14%", size: 2, delay: "1.9s", duration: "2.3s", gold: false },
  { top: "76%", left: "84%", size: 2, delay: "0.8s", duration: "2.8s", gold: true },
  { top: "84%", left: "6%", size: 3, delay: "1.3s", duration: "2.4s", gold: false },
  { top: "88%", left: "22%", size: 2, delay: "0.2s", duration: "3s", gold: true },
  { top: "86%", left: "70%", size: 2, delay: "1.7s", duration: "2.1s", gold: false },
  { top: "92%", left: "48%", size: 3, delay: "0.9s", duration: "2.7s", gold: true },
  { top: "34%", left: "96%", size: 2, delay: "1s", duration: "2.5s", gold: false },
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

type SnowFlake = {
  id: number;
  x: number;
  y: number;
  drift: number;
  duration: number;
  scale: number;
};

function CursorSnow() {
  const [flakes, setFlakes] = useState<SnowFlake[]>([]);
  const ids = useRef(0);
  const last = useRef({ x: 0, y: 0, t: 0 });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function onMove(event: PointerEvent) {
      const now = performance.now();
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      if (now - last.current.t < 28 && dx * dx + dy * dy < 64) return;
      last.current = { x: event.clientX, y: event.clientY, t: now };

      const id = ids.current + 1;
      ids.current = id;
      const duration = 1200 + Math.random() * 800;
      const flake: SnowFlake = {
        id,
        x: event.clientX + (Math.random() - 0.5) * 18,
        y: event.clientY,
        drift: (Math.random() - 0.5) * 36,
        duration,
        scale: Math.random() > 0.65 ? 1.15 : 0.75,
      };
      setFlakes((current) => [...current, flake].slice(-56));
      window.setTimeout(() => {
        setFlakes((current) => current.filter((item) => item.id !== id));
      }, duration);
    }

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden>
      {flakes.map((flake) => (
        <span
          key={flake.id}
          className="cursor-snow absolute"
          style={{
            left: flake.x,
            top: flake.y,
            animationDuration: `${flake.duration}ms`,
            ["--snow-drift" as string]: `${flake.drift}px`,
          }}
        >
          <PixelFlake scale={flake.scale} />
        </span>
      ))}
    </div>
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

const GIFT_FILES = {
  blue: { width: 661, height: 809 },
  gold: { width: 697, height: 810 },
  teal: { width: 680, height: 807 },
  purple: { width: 712, height: 823 },
} as const;

function asset(file: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/assets/${file}`;
}

const CONFETTI: Array<{ left: string; top: string; dx: string; dy: string; color: string; delay: string; rot: string }> = [
  { left: "6%", top: "18%", dx: "-16px", dy: "-26px", color: "#E3B23C", delay: "0s", rot: "50deg" },
  { left: "78%", top: "10%", dx: "18px", dy: "-22px", color: "#C4232A", delay: "0.06s", rot: "-40deg" },
  { left: "2%", top: "40%", dx: "-20px", dy: "-10px", color: "#F6EAD2", delay: "0.1s", rot: "24deg" },
  { left: "86%", top: "36%", dx: "16px", dy: "-8px", color: "#3D8F5E", delay: "0.04s", rot: "70deg" },
  { left: "64%", top: "0%", dx: "10px", dy: "-28px", color: "#F6EAD2", delay: "0.12s", rot: "-18deg" },
  { left: "18%", top: "0%", dx: "-8px", dy: "-24px", color: "#C4232A", delay: "0.08s", rot: "30deg" },
];

function ChristmasTree() {
  return (
    <img
      src={asset("christmas-tree-pixel.png?v=trunk")}
      alt=""
      width={728}
      height={1100}
      draggable={false}
      className="pixel-art mx-auto mt-2 h-[32rem] w-auto"
    />
  );
}

function frameBulbs(across: number, down: number) {
  const points: Array<{ x: number; y: number }> = [];
  const step = (count: number, index: number) => (index / (count - 1)) * 100;
  for (let i = 0; i < across; i += 1) points.push({ x: step(across, i), y: 0 });
  for (let i = 1; i < down - 1; i += 1) points.push({ x: 100, y: step(down, i) });
  for (let i = across - 1; i >= 0; i -= 1) points.push({ x: step(across, i), y: 100 });
  for (let i = down - 2; i >= 1; i -= 1) points.push({ x: 0, y: step(down, i) });
  return points;
}

const SLOT_BULBS = frameBulbs(10, 4);
const BULB_COLORS = ["#ffe27a", "#ff6b6b", "#ffe27a", "#8fe39a"];

function Roulette({ entries, winner }: { entries: string[]; winner: string | null }) {
  const roster = entries.join("\u0000");
  const first = entries[0] ?? "…";
  const [previous, setPrevious] = useState(first);
  const [displayed, setDisplayed] = useState(first);
  const [step, setStep] = useState(0);
  const displayedRef = useRef(first);

  useEffect(() => {
    const list = roster ? roster.split("\u0000") : [];
    if (winner) {
      setPrevious(displayedRef.current);
      setDisplayed(winner);
      displayedRef.current = winner;
      setStep((current) => current + 1);
      return;
    }

    let index = Math.max(0, list.indexOf(displayedRef.current));
    let timer = 0;
    const tick = () => {
      index = (index + 1) % Math.max(list.length, 1);
      const next = list[index] ?? "…";
      setPrevious(displayedRef.current);
      setDisplayed(next);
      displayedRef.current = next;
      setStep((current) => current + 1);
      timer = window.setTimeout(tick, 90);
    };
    timer = window.setTimeout(tick, 90);
    return () => window.clearTimeout(timer);
  }, [winner, roster]);

  return (
    <div className={winner ? "slot-machine is-landed" : "slot-machine"} aria-hidden>
      <div className="slot-crown">LUCKY GIFT</div>
      <div className="slot-marquee">
        <div className="slot-bulbs">
          {SLOT_BULBS.map((bulb, index) => (
            <span
              key={index}
              className="slot-bulb"
              style={{
                left: `${bulb.x}%`,
                top: `${bulb.y}%`,
                "--i": SLOT_BULBS.length - index,
                "--bulb": BULB_COLORS[index % BULB_COLORS.length],
              } as CSSProperties}
            />
          ))}
        </div>
        <span className="slot-pointer is-left" />
        <span className="slot-pointer is-right" />
        <div className="slot-window">
          <div
            key={`${step}-${displayed}`}
            className={winner ? "slot-reel-track is-landing" : "slot-reel-track"}
          >
            <span>{previous}</span>
            <strong>{displayed}</strong>
          </div>
        </div>
      </div>
      <div className="slot-tray" />
      <span className="slot-lever"><i /></span>
    </div>
  );
}

function CenterGift({
  tone,
  width,
  reveal,
}: {
  tone: GiftTone;
  width: number;
  reveal: boolean;
}) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 780);
    return () => window.clearTimeout(id);
  }, []);

  return <PixelGift width={width} tone={tone} open={reveal && settled} />;
}

function GiftFlight({
  origin,
  slot,
  children,
}: {
  origin: GiftOrigin;
  slot: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [atCenter, setAtCenter] = useState(reduce);
  const [glued, setGlued] = useState(reduce);
  const [dest, setDest] = useState(origin);

  useEffect(() => {
    const node = slot.current;
    if (!node) return;
    let flying = !reduce;
    const place = () => {
      const rect = node.getBoundingClientRect();
      setDest({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    if (reduce) {
      place();
      return;
    }
    const fly = window.setTimeout(() => {
      flying = false;
      place();
      setAtCenter(true);
    }, 40);
    const stick = window.setTimeout(() => setGlued(true), 760);
    const stage = node.parentElement;
    const observer = new ResizeObserver(() => {
      if (!flying) place();
    });
    if (stage) observer.observe(stage);
    const onResize = () => {
      if (!flying) place();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(fly);
      window.clearTimeout(stick);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [slot, reduce]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed z-[80] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        glued ? "transition-none" : "transition-[left,top,transform] duration-700"
      }`}
      style={{
        left: `${dest.x}px`,
        top: `${dest.y}px`,
        transform: atCenter
          ? "translate(-50%, -50%) scale(2.1)"
          : "translate(-50%, -50%) scale(1)",
      }}
    >
      {children}
    </div>
  );
}

function PixelGift({
  open = false,
  tone = "gold",
  width = 56,
}: {
  open?: boolean;
  tone?: GiftTone;
  width?: number;
}) {
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    if (!open) {
      setLifted(false);
      return;
    }
    const id = window.setTimeout(() => setLifted(true), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const file = GIFT_FILES[tone];
  const height = Math.round((width * file.height) / file.width);

  return (
    <span className="gift-sprite" style={{ width, height }}>
      <img
        src={asset(`present-${tone}-body-pixel.png?v=seat`)}
        alt=""
        width={file.width}
        height={file.height}
        draggable={false}
        className="pixel-art"
      />
      <span className={lifted ? "gift-lid is-open" : "gift-lid"}>
        <img
          src={asset(`present-${tone}-lid-pixel.png?v=seat`)}
          alt=""
          width={file.width}
          height={file.height}
          draggable={false}
          className="pixel-art"
        />
      </span>
      {lifted
        ? CONFETTI.map((bit) => (
            <span
              key={`${bit.left}-${bit.top}`}
              className="gift-pop-bit"
              style={{
                left: bit.left,
                top: bit.top,
                background: bit.color,
                animationDelay: bit.delay,
                "--dx": bit.dx,
                "--dy": bit.dy,
                "--rot": bit.rot,
              } as CSSProperties}
            />
          ))
        : null}
    </span>
  );
}

const STAGE_WIDTH = "42rem";

function useVisualViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const viewport = window.visualViewport;
      root.style.height = `${viewport?.height ?? window.innerHeight}px`;
    };
    apply();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      root.style.height = "";
    };
  }, []);
}

function FittedPage({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, contentW: 0, contentH: 0, bandH: 0 });

  useVisualViewportHeight();

  useEffect(() => {
    const shell = shellRef.current;
    const content = contentRef.current;
    const band = bandRef.current;
    if (!shell || !content || !band) return;

    const measure = () => {
      const contentW = Math.round(content.offsetWidth);
      const contentH = Math.round(content.offsetHeight);
      const bandH = Math.round(band.offsetHeight);
      const shellW = shell.clientWidth;
      const shellH = shell.clientHeight;
      if (contentW <= 0 || contentH <= 0 || bandH <= 0 || shellW <= 0 || shellH <= 0) return;
      const scale = Math.round(Math.min(shellW / contentW, shellH / (contentH + bandH * 2)) * 1000) / 1000;
      setFit((current) => {
        if (
          Math.abs(current.scale - scale) < 0.004 &&
          current.contentW === contentW &&
          current.contentH === contentH &&
          current.bandH === bandH
        ) {
          return current;
        }
        return { scale, contentW, contentH, bandH };
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    observer.observe(content);
    observer.observe(band);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={shellRef} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <FittedBand scale={fit.scale} bandH={fit.bandH} measureRef={bandRef}>
        <KnitBand />
      </FittedBand>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="min-h-0 min-w-0 shrink-0"
          style={
            fit.contentW > 0
              ? { width: fit.contentW * fit.scale, height: fit.contentH * fit.scale }
              : undefined
          }
        >
          <div
            ref={contentRef}
            style={{
              width: STAGE_WIDTH,
              transform: `scale(${fit.scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
      <FittedBand scale={fit.scale} bandH={fit.bandH}>
        <KnitBand flip />
      </FittedBand>
    </div>
  );
}

function FittedBand({
  scale,
  bandH,
  measureRef,
  children,
}: {
  scale: number;
  bandH: number;
  measureRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const safeScale = scale > 0 ? scale : 1;
  return (
    <div
      className="shrink-0 overflow-hidden"
      style={bandH > 0 ? { height: bandH * safeScale } : undefined}
    >
      <div
        ref={measureRef}
        style={{
          width: `${100 / safeScale}%`,
          transform: `scale(${safeScale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const YOKE = ["heart", "flake", "heart", "flake", "heart", "flake", "heart"] as const;

function KnitBand({ flip = false }: { flip?: boolean }) {
  return (
    <div
      className={
        flip
          ? "sweater-yoke flex flex-col-reverse gap-2"
          : "sweater-yoke flex flex-col gap-2"
      }
      aria-hidden
    >
      <div className="dash-row !mb-0" />
      <div className="flex items-end justify-evenly px-2 py-2">
        {YOKE.map((kind, index) =>
          kind === "heart" ? (
            <PixelHeart key={`${kind}-${index}`} />
          ) : (
            <PixelFlake key={`${kind}-${index}`} scale={2} tone="navy" />
          ),
        )}
      </div>
      <div className="dash-row dash-row-offset !mb-0" />
    </div>
  );
}

function Sparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {SPARKS.map((spark) => (
        <span
          key={`${spark.top}-${spark.left}`}
          className={spark.gold ? "spark spark-gold" : "spark"}
          style={{
            top: spark.top,
            left: spark.left,
            width: spark.size,
            height: spark.size,
            animationDelay: spark.delay,
            animationDuration: spark.duration,
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
      <div className="flex items-baseline justify-between gap-3 bg-[#c7271a] px-7 py-4 text-[#f7f4f2]">
        <h2 className="text-2xl font-bold">참가자</h2>
        <p className="text-sm">{people.length}명</p>
      </div>
      <div className="px-7 py-6">
      <form onSubmit={onAdd} className="grid grid-cols-[0.8fr_1.2fr_auto] gap-3">
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
        <ul className="mt-5 max-h-80 divide-y divide-[#c5d3e0] overflow-y-auto">
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
