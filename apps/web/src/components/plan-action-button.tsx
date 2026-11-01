"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";

/**
 * Narzędzie planu jako przycisk („Uzupełnij współrzędne”, „Przelicz przejazdy”): akcja serwera
 * z licznikiem sekund (usługi mają limity zapytań na sekundę), wynik pod przyciskiem. Po sukcesie
 * odświeża stronę — widok planu dostaje nową wersję danych i liczy dzień od nowa.
 */
export function PlanActionButton({ run, label, note }: { run: () => Promise<FormState>; label: string; note: string }) {
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
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={click} disabled={pending} className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-50 dark:border-zinc-700">
          {pending ? `${label}… ${seconds} s` : label}
        </button>
        <span className="text-xs text-zinc-500">{note}</span>
      </div>
      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result?.ok && <p className="text-green-700 dark:text-green-400">{result.ok}</p>}
    </div>
  );
}
