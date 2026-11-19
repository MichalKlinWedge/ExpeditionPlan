"use client";

import { dayChip, dayOrderNotes, type DayProgram, plural } from "@expeditionplan/core";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { saveDayOrder } from "@/app/day-order-actions";
import { DialogTitle } from "@/components/dialog-title";

/**
 * „Kolejność dni” w narzędziach planu: lista dni z krótkim opisem programu, ↑/↓ zamienia program z sąsiednim dniem.
 * Daty i noclegi stoją w miejscu, przesuwa się program (`reorderDays`); zapis dopiero po „Zapisz kolejność”.
 */
export function DayOrder({ tripId, programs }: { tripId: string; programs: DayProgram[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const initial = programs.map((day) => day.ref);
  const [order, setOrder] = useState<string[]>(initial);
  const [result, setResult] = useState<FormState | null>(null);
  const [pending, start] = useTransition();
  const byRef = new Map(programs.map((day) => [day.ref, day]));
  const moved = order.filter((ref, index) => ref !== initial[index]).length;
  const notes = dayOrderNotes(programs, order);

  const open = () => {
    setOrder(initial);
    setResult(null);
    dialog.current?.showModal();
  };
  const swap = (index: number, direction: -1 | 1) =>
    setOrder((now) => {
      const next = [...now];
      const other = index + direction;
      if (other < 0 || other >= next.length) return now;
      [next[index], next[other]] = [next[other]!, next[index]!];
      return next;
    });
  const save = () =>
    start(async () => {
      const answer = await saveDayOrder(tripId, initial, order);
      setResult(answer);
      if (answer.ok) {
        dialog.current?.close();
        router.refresh();
      }
    });

  if (programs.length < 2) return null;
  return (
    <div className="flex flex-col items-end gap-0.5 text-right text-sm">
      <button type="button" onClick={open} className="btn-secondary btn-sm">
        Kolejność dni
      </button>
      <span className="text-xs text-zinc-500">Zamiana programów całych dni</span>
      {result?.ok && <p className="msg-ok">{result.ok}</p>}

      <dialog ref={dialog} onClick={(event) => event.target === dialog.current && !pending && dialog.current.close()} aria-label="Kolejność dni" className="card dialog text-left">
        <div className="flex flex-col gap-3 text-sm">
          <DialogTitle onClose={() => dialog.current?.close()} disabled={pending}>
            <h2>Kolejność dni</h2>
            <p className="text-xs text-zinc-500">
              Daty i noclegi zostają na miejscu, ↑ / ↓ zamienia program dnia z sąsiednim: punkty, tytuł, wstęp, godziny dnia, warianty i zadania dnia.
            </p>
          </DialogTitle>

          <ol className="flex flex-col gap-2">
            {order.map((ref, index) => {
              const program = byRef.get(ref)!;
              const slot = programs[index]!;
              const shifted = program.date !== slot.date;
              return (
                <li key={ref} className={`${shifted ? "panel-ai" : "panel"} flex items-start gap-3 p-3`}>
                  <div className="w-24 shrink-0 text-xs text-zinc-500">
                    <p className="font-semibold text-zinc-700 dark:text-zinc-300">Dzień {index + 1}</p>
                    <p>{dayChip(slot.date)}</p>
                    {slot.lodging && <p title="Nocleg tej daty zostaje">🛏 {slot.lodging}</p>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="font-semibold">{program.title}</p>
                    {program.summary && <p className="text-zinc-600 dark:text-zinc-400">{program.summary}</p>}
                    <p className="text-xs text-zinc-500">
                      {plural(program.points, ["punkt", "punkty", "punktów"])}
                      {shifted ? ` · wcześniej ${dayChip(program.date)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => swap(index, -1)} disabled={pending || index === 0} className="btn-mini" aria-label={`Program „${program.title}” dzień wcześniej`}>
                      ↑
                    </button>
                    <button type="button" onClick={() => swap(index, 1)} disabled={pending || index === order.length - 1} className="btn-mini" aria-label={`Program „${program.title}” dzień później`}>
                      ↓
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {notes.length > 0 && (
            <div className="panel flex flex-col gap-1 p-3">
              <p className="font-semibold">Do sprawdzenia po zamianie</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={pending || moved === 0} className="btn-primary btn-sm">
              {pending ? "Zapisuję…" : "Zapisz kolejność"}
            </button>
            {moved > 0 && (
              <button type="button" onClick={() => setOrder(initial)} disabled={pending} className="btn-secondary btn-sm">
                Jak było
              </button>
            )}
            <button type="button" onClick={() => dialog.current?.close()} disabled={pending} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
          {result?.error && <p className="msg-error">{result.error}</p>}
        </div>
      </dialog>
    </div>
  );
}
