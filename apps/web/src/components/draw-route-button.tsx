"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { drawRouteLine } from "@/app/route-actions";

/** „Wyznacz przebieg po drogach” na stronie trasy autem (OpenRouteService z końców i punktów pośrednich linku). */
export function DrawRouteButton({ tripId, trackRef, hasLine }: { tripId: string; trackRef: string; hasLine: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage({});
            setMessage(await drawRouteLine(tripId, trackRef));
          })
        }
        className="btn-secondary btn-sm self-start">
        {pending ? "Wyznaczam…" : hasLine ? "Wyznacz przebieg od nowa" : "Wyznacz przebieg po drogach"}
      </button>
      {message.error && <p className="text-sm msg-error">{message.error}</p>}
      {message.ok && <p className="text-sm msg-ok">{message.ok}</p>}
    </div>
  );
}
