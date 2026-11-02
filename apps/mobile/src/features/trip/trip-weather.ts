import { type DayWeather, fetchWeather, localToday, type TripDocument, weatherPoints } from '@expeditionplan/core';
import { File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';

/**
 * Prognoza dni wyjazdu na telefonie (Open-Meteo, z telefonu — limit per IP). Ostatnia pobrana
 * zostaje w pliku: bez sieci plan pokazuje ją z godziną pobrania. Odświeżenie co 3 godziny.
 */

type Saved = { fetchedAt: string; days: Record<string, DayWeather> };
const fileOf = (tripId: string) => new File(Paths.document, `weather-${tripId}.json`);
const REFRESH_MS = 3 * 3600_000;

function saved(tripId: string): Saved | null {
  try {
    const file = fileOf(tripId);
    return file.exists ? (JSON.parse(file.textSync()) as Saved) : null;
  } catch {
    return null;
  }
}

export function useTripWeather(tripId: string, doc: TripDocument | null): Saved | null {
  const [weather, setWeather] = useState<Saved | null>(() => saved(tripId));
  const points = useMemo(() => (doc === null ? [] : weatherPoints(doc)), [doc]);
  const key = points.map((point) => `${point.dayRef}@${point.lat.toFixed(2)},${point.lng.toFixed(2)}`).join('|');

  useEffect(() => {
    if (points.length === 0) return;
    const current = saved(tripId);
    if (current !== null && Date.now() - Date.parse(current.fetchedAt) < REFRESH_MS) return;
    let cancelled = false;
    void fetchWeather(points, localToday())
      .then(async (days) => {
        if (Object.keys(days).length === 0) return;
        const next = { fetchedAt: new Date().toISOString(), days };
        await fileOf(tripId).write(JSON.stringify(next));
        if (!cancelled) setWeather(next);
      })
      .catch(() => undefined); // offline — zostaje zapisana prognoza
    return () => {
      cancelled = true;
    };
    // `key` streszcza `points` — nowe zapytanie tylko przy zmianie miejsc lub dni.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, key]);

  return weather;
}
