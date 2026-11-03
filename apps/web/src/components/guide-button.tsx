"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { describeItem, removeGuide } from "@/app/guide-actions";

/** „Przygotuj opis z Wikipedii” / „Odśwież” i „Usuń opis” — akcje serwera z wynikiem pod spodem. */
export function GuideButtons({ tripId, itemRef, guideId }: { tripId: string; itemRef: string; guideId: string | null }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => start(async () => setState(await describeItem(tripId, itemRef)))} className={guideId ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
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
