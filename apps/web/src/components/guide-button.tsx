"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { describeItem, describePlaceGuide, removeGuide } from "@/app/guide-actions";
import { SparkIcon } from "@/components/icons";

/**
 * Opis miejsca na stronie „Miejsca”: nowy albo odświeżony; `guideId` to własny opis miejsca, nie opis punktu.
 * Pole „O które dokładnie miejsce chodzi” rozstrzyga, gdy wiele miejsc nosi tę samą nazwę.
 */
export function PlaceGuideButtons({ tripId, placeRef, guideId, label, which: saved = "" }: { tripId: string; placeRef: string; guideId: string | null; label: string; which?: string | undefined }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [which, setWhich] = useState(saved);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        O które dokładnie miejsce chodzi (opcjonalnie, gdy wiele nosi tę nazwę)
        <input value={which} onChange={(event) => setWhich(event.target.value)} maxLength={200} disabled={pending} placeholder="np. wieś w powiecie trzebnickim" className="field w-full px-2 py-1 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => start(async () => setState(await describePlaceGuide(tripId, placeRef, which)))} className={guideId ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
          <SparkIcon className="size-4" />
          {pending ? "Szukam artykułu i piszę… (ok. 10–30 s)" : label}
        </button>
        {guideId && (
          <button
            disabled={pending}
            onClick={() => window.confirm("Usunąć opis tego miejsca?") && start(async () => setState(await removeGuide(tripId, guideId)))}
            className="text-xs underline disabled:opacity-50">
            usuń opis
          </button>
        )}
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700 dark:text-green-400">{state.ok}</p>}
    </div>
  );
}

/**
 * „Przygotuj opis z Wikipedii” / „Odśwież” i „Usuń opis” — akcje serwera z wynikiem pod spodem.
 * Pole „O czym ma być opis” naprowadza AI (wybór artykułu i treść), np. przejazd A7 → opłaty i bramki.
 */
export function GuideButtons({ tripId, itemRef, guideId, hint: saved = "" }: { tripId: string; itemRef: string; guideId: string | null; hint?: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [hint, setHint] = useState(saved);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        O czym ma być opis (opcjonalnie — podpowiedź dla AI)
        <textarea
          value={hint}
          onChange={(event) => setHint(event.target.value)}
          maxLength={300}
          rows={2}
          disabled={pending}
          placeholder="np. opłaty na autostradzie A7: bramki, ile kosztuje, czym płacić"
          className="w-full field max-w-xl px-2 py-1 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => start(async () => setState(await describeItem(tripId, itemRef, hint)))} className={guideId ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
          <SparkIcon className="size-4" />
          {pending ? "Szukam artykułu i piszę… (ok. 10–30 s)" : guideId ? "Odśwież opis" : "Przygotuj opis z Wikipedii (AI)"}
        </button>
        {guideId && (
          <button
            disabled={pending}
            onClick={() => window.confirm("Usunąć opis tego miejsca?") && start(async () => setState(await removeGuide(tripId, guideId)))}
            className="text-xs underline disabled:opacity-50">
            usuń opis
          </button>
        )}
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700 dark:text-green-400">{state.ok}</p>}
    </div>
  );
}
