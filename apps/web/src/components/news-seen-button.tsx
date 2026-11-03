"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { markTripNewsSeen } from "@/app/news-actions";

/** „Przejrzane” — chowa listę „Co nowego” (na webie i w telefonie). */
export function NewsSeenButton({ tripId }: { tripId: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      <button type="button" disabled={pending} onClick={() => start(async () => setState(await markTripNewsSeen(tripId)))} className="btn-secondary btn-sm">
        {pending ? "zapisuję…" : "Przejrzane"}
      </button>
    </span>
  );
}
