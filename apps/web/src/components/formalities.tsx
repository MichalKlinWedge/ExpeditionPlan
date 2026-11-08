"use client";

import { FORMALITIES, type FormalityKey } from "@expeditionplan/core";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addFormalityTasks } from "@/app/formality-actions";

/**
 * „Formalności” na stronie uczestników: zaznaczone pozycje stają się zadaniami wyjazdu z linkiem do usługi
 * na gov.pl i terminem przed wyjazdem. Już dodane są odhaczone; prawo jazdy domyślnie, gdy ktoś jest kierowcą.
 */
export function Formalities({ tripId, present, drivers }: { tripId: string; present: FormalityKey[]; drivers: boolean }) {
  const [chosen, setChosen] = useState<Set<FormalityKey>>(() => new Set(FORMALITIES.filter((each) => !present.includes(each.key) && (each.key !== "driving_permit" || drivers)).map((each) => each.key)));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const toggle = (key: FormalityKey) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const missing = FORMALITIES.filter((each) => !present.includes(each.key));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-col gap-1.5">
        {FORMALITIES.map((formality) => {
          const done = present.includes(formality.key);
          return (
            <li key={formality.key} className="flex flex-col">
              <label className="flex items-baseline gap-2">
                <input type="checkbox" disabled={done || pending} checked={done || chosen.has(formality.key)} onChange={() => toggle(formality.key)} />
                <span>
                  <span className="font-medium">{formality.title}</span>
                  {done && <span className="text-xs text-emerald-700 dark:text-emerald-400"> · ✓ jest w zadaniach</span>}
                  {formality.url && (
                    <>
                      {" "}
                      <a href={formality.url} target="_blank" rel="noreferrer" className="text-xs underline">
                        gov.pl
                      </a>
                    </>
                  )}
                </span>
              </label>
              <span className="ml-6 text-xs text-zinc-500">{formality.when}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {missing.length > 0 && (
          <button type="button" disabled={pending || ![...chosen].some((key) => !present.includes(key))} onClick={() => start(async () => setState(await addFormalityTasks(tripId, [...chosen])))} className="btn-secondary btn-sm">
            {pending ? "Dodaję…" : "Dodaj do zadań"}
          </button>
        )}
        <Link href={`/trips/${tripId}/tasks`} className="btn-mini">
          Zadania
        </Link>
        {state.ok && <span className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </div>
  );
}
