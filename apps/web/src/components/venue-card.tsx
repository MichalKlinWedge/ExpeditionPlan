"use client";

import { type PlaceGuide, type TripDocument, type VenueDraft, type VenueDraftRow, venuePriceLabel, venueRatingLabel } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { clearVenue, readVenue, saveVenue } from "@/app/venue-actions";
import { GuideArticle } from "@/components/guide-article";
import { SparkIcon } from "@/components/icons";

/**
 * Opis lokalu pod mapą „Posiłków”: opis, ocena i przykładowe ceny z wklejonego tekstu, a obok dane miejsca.
 * Jeśli miejsce ma opis z Wikipedii (strona „Miejsca”), jest pod spodem. Organizator i edytor wklejają tekst i wybierają, co zapisać.
 */

type Place = TripDocument["places"][number];

const shortDate = (date: string) => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function VenueCard({ tripId, place, guide, canEdit, showEditor }: { tripId: string; place: Place; guide: PlaceGuide | null; canEdit: boolean; showEditor: boolean }) {
  const { venue } = place;
  const facts = place.address || place.openingHours || place.website;
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="text-lg font-semibold">{place.name}</h2>
      {venue?.rating && (
        <p>
          <span aria-hidden="true">★ </span>
          <strong>{venueRatingLabel(venue.rating)}</strong>
        </p>
      )}
      {venue?.description && <p>{venue.description}</p>}
      {venue && venue.prices.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Przykładowe ceny</h3>
          <ul className="list-disc pl-5">
            {venue.prices.map((price) => (
              <li key={price.name}>{venuePriceLabel(price)}</li>
            ))}
          </ul>
        </div>
      )}
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
      {venue && <p className="text-xs text-zinc-500">Z tekstu wklejonego {shortDate(venue.readOn)}. Ceny i ocena mogły się od tego czasu zmienić.</p>}
      {!venue && guide === null && <p className="text-sm text-zinc-500">Brak opisu lokalu.{canEdit ? "" : " Organizator może go dodać."}</p>}
      {guide && <GuideArticle guide={guide.content} targets={[]} itemBase={`/trips/${tripId}/item/`} />}
      {canEdit && showEditor && <VenueEditor key={place.ref} tripId={tripId} place={place} />}
    </section>
  );
}

function VenueEditor({ tripId, place }: { tripId: string; place: Place }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<FormState>({});
  const [draft, setDraft] = useState<{ draft: VenueDraft; rows: VenueDraftRow[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const query = encodeURIComponent([place.name, place.address].filter(Boolean).join(" "));

  const read = () =>
    start(async () => {
      const result = await readVenue(tripId, place.ref, text);
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
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Wklej tekst ze strony lokalu: opis, ocenę, menu z cenami
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={20_000} disabled={pending} placeholder="Zaznacz i skopiuj tekst, np. z Google Maps, TripAdvisora albo menu lokalu." className="field p-2 text-sm" />
      </label>
      <p className="text-xs text-zinc-500">
        Serwisy z ocenami nie pozwalają ich automatycznie pobierać i zapisywać, więc dane pochodzą tylko z wklejonego tekstu.{" "}
        <a href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noreferrer" className="underline">
          Otwórz lokal w Google Maps
        </a>
        . AI przygotuje szkic, a Ty wybierzesz, co zapisać.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || text.trim() === ""} onClick={read} className="btn-primary btn-sm">
          <SparkIcon className="size-4" />
          {pending ? "Czytam…" : "Odczytaj dane lokalu (AI)"}
        </button>
        {place.venue && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm("Usunąć opis, ceny i ocenę tego lokalu?") && start(async () => setState(await clearVenue(tripId, place.ref)))}
            className="text-xs underline disabled:opacity-50">
            usuń dane lokalu
          </button>
        )}
      </div>

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-signal/60 p-3">
          <p className="font-medium">Co zapisać?</p>
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
                    {row.current && <span className="block text-xs text-amber-700 dark:text-amber-400">teraz zapisane: {row.current}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={pending || picked.size === 0} onClick={save} className="btn-primary btn-sm">
              Zapisz zaznaczone
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
