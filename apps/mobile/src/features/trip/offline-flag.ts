/**
 * Wersja planu z ostatniego kompletnego „Pobierz offline” (w `localStorage`). Osobny moduł, bo czytają
 * ją i pobieranie (`offline-download.ts`), i przypomnienia (`reminders.ts`) — bez wzajemnych importów.
 */

const KEY = (tripId: string) => `offline_done_${tripId}`;

export function offlineDoneVersion(tripId: string): number | null {
  try {
    const value = localStorage.getItem(KEY(tripId));
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

export function setOfflineDoneVersion(tripId: string, version: number): void {
  try {
    localStorage.setItem(KEY(tripId), String(version));
  } catch {
    // Bez zapisu plakietka „nowsza wersja” i przypomnienie o pobraniu po prostu się nie zmienią.
  }
}
