/**
 * Aktualizacje OTA (jak w FormaSync). `expo-updates` sam zagląda na serwer przy starcie, ale nową
 * paczkę uruchamia dopiero przy następnym otwarciu — ten moduł sprawdza i pobiera na żądanie.
 *
 * Zależności przychodzą jako argument, a nie przez `Updates.*` w środku, bo moduł natywny działa
 * wyłącznie w zbudowanej aplikacji.
 */

export type UpdateCheck =
  /** Aktualizacje wyłączone — serwer deweloperski albo build bez expo-updates. */
  | { state: 'disabled' }
  /** Na serwerze nie ma nic nowszego. */
  | { state: 'current' }
  /** Paczka pobrana i czeka na restart aplikacji. */
  | { state: 'ready' }
  | { state: 'failed'; reason: string };

export type UpdateApi = {
  isEnabled: boolean;
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync: () => Promise<{ isNew: boolean }>;
};

export async function fetchNewerBundle(updates: UpdateApi): Promise<UpdateCheck> {
  if (!updates.isEnabled) return { state: 'disabled' };
  try {
    const available = await updates.checkForUpdateAsync();
    if (!available.isAvailable) return { state: 'current' };
    const fetched = await updates.fetchUpdateAsync();
    // Pobranie bez nowej paczki zdarza się przy wycofaniu aktualizacji na serwerze.
    return fetched.isNew ? { state: 'ready' } : { state: 'current' };
  } catch (e) {
    return { state: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Komunikat dla użytkownika; tytuł osobno, bo trafia do okienka z przyciskami. */
export function describeCheck(check: UpdateCheck): { title: string; message: string } {
  switch (check.state) {
    case 'disabled':
      return { title: 'Aktualizacje wyłączone', message: 'Ta wersja pobiera kod z serwera deweloperskiego, więc nie ma czego sprawdzać.' };
    case 'current':
      return { title: 'Masz najnowszą wersję', message: 'Na serwerze nie ma nowszej paczki.' };
    case 'ready':
      return { title: 'Pobrano nową wersję', message: 'Zacznie działać po ponownym uruchomieniu aplikacji.' };
    case 'failed':
      return { title: 'Nie udało się sprawdzić', message: check.reason };
  }
}

/**
 * Jak często pytać serwer: po powrocie aplikacji na pierwszy plan i co tyle, gdy jest otwarta.
 * Telefon potrafi trzymać aplikację w tle tygodniami — samo sprawdzenie przy starcie dawno by się
 * przedawniło. Pytanie to jedno małe żądanie, a znaczek nowej wersji na Start ma się pojawić od razu.
 */
export const CHECK_COOLDOWN_MS = 2 * 60 * 1000;

/** Czy od ostatniego sprawdzenia minęło dość czasu. Brak daty znaczy „jeszcze nie pytaliśmy”. */
export function shouldCheck(lastCheck: Date | undefined, now: number): boolean {
  return lastCheck === undefined || now - lastCheck.getTime() >= CHECK_COOLDOWN_MS;
}

/** Migawka stałych expo-updates — po niej widać, czy aktualizacja OTA faktycznie się wgrała. */
export type BundleSnapshot = {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  createdAt: Date | null;
  channel: string | null;
};

/**
 * Opis działającej paczki JS. Numer wersji z `app.json` się nie nadaje: `runtimeVersion` idzie
 * z `appVersion`, więc jego podbicie odcięłoby zainstalowany APK od nowych paczek.
 */
export function describeBundle(snapshot: BundleSnapshot): string {
  if (!snapshot.isEnabled) return 'Wersja z serwera deweloperskiego — aktualizacje OTA wyłączone.';
  if (snapshot.isEmbeddedLaunch || snapshot.updateId === null) return 'Paczka wbudowana w APK — żadna aktualizacja jeszcze się nie wgrała.';
  // Końcówka, nie początek: identyfikatory to UUIDv7, paczki z jednego dnia mają wspólny prefiks.
  const parts = [`aktualizacja …${snapshot.updateId.slice(-8)}`];
  if (snapshot.createdAt !== null) parts.push(`z ${snapshot.createdAt.toLocaleString('pl-PL')}`);
  if (snapshot.channel !== null) parts.push(`kanał ${snapshot.channel}`);
  return `${parts.join(', ')}.`;
}
