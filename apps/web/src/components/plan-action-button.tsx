"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { SparkIcon } from "@/components/icons";

/**
 * Narzędzie planu jako przycisk („Uzupełnij współrzędne”, „Przelicz przejazdy”): akcja serwera
 * z licznikiem sekund (usługi mają limity zapytań na sekundę), wynik pod przyciskiem. Po sukcesie
 * odświeża stronę — widok planu dostaje nową wersję danych i liczy dzień od nowa. `ai` = działanie AI, z ikoną.
 * `end` = w kolumnie przy prawej krawędzi (nagłówek planu): przycisk, a pod nim źródła i wynik, do prawej.
 */
export function PlanActionButton({ run, label, note, ai = false, end = false }: { run: () => Promise<FormState>; label: string; note: string; ai?: boolean; end?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<FormState | null>(null);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const click = () => {
    setResult(null);
    setSeconds(0);
    start(async () => {
      const answer = await run();
      setResult(answer);
      if (answer.ok) router.refresh();
    });
  };

  return (
    <div className={`flex flex-col gap-1 text-sm ${end ? "items-end text-right" : ""}`}>
      <div className={end ? "flex flex-col items-end gap-0.5" : "flex flex-wrap items-center gap-3"}>
        <button onClick={click} disabled={pending} className="btn-secondary btn-sm">
          {ai && <SparkIcon className="size-4" />}
          {pending ? `${label}… ${seconds} s` : label}
        </button>
        <span className="text-xs text-zinc-500">{note}</span>
      </div>
      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result?.ok && <p className="text-green-700 dark:text-green-400">{result.ok}</p>}
    </div>
  );
}
