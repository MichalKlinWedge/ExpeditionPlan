"use client";

import { PLANNER_STATUS_LABEL, type PlannerTaskStatus, shortDate } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { sendTasksToPlanner } from "@/app/taskplanner-actions";

export type PlannerRow = {
  ref: string;
  title: string;
  status: "open" | "done" | "dropped";
  export?: { tpUrl: string | null; tpStatus: PlannerTaskStatus | null; tpDeleted: boolean; sentAt: string };
};

const EP_STATUS: Record<PlannerRow["status"], string | undefined> = { open: undefined, done: "zrobione", dropped: "odrzucone" };

/**
 * Wysyłka zadań do Task Plannera (`docs/INTEGRACJA_TP.md`) na stronie zadań — nie zmienia planu, więc bez „Edytuj”.
 * Domyślnie zaznaczone otwarte bez osoby albo moje, jeszcze niewysłane. Zamknięcie w TP wraca tu przez webhook.
 */
export function TaskPlannerSend({ tripId, rows, suggested }: { tripId: string; rows: PlannerRow[]; suggested: string[] }) {
  const sent = rows.filter((row) => row.export !== undefined);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(suggested.filter((ref) => !sent.some((row) => row.ref === ref))));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const toggle = (ref: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  const send = (refs: string[]) =>
    start(async () => {
      const result = await sendTasksToPlanner(tripId, refs);
      setState(result);
      if (result.error === undefined) setChosen(new Set());
    });

  return (
    <details className="card p-4 text-sm" data-remember="task-planner">
      <summary className="card-title cursor-pointer">
        Task Planner <span className="font-normal text-zinc-500">· wysłane {sent.length} z {rows.length}</span>
      </summary>
      <p className="mb-2 text-xs text-zinc-500">
        Zaznaczone zadania trafiają do Task Plannera z terminem przeliczonym na datę. Zamknięte albo otwarte ponownie w TP zmienia się tu samo; zmiany w EP wysyłasz przyciskiem „Zaktualizuj wysłane”.
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.ref} id={`zadanie-${row.ref}`} className="flex flex-wrap items-baseline gap-x-2">
            <label className="flex items-baseline gap-2">
              <input type="checkbox" disabled={pending} checked={chosen.has(row.ref)} onChange={() => toggle(row.ref)} />
              <span className={row.status === "open" ? "" : "text-zinc-500 line-through"}>{row.title}</span>
            </label>
            {EP_STATUS[row.status] && <span className="text-xs text-zinc-500">{EP_STATUS[row.status]}</span>}
            {row.export && (
              <span className="text-xs text-zinc-500">
                · {row.export.tpDeleted ? "w koszu TP" : `w TP: ${row.export.tpStatus ? PLANNER_STATUS_LABEL[row.export.tpStatus] : "wysłane"}`} ({shortDate(row.export.sentAt.slice(0, 10))})
                {row.export.tpUrl && (
                  <>
                    {" "}
                    <a href={row.export.tpUrl} target="_blank" rel="noreferrer" className="underline">
                      otwórz w TP
                    </a>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || chosen.size === 0} onClick={() => send([...chosen])} className="btn-primary btn-sm">
          {pending ? "Wysyłam…" : `Wyślij zaznaczone (${chosen.size})`}
        </button>
        {sent.length > 0 && (
          <button type="button" disabled={pending} onClick={() => send(sent.map((row) => row.ref))} className="btn-secondary btn-sm">
            Zaktualizuj wysłane
          </button>
        )}
        {state.ok && <span className="text-xs msg-ok">{state.ok}</span>}
        {state.error && <span className="text-xs msg-error">{state.error}</span>}
      </div>
    </details>
  );
}
