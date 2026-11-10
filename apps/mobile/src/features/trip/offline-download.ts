import { vaultDocument, type VaultDocument } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip, refreshTrip } from '@expeditionplan/sync';
import { Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { offlineAreas } from '@/features/map/map-transit';
import { areaStatuses, downloadAreas } from '@/features/map/offline-packs';
import { saveGuideImages, savedGuideImages } from '@/features/plan/guide-images';
import { guideImageUrls } from '@/features/plan/item-details';
import { savedVaultFiles, syncVaultFiles } from '@/features/trip/documents-view';
import { savedPhotos, savePhotos } from '@/features/trip/journal-photos';
import { offlineDoneVersion, setOfflineDoneVersion } from '@/features/trip/offline-flag';
import { scheduleTripReminders } from '@/features/trip/reminders';
import { localDb, remote } from '@/lib/local-db';

/**
 * „Pobierz wyjazd offline” (MVP-4): jeden przycisk zamiast osobnych miejsc — plan z synchronizacją
 * (pula, warianty, notatki, kontakty, zadania, przewodniki w SQLite), dokumenty „offline” z sejfu,
 * zdjęcia przewodnika i dziennika (także cudze i paragony) jako pliki oraz kafle mapy obszarów wyjazdu.
 * Każdy krok pobiera tylko braki (mapa — obszary bez kompletnej paczki, pliki — bez kopii), więc
 * przerwane pobieranie wznawia się od miejsca przerwania, a ponowne kliknięcie przy komplecie kończy się od razu.
 *
 * Przed pobraniem `offlineEstimate` szacuje rozmiar braków i sprawdza wolne miejsce (SPECYFIKACJA M7).
 *
 * Plakietka „nowsza wersja planu”: wersja planu z ostatniego kompletnego pobrania (`offline-flag.ts`);
 * plan dociąga się sam przy każdej synchronizacji, ale mapa i pliki — nie. Gdy plan jest nowszy,
 * a pakietowi czegoś brakuje (nowe miejsce poza obszarami, nowy dokument), trzeba pobrać ponownie.
 */

/** Wersja planu w bazie telefonu (z ostatniej synchronizacji). */
function planVersion(tripId: string): number | null {
  return localDb.all<{ plan_version: number }>('select plan_version from sync_state where trip_id = ?', [tripId])[0]?.plan_version ?? null;
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
  /** Dokumenty bez „offline” na webie — w trasie bez internetu się nie otworzą. */
  onlineOnly: number;
  /** Zdjęcia przewodnika, dziennika i paragonów jako pliki na telefonie. */
  photos: { done: number; total: number };
  guides: number;
  complete: boolean;
  /** Pakiet był kompletny dla starszej wersji planu, a teraz czegoś brakuje. */
  stale: boolean;
};

const tripDocuments = (trip: CachedTrip): VaultDocument[] =>
  trip.live.documents.map((row) => vaultDocument(row)).filter((each): each is VaultDocument => each !== null);

const offlineDocuments = (trip: CachedTrip): VaultDocument[] => tripDocuments(trip).filter((each) => each.offline);

/** Zdjęcia dziennika i paragonów wyjazdu (ścieżki w buckecie `journal`). */
function tripPhotoPaths(trip: CachedTrip): string[] {
  const journal = (trip.live.journal as { photo_path?: string | null }[]).flatMap((row) => (row.photo_path ? [row.photo_path] : []));
  const receipts = (trip.live.expenses as { receipt_path?: string | null }[]).flatMap((row) => (row.receipt_path ? [row.receipt_path] : []));
  return [...new Set([...journal, ...receipts])];
}

/** Co z wyjazdu jest już na telefonie — bez sieci. */
export async function offlineState(tripId: string): Promise<OfflineState> {
  const trip = cachedTrip(localDb, tripId);
  if (trip === null) {
    return { syncedAt: null, map: { done: 0, total: 0 }, documents: { done: 0, total: 0 }, onlineOnly: 0, photos: { done: 0, total: 0 }, guides: 0, complete: false, stale: false };
  }
  const areas = offlineAreas(tripId, trip.state.doc);
  const statuses = await areaStatuses(tripId, areas).catch(() => []);
  const documents = offlineDocuments(trip);
  const map = { done: statuses.filter((status) => status.done).length, total: areas.length };
  const saved = { done: savedVaultFiles(tripId, documents), total: documents.length };
  const guideUrls = guideImageUrls(trip);
  const photoPaths = tripPhotoPaths(trip);
  // Zdjęcia nie wchodzą do „kompletu”: dziennik rośnie w trakcie wyjazdu, a plakietka ma mówić o planie, mapie i dokumentach.
  const photos = { done: savedGuideImages(guideUrls) + savedPhotos(photoPaths), total: new Set(guideUrls).size + photoPaths.length };
  const complete = map.done === map.total && saved.done === saved.total;
  const done = offlineDoneVersion(tripId);
  const version = planVersion(tripId);
  return {
    syncedAt: trip.syncedAt,
    map,
    documents: saved,
    onlineOnly: tripDocuments(trip).length - documents.length,
    photos,
    guides: trip.live.guides.length,
    complete,
    stale: !complete && done !== null && version !== null && version > done,
  };
}

/** Średni rozmiar kafla wektorowego OpenFreeMap — tylko do szacunku przed pobraniem. */
const TILE_BYTES = 30_000;
/** Średnia miniatura zdjęcia (przewodnik ~ 300 px, dziennik do 1920 px). */
const PHOTO_BYTES = 400_000;
/** Zapas wolnego miejsca po pobraniu — telefon bez miejsca nie zrobi nawet zdjęcia. */
const RESERVE_BYTES = 300 * 1024 * 1024;

export type OfflineEstimate = { bytes: number; free: number | null; enough: boolean };

/** Szacunek braków (mapa z liczby kafli, dokumenty z rozmiaru w sejfie, zdjęcia średnio) i wolne miejsce. */
export async function offlineEstimate(tripId: string): Promise<OfflineEstimate> {
  const trip = cachedTrip(localDb, tripId);
  let bytes = 0;
  if (trip !== null) {
    const statuses = await areaStatuses(tripId, offlineAreas(tripId, trip.state.doc)).catch(() => []);
    bytes += statuses.filter((status) => !status.done).reduce((sum, status) => sum + status.area.tiles * TILE_BYTES, 0);
    bytes += offlineDocuments(trip).filter((each) => savedVaultFiles(tripId, [each]) === 0).reduce((sum, each) => sum + (each.size ?? 1_000_000), 0);
    const guideUrls = [...new Set(guideImageUrls(trip))];
    const photoPaths = tripPhotoPaths(trip);
    bytes += (guideUrls.length - savedGuideImages(guideUrls) + photoPaths.length - savedPhotos(photoPaths)) * PHOTO_BYTES;
  }
  let free: number | null = null;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    free = null;
  }
  return { bytes, free, enough: free === null || free > bytes + RESERVE_BYTES };
}

/**
 * Czy telefon ma polski głos do „Posłuchaj”. `missing` — żadnego; `network` — tylko głosy z sieci
 * (Google TTS z sufiksem „network”), które w trasie bez internetu zamilkną.
 */
export async function polishVoice(): Promise<'ok' | 'missing' | 'network' | 'unknown'> {
  try {
    const voices = (await Speech.getAvailableVoicesAsync()).filter((voice) => /^pl/i.test(voice.language));
    if (voices.length === 0) return 'missing';
    return voices.every((voice) => /network/i.test(voice.identifier)) ? 'network' : 'ok';
  } catch {
    return 'unknown';
  }
}

/**
 * Pobiera cały wyjazd. `onProgress` dostaje opis bieżącego kroku („Mapa 2/3 Marakesz: 40%”).
 * Błąd kroku zatrzymuje pobieranie (to, co już jest, zostaje); następne kliknięcie dociąga resztę.
 * Zdjęcia, których nie udało się pobrać, nie zatrzymują reszty — liczą się w `photos`.
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

  const guideUrls = guideImageUrls(trip);
  if (guideUrls.length > 0) await saveGuideImages(guideUrls, (done, total) => onProgress(`Przewodnik: zdjęcia ${done}/${total}…`));

  const photoPaths = tripPhotoPaths(trip);
  if (photoPaths.length > 0) await savePhotos(photoPaths, (done, total) => onProgress(`Dziennik i paragony: zdjęcia ${done}/${total}…`));

  const areas = offlineAreas(tripId, trip.state.doc);
  if (areas.length > 0) await downloadAreas(tripId, areas, (text) => onProgress(`Mapa ${text}`));

  const state = await offlineState(tripId);
  const version = planVersion(tripId);
  if (state.complete && version !== null) {
    setOfflineDoneVersion(tripId, version);
    // Przypomnienie „pobierz wyjazd offline” już niepotrzebne.
    void scheduleTripReminders(tripId, trip.state.doc).catch(() => undefined);
  }
  for (const listener of listeners) listener(tripId);
  return { ...state, stale: false };
}
