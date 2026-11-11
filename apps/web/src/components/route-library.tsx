"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { attachItemRoute, removeRouteAction, renameRoute } from "@/app/route-actions";

export type RouteUseView = { ref: string; title: string; day: string };
export type RouteView = {
  ref: string;
  name: string;
  icon: string;
  facts: string;
  ends?: string;
  url?: string;
  /** Punkty `points` (0–100) szkicu linii; brak = trasa bez linii. */
  sketch?: string;
  users: RouteUseView[];
  /** Punkty, do których można ją podpiąć (ten sam środek, jeszcze bez niej). */
  candidates: RouteUseView[];
};

/**
 * Jedna trasa na stronie „Trasy”: szkic linii, liczby, link do mapy, gdzie jest podpięta (przyciski do kart punktów),
 * a w trybie edycji nazwa, podpięcie do punktu i usunięcie nieużywanej.
 */
export function RouteCard({ tripId, route, editing }: { tripId: string; route: RouteView; editing: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const [name, setName] = useState(route.name);
  const [target, setTarget] = useState(route.candidates[0]?.ref ?? "");
  const run = (action: () => Promise<FormState>) =>
    start(async () => {
      setMessage({});
      setMessage(await action());
    });
  const itemHref = (ref: string) => `/trips/${tripId}/item/${encodeURIComponent(ref)}`;
  const detailsHref = `/trips/${tripId}/routes/${encodeURIComponent(route.ref)}`;

  return (
    <li id={`trasa-${route.ref}`} className="panel flex scroll-mt-4 flex-col gap-2 p-3 sm:flex-row">
      {route.sketch !== undefined && (
        <Link href={detailsHref} aria-label={`Szczegóły trasy ${route.name}`} className="shrink-0 self-start">
          <svg viewBox="-4 -4 108 108" className="size-24 rounded bg-zinc-50 dark:bg-zinc-900" role="img" aria-label={`Szkic trasy ${route.name}`}>
            <polyline points={route.sketch} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" className="text-teal-700 dark:text-teal-400" />
          </svg>
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => renameRoute(tripId, route.ref, name));
            }}>
            <span aria-hidden="true">{route.icon}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} aria-label="Nazwa trasy" className="field min-w-0 flex-1 px-2 py-1 text-sm" />
            {name.trim() !== route.name && (
              <button type="submit" disabled={pending} className="btn-primary btn-sm">
                Zapisz
              </button>
            )}
          </form>
        ) : (
          <p className="font-semibold">
            <span aria-hidden="true">{route.icon}</span> {route.name}
          </p>
        )}
        <p>
          <Link href={detailsHref} className="btn-mini">
            mapa, profil{editing ? " i edycja" : " i szczegóły"}
          </Link>
        </p>
        {(route.facts || route.ends) && <p className="text-zinc-600 dark:text-zinc-400">{[route.ends, route.facts].filter(Boolean).join(" · ")}</p>}
        {route.url && (
          <p>
            <a href={route.url} target="_blank" rel="noreferrer" className="underline">
              trasa na mapie
            </a>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-zinc-500">{route.users.length > 0 ? "Podpięta do:" : "Nie jest podpięta do żadnego punktu."}</span>
          {route.users.map((user) => (
            <Link key={user.ref} href={itemHref(user.ref)} className="btn-mini">
              {user.day} · {user.title}
            </Link>
          ))}
        </div>
        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            {route.candidates.length > 0 && (
              <>
                <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={pending} aria-label="Punkt, do którego podpiąć trasę" className="field max-w-full px-2 py-1 text-sm">
                  {route.candidates.map((candidate) => (
                    <option key={candidate.ref} value={candidate.ref}>
                      {candidate.day} · {candidate.title}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => run(() => attachItemRoute(tripId, target, route.ref))} disabled={pending || target === ""} className="btn-secondary btn-sm">
                  Podepnij do punktu
                </button>
              </>
            )}
            {route.users.length === 0 && (
              <button type="button" onClick={() => run(() => removeRouteAction(tripId, route.ref))} disabled={pending} className="btn-mini btn-mini-danger">
                usuń trasę
              </button>
            )}
          </div>
        )}
        {message.error && <p className="text-sm msg-error">{message.error}</p>}
        {message.ok && <p className="text-sm msg-ok">{message.ok}</p>}
      </div>
    </li>
  );
}
