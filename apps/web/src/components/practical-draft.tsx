"use client";

import { useState } from "react";

import { draftPractical } from "@/app/practical-actions";
import { PlanActionButton } from "@/components/plan-action-button";

/** Jak `PRACTICAL_FOCUS_MAX` w `planner/src/practical.ts` (serwer i tak przycina); bez importu planera do przeglądarki. */
const FOCUS_MAX = 500;

/**
 * „Przygotuj z AI” w Informacjach praktycznych z polem, w którym organizator opisuje, czego potrzebuje
 * (np. „jedziemy z niemowlęciem”, „głównie wjazd autem i opłaty drogowe”). Pole jest opcjonalne;
 * ostatni opis wraca w polu przy kolejnym szkicu.
 */
export function PracticalDraftButton({ tripId, label, note, saved = "" }: { tripId: string; label: string; note: string; saved?: string }) {
  const [focus, setFocus] = useState(saved);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Czego potrzebujesz (opcjonalnie — podpowiedź dla AI)
        <textarea
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          maxLength={FOCUS_MAX}
          rows={3}
          placeholder="np. jedziemy z 2-latkiem: zdrowie, apteki, jedzenie dla dziecka; wynajem auta i przejście graniczne"
          className="field w-full max-w-2xl px-2 py-1 text-sm"
        />
      </label>
      <PlanActionButton ai run={() => draftPractical(tripId, focus)} label={label} note={note} />
    </div>
  );
}
