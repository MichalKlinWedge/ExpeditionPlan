"use client";

import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { acceptPatch, proposePatch, rejectPatch } from "@/app/tune-actions";
import { SparkIcon } from "@/components/icons";

/**
 * Czat dostrajający plan: rozmowa, polecenie, podgląd łatki (✓ wykona się, ✗ nie — z powodem)
 * i wpływ na dni (koniec dnia, zapas), potem „Zastosuj” albo „Odrzuć”.
 */

export type Turn = { role: string; content: string };
export type Preview = {
  runId: string;
  results: { ok: boolean; text: string }[];
  days: { date: string; before: string; after: string }[];
};

const EXAMPLES = ["Dzień 2 jest za męczący — wytnij coś mniej ważnego", "Dodaj obiad w okolicy placu ok. 13:00", "Dzień 3: plan B na deszcz"];

export function TuneChat({ tripId, turns, preview }: { tripId: string; turns: Turn[]; preview: Preview | null }) {
  const [state, action, pending] = useActionState(proposePatch.bind(null, tripId), {});
  const [command, setCommand] = useState("");
  const [decision, setDecision] = useState<FormState>({});
  const [deciding, start] = useTransition();
  return (
    <div className="flex flex-col gap-4 text-sm">
      {turns.length > 0 && (
        <ol className="flex flex-col gap-2">
          {turns.map((turn, i) => (
            <li key={i} className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-line ${turn.role === "user" ? "self-end bg-ink text-white dark:bg-sea" : "self-start bg-zinc-100 dark:bg-zinc-900"}`}>
              {turn.content}
            </li>
          ))}
        </ol>
      )}

      {preview && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-200 p-3 dark:border-blue-900">
          <p className="text-xs text-zinc-500">Proponowane zmiany — jeszcze nie w planie:</p>
          <ul className="flex flex-col gap-1">
            {preview.results.map((result, i) => (
              <li key={i} className={result.ok ? "" : "text-zinc-500 line-through decoration-zinc-400"}>
                {result.ok ? "✓ " : "✗ "}
                {result.text}
              </li>
            ))}
          </ul>
          {preview.days.length > 0 && (
            <table className="text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pr-4 text-left font-normal">Dzień</th>
                  <th className="pr-4 text-left font-normal">Teraz</th>
                  <th className="text-left font-normal">Po zmianie</th>
                </tr>
              </thead>
              <tbody>
                {preview.days.map((day) => (
                  <tr key={day.date}>
                    <td className="pr-4">{day.date}</td>
                    <td className="pr-4">{day.before}</td>
                    <td>{day.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={deciding || !preview.results.some((result) => result.ok)}
              onClick={() => start(async () => setDecision(await acceptPatch(tripId, preview.runId)))}
              className="btn-primary">
              {deciding ? "Zapisuję…" : "Zastosuj"}
            </button>
            <button disabled={deciding} onClick={() => start(async () => setDecision(await rejectPatch(tripId, preview.runId)))} className="underline disabled:opacity-50">
              Odrzuć
            </button>
          </div>
        </div>
      )}
      {decision.error && <p className="text-red-600">{decision.error}</p>}
      {decision.ok && <p className="text-green-700 dark:text-green-400">{decision.ok}</p>}

      <form action={action} className="flex flex-col gap-2">
        <textarea
          name="command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={2}
          placeholder="Co zmienić w planie? Np. „dzień 3 za długi, przesuń coś na dzień 4”"
          className="field px-3 py-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending || command.trim() === ""} className="btn-primary">
            <SparkIcon className="size-4" />
            {pending ? "AI myśli…" : "Zaproponuj zmiany"}
          </button>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setCommand(example)} className="rounded-full border border-sea/40 px-2.5 py-0.5 text-xs font-medium text-sea hover:bg-sea-light dark:text-teal-300 dark:hover:bg-sea/20">
              {example}
            </button>
          ))}
        </div>
        {state.error && <p className="text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}
