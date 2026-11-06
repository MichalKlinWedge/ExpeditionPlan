import { fetchRates, type FxRate, localToday, mergeRates, staleCurrencies, tripCurrencies, type TripDocument } from '@expeditionplan/core';
import { File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';

/**
 * Kursy walut na telefonie: z planu (`trip.fx`), a brakujące albo starsze niż tydzień — z Frankfurtera
 * (docs/USLUGI.md), gdy jest sieć. Pobrane kursy zostają w pliku, więc portfel liczy też offline.
 * Plik osobno dla każdej waluty wyjazdu: kurs ma sens tylko względem waluty, w której go pobrano.
 */

const fileOf = (tripId: string, base: string) => new File(Paths.document, `fx-${tripId}-${base}.json`);

function saved(tripId: string, base: string): FxRate[] {
  try {
    const file = fileOf(tripId, base);
    return file.exists ? (JSON.parse(file.textSync()) as FxRate[]) : [];
  } catch {
    return [];
  }
}

/** Kursy do przeliczeń: plan + zapisane na telefonie (nowsze wygrywają) + świeże z sieci. */
export function useLiveRates(tripId: string, doc: TripDocument, expenseCurrencies: readonly string[]): FxRate[] {
  const currencies = useMemo(() => tripCurrencies(doc, expenseCurrencies), [doc, expenseCurrencies]);
  const base = doc.trip.baseCurrency;
  const [stored, setStored] = useState(() => ({ base, rates: saved(tripId, base) }));
  const local = useMemo(() => (stored.base === base ? stored.rates : saved(tripId, base)), [stored, tripId, base]);
  // Kurs z planu ustawił człowiek — zapisany na telefonie wygrywa tylko, gdy jest nowszy.
  const fx = useMemo(() => {
    const fresher = local.filter((rate) => {
      const planned = doc.trip.fx.find((each) => each.currency === rate.currency);
      return planned === undefined || (rate.date !== undefined && (planned.date === undefined || rate.date > planned.date));
    });
    return mergeRates(doc.trip.fx, fresher);
  }, [doc.trip.fx, local]);
  const stale = useMemo(() => staleCurrencies(fx, currencies, localToday()), [fx, currencies]);
  const key = stale.join(',');

  useEffect(() => {
    if (key === '') return;
    let cancelled = false;
    void fetchRates(base, key.split(','))
      .then(async (fresh) => {
        const next = mergeRates(saved(tripId, base), fresh);
        await fileOf(tripId, base).write(JSON.stringify(next));
        if (!cancelled) setStored({ base, rates: next });
      })
      .catch(() => undefined); // offline — zostają kursy z planu i zapisane
    return () => {
      cancelled = true;
    };
  }, [key, tripId, base]);

  return fx;
}
