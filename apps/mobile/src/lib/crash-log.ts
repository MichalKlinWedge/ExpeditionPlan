import 'expo-sqlite/localStorage/install';

import { Alert } from 'react-native';

/**
 * Ostatni krytyczny błąd JS: zapisany tuż przed zamknięciem aplikacji (zapis `localStorage` jest
 * synchroniczny), pokazany przy następnym starcie — bez logów z telefonu (adb) to jedyny ślad.
 * Brak okienka po awarii = awaria natywna, nie w JS. Instaluje się przy imporcie (pierwszy w `_layout`).
 */

const KEY = 'last_crash';

type Handler = (error: unknown, fatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void };

function installCrashLog() {
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (utils === undefined) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    try {
      const failure = error instanceof Error ? error : new Error(String(error));
      const stack = (failure.stack ?? '').split('\n').slice(0, 8).join('\n');
      localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), fatal: fatal === true, message: `${failure.name}: ${failure.message}`, stack }));
    } catch {
      // Zapis śladu nie może zasłonić właściwego błędu.
    }
    previous(error, fatal);
  });
}

installCrashLog();

/** Pokazuje zapisany ślad poprzedniej awarii (raz) i go czyści. */
export function showLastCrash() {
  let saved: { at: string; fatal: boolean; message: string; stack: string } | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    saved = raw === null ? null : JSON.parse(raw);
  } catch {
    saved = null;
  }
  if (saved === null) return;
  localStorage.removeItem(KEY);
  Alert.alert(saved.fatal ? 'Aplikacja zamknęła się przez błąd' : 'Błąd w aplikacji', `${new Date(saved.at).toLocaleString('pl-PL')}\n\n${saved.message}\n\n${saved.stack}`);
}
