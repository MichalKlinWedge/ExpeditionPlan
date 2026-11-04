"use client";

import { useState, useTransition } from "react";

import { setTripPostponed } from "@/app/actions";

/**
 * Odłożenie wyjazdu i powrót do planów (organizator, edytor). Przywrócenie wyjazdu, którego termin
 * już minął, przenosi go do „Archiwum” — dat tu nie zmieniamy, więc najpierw pytamy.
 */
export function TripStatusButton({ tripId, postponed, termPassed }: { tripId: string; postponed: boolean; termPassed: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = () => {
    if (postponed && termPassed && !window.confirm("Termin tego wyjazdu już minął, więc po przywróceniu trafi do „Archiwum”. Przywrócić?")) return;
    start(async () => {
      const result = await setTripPostponed(tripId, !postponed);
      setError(result.error ?? null);
    });
  };
  return (
    <span className="flex items-center gap-2">
      <button disabled={pending} onClick={toggle} className="btn-secondary btn-sm">
        {pending ? "Zapisuję…" : postponed ? "Przywróć do planów" : "Odłóż wyjazd"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
