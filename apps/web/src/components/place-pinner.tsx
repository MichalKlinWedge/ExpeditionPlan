"use client";

import { useState, useTransition } from "react";

import { type FormState, pinPlace, searchPlace } from "@/app/actions";

export type OffMapPlace = { id: string; name: string; searchName?: string; usedBy: string[] };

/**
 * Miejsca planu bez współrzędnych: wklej współrzędne / link z mapy albo szukaj pod inną nazwą
 * (np. tą z OpenStreetMap). Po zapisie strona się odświeża — miejsce znika z listy, a plan
 * ma je na mapie i może policzyć do niego trasę.
 */
export function PlacePinner({ tripId, places }: { tripId: string; places: OffMapPlace[] }) {
  // Wynik ostatniego zapisu nad listą — wiersz przypiętego miejsca znika po odświeżeniu, a trzeba
  // zobaczyć, co znalazło wyszukiwanie („→ Sidi Kaouki, Maroko”), żeby ocenić, czy to to miejsce.
  const [last, setLast] = useState<FormState>({});
  if (places.length === 0 && !last.ok) return null;
  return (
    <details className="rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-900">
      <summary className="cursor-pointer font-medium">Miejsca bez współrzędnych ({places.length}) — przypnij albo wyszukaj</summary>
      <p className="mt-2 text-xs text-zinc-500">
        Współrzędne: w Google Maps przytrzymaj miejsce i skopiuj liczby z dołu ekranu albo wklej pełny link; w OpenStreetMap — link z paska adresu.
      </p>
      {last.ok && <p className="mt-2 text-xs text-green-700 dark:text-green-400">{last.ok}</p>}
      <ul className="mt-3 flex flex-col gap-4">
        {places.map((place) => (
          <PlaceRow key={place.id} tripId={tripId} place={place} onSaved={setLast} />
        ))}
      </ul>
    </details>
  );
}

const input = "min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";
const button = "rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-50 dark:border-zinc-700";

function PlaceRow({ tripId, place, onSaved }: { tripId: string; place: OffMapPlace; onSaved: (result: FormState) => void }) {
  const [coords, setCoords] = useState("");
  const [query, setQuery] = useState(place.searchName ?? place.name);
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const run = (action: () => Promise<FormState>) =>
    start(async () => {
      const answer = await action();
      setResult(answer);
      if (answer.ok) onSaved(answer);
    });
  return (
    <li className="flex flex-col gap-2">
      <div>
        <span className="font-medium">{place.name}</span>
        <span className="text-xs text-zinc-500"> · {place.usedBy.slice(0, 2).join(", ")}{place.usedBy.length > 2 ? ` i ${place.usedBy.length - 2} więcej` : ""}</span>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); run(() => pinPlace(tripId, place.id, coords)); }}>
        <input value={coords} onChange={(event) => setCoords(event.target.value)} placeholder="31.6295, -7.9811 albo link z mapy" className={input} aria-label={`Współrzędne: ${place.name}`} />
        <button disabled={pending || coords.trim() === ""} className={button}>
          Przypnij
        </button>
      </form>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); run(() => searchPlace(tripId, place.id, query)); }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} className={input} aria-label={`Szukaj: ${place.name}`} />
        <button disabled={pending || query.trim() === ""} className={button}>
          {pending ? "Szukam…" : "Szukaj"}
        </button>
      </form>
      {result.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result.ok && <p className="text-xs text-green-700 dark:text-green-400">{result.ok}</p>}
    </li>
  );
}
