"use client";

import { localToday, taskUrgency } from "@expeditionplan/core";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { TripTaskDates } from "@/lib/task-alerts";
import { useHydrated } from "@/lib/use-hydrated";

/** Ile dni naprzód zadanie „zbliża się”. */
const SOON_DAYS = 30;

/**
 * Belka: otwarte zadania ze wszystkich moich zaplanowanych wyjazdów — po terminie (czerwone) i z terminem
 * w ciągu 30 dni. Kliknięcie rozwija wyjazdy z liczbami i przejściem do ich „Zadań”. Dzisiejsza data
 * z przeglądarki (serwer liczy w UTC), więc liczby pojawiają się po wczytaniu strony.
 */
export function TaskAlertsMenu({ trips }: { trips: TripTaskDates[] }) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  if (!hydrated) return null;

  const today = localToday();
  const rows = trips
    .map((trip) => {
      const urgency = trip.tasks.map((dates) => taskUrgency(dates, today, SOON_DAYS));
      return { ...trip, overdue: urgency.filter((each) => each === "overdue").length, soon: urgency.filter((each) => each === "soon").length };
    })
    .filter((trip) => trip.overdue + trip.soon > 0);
  const overdue = rows.reduce((sum, trip) => sum + trip.overdue, 0);
  const soon = rows.reduce((sum, trip) => sum + trip.soon, 0);
  if (rows.length === 0) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Otwarte zadania w zaplanowanych wyjazdach"
        className="flex items-center gap-1.5 rounded-lg border border-white/30 px-2 py-1 text-xs font-medium text-white hover:bg-white/10">
        {overdue > 0 && (
          <span className="rounded-full bg-red-600 px-2 py-0.5" title="Zadania po terminie">
            {overdue} po terminie
          </span>
        )}
        {soon > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-ink" title={`Zadania z terminem w ciągu ${SOON_DAYS} dni`}>
            {soon} w {SOON_DAYS} dni
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 flex w-72 flex-col gap-2 p-3 text-sm text-ink dark:text-zinc-100">
          <p className="text-xs text-zinc-500">Otwarte zadania w zaplanowanych wyjazdach</p>
          <ul className="flex flex-col gap-1.5">
            {rows.map((trip) => (
              <li key={trip.tripId} className="flex flex-col gap-1">
                <Link href={`/trips/${trip.tripId}/tasks`} onClick={() => setOpen(false)} className="btn-mini self-start">
                  {trip.title}
                </Link>
                <span className="text-xs">
                  {trip.overdue > 0 && <span className="text-red-700 dark:text-red-400">po terminie: {trip.overdue}</span>}
                  {trip.overdue > 0 && trip.soon > 0 && " · "}
                  {trip.soon > 0 && <span className="text-zinc-600 dark:text-zinc-400">w {SOON_DAYS} dni: {trip.soon}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
