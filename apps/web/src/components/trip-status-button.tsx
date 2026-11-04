"use client";

import { useState, useTransition } from "react";

import { suggestNewStart } from "@expeditionplan/core";

import { setTripPostponed } from "@/app/actions";
import { RescheduleDialog } from "@/components/trip-reschedule";

/**
 * Odłożenie wyjazdu i powrót do planów (organizator, edytor). Przywrócenie wyjazdu, którego termin
 * już minął, trafiłoby do „Archiwum”, więc najpierw proponuje nową datę (`suggestNewStart`).
 */
export function TripStatusButton({ tripId, postponed, startDate, endDate, today, hasDrafts }: { tripId: string; postponed: boolean; startDate: string; endDate: string; today: string; hasDrafts: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const toggle = () => {
    if (postponed && endDate < today) return setChoosing(true);
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
      {choosing && <RescheduleDialog tripId={tripId} startDate={startDate} endDate={endDate} today={today} hasDrafts={hasDrafts} initial={suggestNewStart(startDate, today)} restore onClose={() => setChoosing(false)} />}
    </span>
  );
}
