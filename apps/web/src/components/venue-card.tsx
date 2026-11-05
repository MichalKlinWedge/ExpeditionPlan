"use client";

import { eateryKindLabel, type TripDocument, type VenueDraft, type VenueDraftRow, venuePoints } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { clearVenue, readVenue, readVenueSite, saveVenue, type VenueReadState } from "@/app/venue-actions";
import { SparkIcon } from "@/components/icons";
import { VenueEntries } from "@/components/venue-entries";

/**
 * Dane knajpy pod mapą „Posiłków”: to, co dała wyszukiwarka (rodzaj, adres, godziny, strona, kuchnia), oraz punkty opisu, ocena i przykładowe
 * ceny (`VenueEntries`). Organizator i edytor wklejają tekst i wybierają, co dopisać. Opisu samego miejsca tu nie ma: jest w „Miejscach”.
 */

type Place = TripDocument["places"][number];

const shortDate = (date: string) => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function VenueCard({ tripId, place, isEatery, canEdit, editing }: { tripId: string; place: Place; isEatery: boolean; canEdit: boolean; editing: boolean }) {
  const { venue } = place;
  const facts = place.address || place.openingHours || place.website;
  const read = venuePoints(venue).length > 0 || venue?.rating !== undefined || (venue?.prices.length ?? 0) > 0;
  const kind = eateryKindLabel(place);
  if (!isEatery) {
    return (
      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-lg font-semibold">{place.name}</h2>
        <p className="text-zinc-500">{canEdit ? (editing ? "To miejsce nie jest wskazaną knajpą. Jeśli tu jecie na mieście, użyj „knajpy w pobliżu” przy posiłku." : "To miejsce nie jest wskazaną knajpą. Knajpę przypniesz po „Edytuj” przez „knajpy w pobliżu”.") : "To miejsce nie jest wskazaną knajpą."}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="text-lg font-semibold">
        {place.name}
        {kind && <span className="ml-2 text-sm font-normal text-zinc-500">{kind}</span>}
      </h2>
      <VenueEntries tripId={tripId} place={place} editing={canEdit && editing} />
      {facts && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {[place.address, place.openingHours].filter(Boolean).join(" · ")}
          {place.website && (
            <>
              {place.address || place.openingHours ? " · " : ""}
              <a href={place.website} target="_blank" rel="noreferrer" className="underline">
                strona lokalu
              </a>
            </>
          )}
        </p>
      )}
      {place.notes && <p className="text-xs text-zinc-600 dark:text-zinc-400">{place.notes}</p>}
      {venue?.readOn && <p className="text-xs text-zinc-500">Ostatni odczyt: {shortDate(venue.readOn)}. Ceny i ocena mogły się od tego czasu zmienić.</p>}
      {!read && <p className="text-sm text-zinc-500">Brak opisu, cen i oceny.{canEdit ? "" : " Organizator może je dodać."}</p>}
      {canEdit && <VenueEditor key={place.ref} tripId={tripId} place={place} canClear={read && editing} />}
    </section>
  );
}

function VenueEditor({ tripId, place, canClear }: { tripId: string; place: Place; canClear: boolean }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<FormState>({});
  const [draft, setDraft] = useState<{ draft: VenueDraft; rows: VenueDraftRow[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [reading, setReading] = useState<"text" | "site" | null>(null);
  const query = encodeURIComponent([place.name, place.address].filter(Boolean).join(" "));

  const read = (kind: "text" | "site", action: () => Promise<VenueReadState>) =>
    start(async () => {
      setReading(kind);
      const result = await action();
      setReading(null);
      setState(result);
      if (result.draft && result.rows) {
        setDraft({ draft: result.draft, rows: result.rows });
        setPicked(new Set(result.rows.filter((row) => row.current === undefined).map((row) => row.key)));
      } else setDraft(null);
    });

  const save = () =>
    start(async () => {
      const result = await saveVenue(tripId, place.ref, draft!.draft, [...picked]);
      setState(result);
      if (result.ok) {
        setDraft(null);
        setText("");
      }
    });

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      {place.website && (
        <div className="flex flex-col gap-1">
          <button type="button" disabled={pending} onClick={() => read("site", () => readVenueSite(tripId, place.ref))} className="btn-secondary btn-sm self-start">
            <SparkIcon className="size-4" />
            {reading === "site" ? "Czytam stronę… (ok. 10–30 s)" : "Odczytaj opis i menu ze strony lokalu (AI)"}
          </button>
          <p className="text-xs text-zinc-500">Pobiera raz stronę lokalu i jej menu. Oceny zwykle tam nie ma: tę wklej niżej.</p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Wklej tekst ze strony lokalu: opis, ocenę, menu z cenami
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={20_000} disabled={pending} placeholder="Zaznacz i skopiuj tekst, np. z Google Maps, TripAdvisora albo menu lokalu." className="field p-2 text-sm" />
      </label>
      <p className="text-xs text-zinc-500">
        Serwisy z ocenami nie pozwalają ich automatycznie pobierać i zapisywać, więc ocena pochodzi tylko z wklejonego tekstu.{" "}
        <a href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noreferrer" className="underline">
          Otwórz lokal w Google Maps
        </a>
        . AI przygotuje punkty, a Ty wybierzesz, które dopisać. To, co już jest zapisane, zostaje.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || text.trim() === ""} onClick={() => read("text", () => readVenue(tripId, place.ref, text))} className="btn-primary btn-sm">
          <SparkIcon className="size-4" />
          {reading === "text" ? "Czytam…" : "Odczytaj dane lokalu (AI)"}
        </button>
        {canClear && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm("Usunąć wszystkie punkty, ceny i ocenę tego lokalu?") && start(async () => setState(await clearVenue(tripId, place.ref)))}
            className="text-xs underline disabled:opacity-50">
            usuń wszystko
          </button>
        )}
      </div>

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-signal/60 p-3">
          <p className="font-medium">Co dopisać?</p>
          <ul className="flex flex-col gap-1.5">
            {draft.rows.map((row) => (
              <li key={row.key}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(row.key)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.key);
                        else next.delete(row.key);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="text-zinc-500">{row.label}:</span> {row.value}
                    {row.current && <span className="block text-xs text-amber-700 dark:text-amber-400">zastąpi zapisane: {row.current}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={pending || picked.size === 0} onClick={save} className="btn-primary btn-sm">
              Dopisz zaznaczone
            </button>
            <button type="button" disabled={pending} onClick={() => setDraft(null)} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </div>
      )}
      {state.ok && <p className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
