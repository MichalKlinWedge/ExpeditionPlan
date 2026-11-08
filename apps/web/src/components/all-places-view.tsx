"use client";

import { memoriesOf, memorySummary, PLACE_VERDICT, type PlaceMemoryRow, type PlaceMemorySummary, type PlaceVerdict, placeVisitYears, type SharedPlace, verdictLabel, visitLabel } from "@expeditionplan/core";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { savePlaceMemory } from "@/app/place-memory-actions";
import { IconAction } from "@/components/icon-action";

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
 * przy miejscu pamięć: lata wizyt (z dat wyjazdów), oceny uczestników i notatki na przyszłość.
 */
export function AllPlacesView({ places, memories, me, today }: { places: SharedPlace[]; memories: PlaceMemoryRow[]; me: string; today: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo<Row[]>(() => places.map((place) => ({ place, summary: memorySummary(memoriesOf(place, memories), me), years: placeVisitYears(place, today) })), [places, memories, me, today]);
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
              <PlaceMemory placeId={place.placeId} summary={summary} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const ICON: Record<PlaceVerdict, string> = { worth: "👍", not_worth: "👎" };

/** Oceny i notatki uczestników oraz moje: „warto” / „nie warto” (drugi klik cofa) i notatka. */
function PlaceMemory({ placeId, summary }: { placeId: string; summary: PlaceMemorySummary }) {
  const mine = summary.mine;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(mine?.note ?? "");
  const [message, setMessage] = useState<FormState>({});
  const [pending, start] = useTransition();
  const save = (verdict: PlaceVerdict | null, text: string, after?: () => void) =>
    start(async () => {
      const result = await savePlaceMemory(placeId, verdict, text);
      setMessage(result.error ? result : {});
      if (!result.error) after?.();
    });
  const others = summary.entries.filter((entry) => !entry.mine);
  const total = verdictLabel(summary);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["worth", "not_worth"] as const).map((verdict) => {
          const active = mine?.verdict === verdict;
          return (
            <button
              key={verdict}
              type="button"
              disabled={pending}
              aria-pressed={active}
              title={active ? "Cofnij moją ocenę" : `Moja ocena: ${PLACE_VERDICT[verdict]}`}
              onClick={() => save(active ? null : verdict, mine?.note ?? "")}
              className={`btn-mini ${active ? (verdict === "worth" ? "bg-emerald-600! text-white!" : "bg-red-600! text-white!") : ""}`}
            >
              {ICON[verdict]} {PLACE_VERDICT[verdict]}
            </button>
          );
        })}
        {!editing && (
          <IconAction
            kind="edit"
            tip={mine?.note ? "zmień moją notatkę" : "dodaj notatkę na przyszłość"}
            disabled={pending}
            onClick={() => {
              setNote(mine?.note ?? "");
              setEditing(true);
            }}
          />
        )}
        {total !== undefined && <span className="text-xs text-zinc-500">{total}</span>}
      </div>
      {editing ? (
        <div className="flex flex-col gap-1">
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} aria-label="Notatka na przyszłość" placeholder="Np. „rano tłumy, wejść przed 8:00”, „parking tylko za gotówkę”" className="field px-2 py-1 text-sm" />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={pending} onClick={() => save(mine?.verdict ?? null, note, () => setEditing(false))} className="btn-mini">
              zapisz
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        mine?.note && (
          <p className="text-zinc-700 dark:text-zinc-300">
            <span className="text-xs text-zinc-500">Ty: </span>
            {mine.note}
          </p>
        )
      )}
      {others.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {others.map((entry) => (
            <li key={entry.userId} className="text-zinc-700 dark:text-zinc-300">
              <span className="font-medium">{entry.author}</span>
              {entry.verdict && (
                <span className={entry.verdict === "worth" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                  {" "}
                  {ICON[entry.verdict]} {PLACE_VERDICT[entry.verdict]}
                </span>
              )}
              {entry.note && <span>: {entry.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {message.error && <p className="text-xs text-red-600">{message.error}</p>}
    </div>
  );
}
