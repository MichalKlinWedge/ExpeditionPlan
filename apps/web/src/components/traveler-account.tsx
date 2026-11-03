"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { linkTravelerAccount } from "@/app/share-actions";

/** Który uczestnik planu to to konto — wybór zapisuje się od razu (jedno konto = jeden uczestnik). */
export function TravelerAccount({ tripId, userId, travelers, current }: { tripId: string; userId: string; travelers: { id: string; name: string }[]; current: string | null }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-0.5">
      <select
        value={current ?? ""}
        disabled={pending}
        onChange={(event) => start(async () => setState(await linkTravelerAccount(tripId, event.target.value || (current ?? ""), event.target.value ? userId : null)))}
        aria-label="Uczestnik planu"
        className="field px-1.5 py-0.5 text-sm">
        <option value="">— nie przypisano —</option>
        {travelers.map((each) => (
          <option key={each.id} value={each.id}>
            {each.name}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}
