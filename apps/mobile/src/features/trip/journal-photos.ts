import { Directory, File, Paths } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

/**
 * Zdjęcia dziennika: kopia zostaje w katalogu aplikacji (widać ją offline od razu), a do bucketu
 * `journal` idzie, gdy jest sieć — kolejka w `localStorage` przeżywa restart. Plik już wgrany
 * (ponowna próba po zerwanym połączeniu) liczy się jako sukces. Cudze zdjęcia: plik z „Pobierz
 * offline” (`savePhotos`), a bez niego podpisany URL (z siecią).
 */

const BUCKET = 'journal';
const QUEUE_KEY = 'journal_uploads';

type Pending = { path: string; mimeType: string };

/** Plik zdjęcia na telefonie — nazwa z ostatnich członów ścieżki w buckecie. */
export function localPhoto(path: string): File {
  const [, entryId, name] = path.split('/');
  return new File(Paths.document, 'journal', `${entryId}-${name}`);
}

function queue(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}

const store = (list: Pending[]) => localStorage.setItem(QUEUE_KEY, JSON.stringify(list));

/** Kopiuje wybrane zdjęcie do katalogu aplikacji i dopisuje je do kolejki wysyłki. */
export function keepPhoto(source: string, path: string, mimeType: string) {
  const folder = new Directory(Paths.document, 'journal');
  if (!folder.exists) folder.create({ intermediates: true });
  new File(source).copySync(localPhoto(path));
  store([...queue().filter((each) => each.path !== path), { path, mimeType }]);
}

let running: Promise<number> | null = null;

/** Wysyła zdjęcia z kolejki; zwraca, ile jeszcze czeka. Bez sieci — po prostu czekają dalej. */
export function uploadPhotos(): Promise<number> {
  running ??= (async () => {
    for (const each of queue()) {
      const file = localPhoto(each.path);
      if (!file.exists) {
        store(queue().filter((other) => other.path !== each.path));
        continue;
      }
      const { error } = await supabase.storage.from(BUCKET).upload(each.path, await file.bytes(), { contentType: each.mimeType, upsert: false });
      // „Duplicate” = plik już jest (wysłany wcześniej, potwierdzenie się zgubiło).
      if (error && !/duplicate|already exists/i.test(error.message)) break;
      store(queue().filter((other) => other.path !== each.path));
    }
    return queue().length;
  })().finally(() => (running = null));
  return running;
}

export const waitingPhotos = () => queue().length;

/** Ile z tych zdjęć (ścieżki w buckecie) jest już na telefonie. */
export const savedPhotos = (paths: string[]) => paths.filter((path) => localPhoto(path).exists).length;

/**
 * Cudze zdjęcia dziennika i paragonów na telefon („Pobierz offline”) — bez nich w trasie widać tylko
 * własne. Zwraca, ilu nie udało się pobrać (np. plik jeszcze niewysłany z telefonu autora).
 */
export async function savePhotos(paths: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const folder = new Directory(Paths.document, 'journal');
  if (!folder.exists) folder.create({ intermediates: true });
  const missing = [...new Set(paths)].filter((path) => !localPhoto(path).exists);
  let failed = 0;
  for (const [index, path] of missing.entries()) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error || !data) throw error ?? new Error('brak adresu');
      await File.downloadFileAsync(data.signedUrl, localPhoto(path));
    } catch {
      failed++;
    }
    onProgress?.(index + 1, missing.length);
  }
  return failed;
}

/** Adres do wyświetlenia: plik z telefonu albo krótki podpisany URL (z siecią). */
export async function photoUri(path: string): Promise<string | null> {
  const file = localPhoto(path);
  if (file.exists) return file.uri;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
