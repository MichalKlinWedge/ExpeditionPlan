"use client";

import { climateFor, climateLine, type ClimatePlace, type ClimateSamples, climateYearsText, fetchClimate, geocodeClimatePlace, needsClimate } from "@expeditionplan/core";
import { useEffect, useState } from "react";

import { tripClimatePlace } from "@/app/climate-actions";
import type { ClimateSource } from "@/lib/climate-place";

/**
 * Klimat terminu dalej niż 16 dni (prognozy jeszcze nie ma): średnie z archiwum Open-Meteo z 10 lat
 * i długość dnia (`core/climate.ts`). Pobiera przeglądarka, wynik trzyma tylko pamięć karty.
 */

const cache = new Map<string, Promise<ClimateSamples>>();

function samplesFor(place: ClimatePlace, from: string, to: string, today: string): Promise<ClimateSamples> {
  const key = `${place.lat.toFixed(3)},${place.lng.toFixed(3)}|${from}|${to}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = fetchClimate(place, from, to, today);
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Miejsce: wpisana nazwa (kreator), inaczej miejsce wyjazdu — podane przez stronę (`source`) albo pobrane
 * akcją `tripClimatePlace` (okna otwierane na kliknięcie). `undefined` = jeszcze szukam, `null` = nie ma skąd.
 */
export function useClimatePlace({ tripId, source, name, countryCode }: { tripId?: string; source?: ClimateSource; name?: string; countryCode?: string }): ClimatePlace | null | undefined {
  const [place, setPlace] = useState<ClimatePlace | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const typed = name?.trim() ?? "";
    const timer = setTimeout(async () => {
      try {
        if (typed.length >= 2) {
          const found = await geocodeClimatePlace(typed, { countryCode });
          if (found !== null || (tripId === undefined && source === undefined)) {
            if (live) setPlace(found);
            return;
          }
        }
        if (source === undefined && tripId === undefined) {
          if (live) setPlace(null);
          return;
        }
        const fromTrip = source ?? (await tripClimatePlace(tripId!));
        const found = fromTrip.place ?? (fromTrip.query ? await geocodeClimatePlace(fromTrip.query.name, { countryCode: fromTrip.query.countryCode }) : null);
        if (live) setPlace(found);
      } catch {
        if (live) setPlace(null);
      }
    }, typed.length > 0 ? 700 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tripId, source, name, countryCode]);
  return place;
}

/** Dane klimatu dla okna `from`–`to` (np. całej ankiety terminu); `null` do czasu pobrania. */
export function useClimate(place: ClimatePlace | null | undefined, from: string | null, to: string | null, today: string): { data: ClimateSamples | null; error: boolean } {
  const [state, setState] = useState<{ key: string; data: ClimateSamples | null; error: boolean }>({ key: "", data: null, error: false });
  const key = place && from && to ? `${place.lat},${place.lng}|${from}|${to}` : "";
  useEffect(() => {
    if (!place || from === null || to === null) return;
    let live = true;
    // Zmiana daty w polu: chwila na dopisanie, zanim pójdzie 10 zapytań.
    const timer = setTimeout(() => {
      samplesFor(place, from, to, today).then(
        (data) => live && setState({ key, data, error: false }),
        () => live && setState({ key, data: null, error: true }),
      );
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [place, from, to, today, key]);
  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: false };
}

/** Podpis wymagany warunkami: Open-Meteo (CC BY 4.0), ERA5 z Copernicus, a miejsce z geokodera — GeoNames. */
export function ClimateCredit({ place }: { place?: ClimatePlace | null }) {
  return (
    <>
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">
        Open-Meteo.com
      </a>{" "}
      (CC BY 4.0), ERA5 — Copernicus Climate Change Service
      {place?.geonames && (
        <>
          , miejsce:{" "}
          <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">
            GeoNames
          </a>
        </>
      )}
    </>
  );
}

/** Jedna linia klimatu dla terminu, gdy jest dalej niż horyzont prognozy. */
export function ClimateHint({ tripId, source, name, countryCode, start, end, today }: { tripId?: string; source?: ClimateSource; name?: string; countryCode?: string; start: string | null; end: string | null; today: string }) {
  const far = start !== null && end !== null && needsClimate(start, today);
  const place = useClimatePlace(far ? { tripId, source, name, countryCode } : {});
  const { data, error } = useClimate(far ? place : null, start, end, today);
  if (!far) return null;
  const climate = data && start && end ? climateFor(data, start, end) : null;
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      {climate ? (
        <>
          <p>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Klimat{place ? ` — ${place.name}` : ""}:</span> {climateLine(climate)}
          </p>
          <p>
            Termin dalej niż 16 dni, więc zamiast prognozy {climateYearsText(climate)} dla tych dni kalendarza. Źródło: <ClimateCredit place={place} />.
          </p>
        </>
      ) : error ? (
        <p>Nie udało się pobrać klimatu z Open-Meteo.</p>
      ) : place === null ? (
        <p>{name?.trim() ? `Nie znam miejsca „${name.trim()}” — klimat liczy się z pierwszego miejsca z listy.` : "Klimat dla terminu dalej niż 16 dni pojawi się, gdy plan będzie miał miejsce ze współrzędnymi albo brief — pierwsze miejsce."}</p>
      ) : (
        <p>Liczę klimat dla tego terminu…</p>
      )}
    </div>
  );
}
