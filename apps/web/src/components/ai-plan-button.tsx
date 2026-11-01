"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { planWithAi } from "@/app/actions";

/**
 * „Zaplanuj z AI”: uruchamia łańcuch na serwerze i po sukcesie otwiera plan nowego szkicu.
 * Licznik sekund, bo planowanie trwa zwykle 30–90 s.
 */
export function AiPlanButton({ tripId }: { tripId: string }) {
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
      const answer = await planWithAi(tripId);
      setResult(answer);
      if (answer.tripId) router.push(`/trips/${answer.tripId}/plan`);
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {pending ? `AI planuje… ${seconds} s` : "Zaplanuj z AI"}
        </button>
        <span className="text-xs text-zinc-500">
          {pending ? "Warianty, dni i punkty, potem miejsca z OpenStreetMap. Zwykle 30–90 s." : "Powstanie osobny szkic „Szkic AI: …” — ten plan zostaje nietknięty."}
        </span>
      </div>
      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
      {result?.ok && <p className="text-sm text-green-700 dark:text-green-400">{result.ok} Otwieram plan…</p>}
      <p className="text-xs text-zinc-400">Miejsca: © OpenStreetMap, Geoapify.</p>
    </div>
  );
}
