"use client";

import { memoriesOf, memorySummary, type PlaceMemoryRow, type PlaceMemorySummary, placeVisitYears, type SharedPlace, type VisitedPlaceRow, visitLabel } from "@expeditionplan/core";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PlaceMemory } from "@/components/place-memory";

type Filter = "all" | "rated" | "worth" | "not_worth" | "visited";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "wszystkie" },
  { value: "visited", label: "odwiedzone" },
  { value: "rated", label: "z oceną albo notatką" },
  { value: "worth", label: "warto" },
  { value: "not_worth", label: "nie warto" },
];

type Row = { place: SharedPlace; summary: PlaceMemorySummary; years: number[] };

/**
 * Lista miejsc ze wszystkich wyjazdów z wyszukiwaniem. Przy każdym wyjeździe widać, czy miejsce ma tam opis;
 * przy miejscu pamięć: lata wizyt (z minionych punktów planu), oceny uczestników i notatki na przyszłość.
 */
export function AllPlacesView({ places, memories, me, visited }: { places: SharedPlace[]; memories: PlaceMemoryRow[]; me: string; visited: VisitedPlaceRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo<Row[]>(() => places.map((place) => ({ place, summary: memorySummary(memoriesOf(place, memories), me), years: placeVisitYears(place, visited) })), [places, memories, me, visited]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(({ place, summary, years }) => {
    if (filter === "visited" && years.length === 0) return false;
    if (filter === "rated" && summary.entries.length === 0) return false;
    if ((filter === "worth" || filter === "not_worth") && summary.verdict !== filter) return false;
    const notes = summary.entries.map((entry) => entry.note ?? "").join(" ");
    return needle === "" || `${place.name} ${place.address ?? ""} ${place.trips.map((trip) => trip.tripTitle).join(" ")} ${notes}`.toLowerCase().includes(needle);
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-2">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Szukaj miejsca" placeholder="Szukaj po nazwie, adresie, wyjeździe albo notatce" className="field min-w-0 flex-1 px-2 py-1 text-sm" />
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Pokaż" className="field px-2 py-1 text-sm">
            {FILTERS.map((each) => (
              <option key={each.value} value={each.value}>
                {each.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-zinc-500">
          Miejsc: {shown.length}
          {shown.length !== places.length && ` z ${places.length}`}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">Nic nie pasuje do wyszukiwania.</p>
      ) : (
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {shown.map(({ place, summary, years }) => (
            <li key={`${place.trips[0]!.tripId}:${place.trips[0]!.ref}`} className="flex flex-col gap-1.5 p-3">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{place.name}</span>
                {years.length > 0 && <span className="text-xs text-zinc-500">{visitLabel(years)}</span>}
              </span>
              {place.address !== undefined && <span className="text-sm text-zinc-500">{place.address}</span>}
              <span className="flex flex-wrap gap-1.5">
                {place.trips.map((trip) => (
                  <Link key={`${trip.tripId}:${trip.ref}`} href={`/trips/${trip.tripId}/places?miejsce=${encodeURIComponent(trip.ref)}`} className="chip hover:text-sea">
                    {trip.tripTitle}
                    {trip.guide ? " · 📖 opis" : ""}
                  </Link>
                ))}
              </span>
              <PlaceMemory placeId={place.placeId} summary={summary} canRate={years.length > 0} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
