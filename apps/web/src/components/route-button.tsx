"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { routeTrip } from "@/app/actions";

/**
 * „Przelicz przejazdy”: trasy OpenRouteService dla przejazdów planu (serwer, do ~1,6 s na trasę).
 * Po sukcesie odświeża stronę — widok planu dostaje nową wersję danych i liczy dzień od nowa.
 */
export function RouteButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const run = () => {
    setResult(null);
    setSeconds(0);
    start(async () => {
      const answer = await routeTrip(tripId);
      setResult(answer);
      if (answer.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={pending} className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-50 dark:border-zinc-700">
          {pending ? `Liczę trasy… ${seconds} s` : "Przelicz przejazdy (trasy z mapy)"}
        </button>
        <span className="text-xs text-zinc-500">Trasy: © openrouteservice.org, dane © OpenStreetMap</span>
      </div>
      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result?.ok && <p className="text-green-700 dark:text-green-400">{result.ok}</p>}
    </div>
  );
}
