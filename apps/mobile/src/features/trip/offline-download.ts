import { vaultDocument, type VaultDocument } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip, refreshTrip } from '@expeditionplan/sync';
import { Image } from 'expo-image';

import { offlineAreas } from '@/features/map/map-transit';
import { areaStatuses, downloadAreas } from '@/features/map/offline-packs';
import { guideImageUrls } from '@/features/plan/item-details';
import { savedVaultFiles, syncVaultFiles } from '@/features/trip/documents-view';
import { localDb, remote } from '@/lib/local-db';

/**
 * „Pobierz wyjazd offline” (MVP-4): jeden przycisk zamiast osobnych miejsc — plan z synchronizacją
 * (pula, warianty, notatki, kontakty, zadania, przewodniki w SQLite), kafle mapy obszarów wyjazdu,
 * dokumenty „offline” z sejfu i zdjęcia przewodnika. Każdy krok pobiera tylko braki (mapa — obszary
 * bez kompletnej paczki, sejf — pliki bez kopii z tym samym sha), więc przerwane pobieranie wznawia
 * się od miejsca przerwania, a ponowne kliknięcie przy komplecie kończy się od razu.
 *
 * Plakietka „nowsza wersja planu”: wersja planu z ostatniego kompletnego pobrania leży w `localStorage`;
 * plan dociąga się sam przy każdej synchronizacji, ale mapa i dokumenty — nie. Gdy plan jest nowszy,
 * a pakietowi czegoś brakuje (nowe miejsce poza obszarami, nowy dokument), trzeba pobrać ponownie.
 */

const DONE_KEY = (tripId: string) => `offline_done_${tripId}`;

/** Wersja planu w bazie telefonu (z ostatniej synchronizacji). */
function planVersion(tripId: string): number | null {
  return localDb.all<{ plan_version: number }>('select plan_version from sync_state where trip_id = ?', [tripId])[0]?.plan_version ?? null;
}

function savedDone(tripId: string): number | null {
  try {
    const value = localStorage.getItem(DONE_KEY(tripId));
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

/** Słuchacze zmian stanu offline (plakietka na liście i przycisk na karcie odświeżają się razem). */
const listeners = new Set<(tripId: string) => void>();
export function onOfflineChange(listener: (tripId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stan offline wyjazdu zmienił się poza tym modułem (np. przełącznik dojazdu zmienił obszary mapy). */
export function offlineChanged(tripId: string): void {
  for (const listener of listeners) listener(tripId);
}

export type OfflineState = {
  /** Plan na telefonie (chwila ostatniej synchronizacji) albo `null`, gdy nigdy nie pobrany. */
  syncedAt: string | null;
  map: { done: number; total: number };
  documents: { done: number; total: number };
  guides: number;
  complete: boolean;
  /** Pakiet był kompletny dla starszej wersji planu, a teraz czegoś brakuje. */
  stale: boolean;
};

const offlineDocuments = (trip: CachedTrip): VaultDocument[] =>
  trip.live.documents
    .map((row) => vaultDocument(row))
    .filter((each): each is VaultDocument => each !== null && each.offline);

/** Co z wyjazdu jest już na telefonie — bez sieci. */
export async function offlineState(tripId: string): Promise<OfflineState> {
  const trip = cachedTrip(localDb, tripId);
  if (trip === null) return { syncedAt: null, map: { done: 0, total: 0 }, documents: { done: 0, total: 0 }, guides: 0, complete: false, stale: false };
  const areas = offlineAreas(tripId, trip.state.doc);
  const statuses = await areaStatuses(tripId, areas).catch(() => []);
  const documents = offlineDocuments(trip);
  const map = { done: statuses.filter((status) => status.done).length, total: areas.length };
  const saved = { done: savedVaultFiles(tripId, documents), total: documents.length };
  const complete = map.done === map.total && saved.done === saved.total;
  const done = savedDone(tripId);
  const version = planVersion(tripId);
  return {
    syncedAt: trip.syncedAt,
    map,
    documents: saved,
    guides: trip.live.guides.length,
    complete,
    stale: !complete && done !== null && version !== null && version > done,
  };
}

/**
 * Pobiera cały wyjazd. `onProgress` dostaje opis bieżącego kroku („Mapa 2/3 Marakesz: 40%”).
 * Błąd kroku zatrzymuje pobieranie (to, co już jest, zostaje); następne kliknięcie dociąga resztę.
 */
export async function downloadTripOffline(tripId: string, onProgress: (text: string) => void): Promise<OfflineState> {
  onProgress('Plan: synchronizuję…');
  const trip = await refreshTrip(localDb, remote, tripId);

  const documents = offlineDocuments(trip);
  if (documents.length > 0) {
    onProgress(`Dokumenty: pobieram ${documents.length}…`);
    const result = await syncVaultFiles(tripId, documents);
    if (result.failed > 0) throw new Error(`Nie pobrano ${result.failed} z ${documents.length} dokumentów — spróbuj ponownie.`);
  }

  const urls = guideImageUrls(trip);
  if (urls.length > 0) {
    onProgress(`Przewodnik: zdjęcia (${urls.length})…`);
    await Image.prefetch(urls, 'disk').catch(() => false);
  }

  const areas = offlineAreas(tripId, trip.state.doc);
  if (areas.length > 0) await downloadAreas(tripId, areas, (text) => onProgress(`Mapa ${text}`));

  const state = await offlineState(tripId);
  const version = planVersion(tripId);
  if (state.complete && version !== null) {
    try {
      localStorage.setItem(DONE_KEY(tripId), String(version));
    } catch {
      // Bez zapisu plakietka „nowsza wersja” po prostu się nie pokaże.
    }
  }
  for (const listener of listeners) listener(tripId);
  return { ...state, stale: false };
}
