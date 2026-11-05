"use client";

import type { SharedPlace } from "@expeditionplan/core";
import Link from "next/link";
import { useState } from "react";

/** Lista miejsc ze wszystkich wyjazdów z wyszukiwaniem. Przy każdym wyjeździe widać, czy miejsce ma tam opis. */
export function AllPlacesView({ places }: { places: SharedPlace[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = places.filter((place) => needle === "" || `${place.name} ${place.address ?? ""} ${place.trips.map((trip) => trip.tripTitle).join(" ")}`.toLowerCase().includes(needle));

  return (
    <>
      <div className="flex flex-col gap-1">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Szukaj miejsca" placeholder="Szukaj po nazwie, adresie albo wyjeździe" className="field px-2 py-1 text-sm" />
        <p className="text-xs text-zinc-500">
          Miejsc: {shown.length}
          {shown.length !== places.length && ` z ${places.length}`}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">Nic nie pasuje do wyszukiwania.</p>
      ) : (
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {shown.map((place) => (
            <li key={`${place.trips[0]!.tripId}:${place.trips[0]!.ref}`} className="flex flex-col gap-1.5 p-3">
              <span className="font-medium">{place.name}</span>
              {place.address !== undefined && <span className="text-sm text-zinc-500">{place.address}</span>}
              <span className="flex flex-wrap gap-1.5">
                {place.trips.map((trip) => (
                  <Link key={`${trip.tripId}:${trip.ref}`} href={`/trips/${trip.tripId}/places?miejsce=${encodeURIComponent(trip.ref)}`} className="chip hover:text-sea">
                    {trip.tripTitle}
                    {trip.guide ? " · 📖 opis" : ""}
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
