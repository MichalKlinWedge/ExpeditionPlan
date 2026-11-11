"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";

import { planWithAi } from "@/app/actions";
import { SparkIcon } from "@/components/icons";

/**
 * „Zaplanuj z AI”: uruchamia łańcuch na serwerze i po sukcesie otwiera szkic obok tego planu (porównanie) — plan zostaje bez zmian.
 * Licznik sekund, bo planowanie trwa zwykle 30–90 s.
 */
export function AiPlanButton({ tripId, children }: { tripId: string; children?: ReactNode }) {
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
      // Zostajemy przy tym planie: szkic otwiera się obok niego na porównaniu, skąd przenosi się punkty.
      if (answer.tripId) router.push(`/trips/${tripId}/compare?draft=${answer.tripId}`);
    });
  };

  return (
    <div className="flex flex-col gap-2 card p-4">
      <h2 className="card-title">Plan z AI</h2>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={pending}
          className="btn-primary">
          <SparkIcon className="size-4" />
          {pending ? `AI planuje… ${seconds} s` : "Zaplanuj z AI"}
        </button>
        <span className="text-xs text-zinc-500">
          {pending ? "Warianty, dni i punkty, potem miejsca z OpenStreetMap. Zwykle 30–90 s." : "Powstanie osobny szkic „Szkic AI: …” — ten plan zostaje nietknięty."}
        </span>
      </div>
      {result?.error && <p className="text-sm msg-error">{result.error}</p>}
      {result?.ok && <p className="text-sm msg-ok">{result.ok} Otwieram szkic obok Twojego planu…</p>}
      {children}
      <p className="text-xs text-zinc-400">Miejsca: © OpenStreetMap, Geoapify.</p>
    </div>
  );
}
