"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { saveCarRoutes } from "@/app/route-actions";

export type UnsavedCarRoute = { ref: string; title: string; day: string; facts: string };

/**
 * „Przejazdy autem z planu”: przejazdy z przebiegiem (linia, „Jedź przez”, własny link), których nie ma jeszcze
 * w „Trasach” — zapis pojedynczo albo wszystkich naraz. Po zapisie przejazd wskazuje trasę, a ona zostaje po usunięciu punktu.
 */
export function UnsavedCarRoutes({ tripId, routes, editing }: { tripId: string; routes: UnsavedCarRoute[]; editing: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const run = (refs: string[]) =>
    start(async () => {
      setMessage({});
      setMessage(await saveCarRoutes(tripId, refs));
    });

  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="card-title">🚗 Przejazdy autem z planu, jeszcze nie w „Trasach”</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        {editing ? "Zapisz je, żeby zostały po usunięciu punktu i dało się je podpiąć gdzie indziej." : "Włącz „Edytuj”, żeby zapisać je w „Trasach”."}
      </p>
      <ul className="flex flex-col gap-1">
        {routes.map((route) => (
          <li key={route.ref} className="flex flex-wrap items-center gap-2">
            <Link href={`/trips/${tripId}/item/${encodeURIComponent(route.ref)}`} className="btn-mini">
              {route.day} · {route.title}
            </Link>
            {route.facts && <span className="text-zinc-500">{route.facts}</span>}
            {editing && (
              <button type="button" onClick={() => run([route.ref])} disabled={pending} className="btn-mini">
                zapisz
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && routes.length > 1 && (
        <button type="button" onClick={() => run(routes.map((route) => route.ref))} disabled={pending} className="btn-secondary btn-sm self-start">
          Zapisz wszystkie ({routes.length})
        </button>
      )}
      {message.error && <p className="msg-error">{message.error}</p>}
      {message.ok && <p className="msg-ok">{message.ok}</p>}
    </section>
  );
}
