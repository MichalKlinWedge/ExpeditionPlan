import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { downloadTripOffline, offlineEstimate, onOfflineChange, type OfflineState, offlineState, polishVoice } from '@/features/trip/offline-download';
import { enableReminders, remindersEnabled, requestExactAlarms } from '@/features/trip/reminders';

/**
 * „Pobierz offline” na karcie wyjazdu: jeden przycisk, który dociąga braki z postępem, a przy
 * dacie wyjazdu — kiedy plan był ostatnio doczytany (`OfflineStamp`). Ekran nie musi być otwarty do końca kroku mapy — MapLibre pobiera
 * paczkę dalej, a następne kliknięcie wznawia od miejsca przerwania.
 */

/** Od tylu bajtów „Pobierz offline” najpierw pokazuje rozmiar i pyta. */
const ASK_BYTES = 20 * 1024 * 1024;

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);

/** Android 14+ domyślnie nie daje dokładnych alarmów — bez nich „Za 15 min” przychodzi z opóźnieniem. */
const askExactAlarms = () =>
  Alert.alert('Dokładne godziny przypomnień', 'Bez tej zgody Android przesuwa „Za 15 min” nawet o kilkanaście minut. Na następnym ekranie włącz „Zezwalaj na ustawianie alarmów i przypomnień”.', [
    { text: 'Nie teraz', style: 'cancel' },
    { text: 'Dalej', onPress: () => void requestExactAlarms() },
  ]);

/** Uwagi po pobraniu: dokumenty tylko z internetem, zdjęcia bez kopii, brak polskiego głosu offline. */
async function afterDownload(state: OfflineState): Promise<string[]> {
  const notes: string[] = [];
  if (state.onlineOnly > 0) {
    notes.push(`${state.onlineOnly === 1 ? '1 dokument nie jest oznaczony' : `${state.onlineOnly} dokumentów nie jest oznaczonych`} „offline” — w trasie otworzy się tylko z internetem. Oznacza się to na webie, w Sejfie.`);
  }
  if (state.photos.done < state.photos.total) notes.push(`Nie pobrano ${state.photos.total - state.photos.done} zdjęć — dociągną się przy następnym „Odśwież offline”.`);
  if (state.guides > 0) {
    const voice = await polishVoice();
    if (voice === 'missing') notes.push('Telefon nie ma polskiego głosu do „Posłuchaj”: Ustawienia Androida → Zamiana tekstu na mowę → pobierz język polski.');
    if (voice === 'network') notes.push('Polski głos do „Posłuchaj” działa tylko z internetem: w ustawieniach zamiany tekstu na mowę pobierz polski głos offline.');
  }
  return notes;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function summary(state: OfflineState): string {
  if (state.syncedAt === null) return 'Na telefonie: nic — pobierz przed wyjazdem.';
  return [
    `plan z ${stamp(state.syncedAt)}`,
    state.map.total > 0 ? `mapa ${state.map.done}/${state.map.total} obszarów` : 'mapa: brak miejsc ze współrzędnymi',
    state.documents.total > 0 ? `dokumenty ${state.documents.done}/${state.documents.total}` : null,
    state.guides > 0 ? `przewodnik: ${state.guides} opisów` : null,
    state.photos.total > 0 ? `zdjęcia ${state.photos.done}/${state.photos.total}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Do wstawienia w wiersz z datą i rolą: „ · offline z 7.11, 10:30” albo „ · offline: nic”. */
export function OfflineStamp({ tripId }: { tripId: string }) {
  const [state] = useOfflineState(tripId);
  if (state === null) return null;
  return <>{state.syncedAt === null ? ' · offline: nic' : ` · offline z ${stamp(state.syncedAt)}`}</>;
}

/** Stan offline wyjazdu, odświeżany po pobraniu (z karty albo z innego miejsca). */
function useOfflineState(tripId: string): [OfflineState | null, () => void, (state: OfflineState) => void] {
  const [state, setState] = useState<OfflineState | null>(null);
  const refresh = useCallback(() => {
    void offlineState(tripId).then(setState, () => setState(null));
  }, [tripId]);
  // Pierwszy odczyt z timera, nie wprost w efekcie (reguła react-hooks/set-state-in-effect).
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const off = onOfflineChange((changed) => changed === tripId && refresh());
    return () => {
      clearTimeout(first);
      off();
    };
  }, [refresh, tripId]);
  return [state, refresh, setState];
}

/**
 * Plakietka na zwiniętej karcie wyjazdu: „✓ offline”, „⬇ offline” (pakiet niepełny) albo
 * „⬇ nowsza wersja planu” (był kompletny, plan się zmienił i czegoś brakuje).
 */
export function OfflineBadge({ tripId }: { tripId: string }) {
  const theme = useTheme();
  const [state] = useOfflineState(tripId);
  if (state === null) return null;
  const label = state.complete ? '✓ offline' : state.stale ? '⬇ nowsza wersja planu' : '⬇ offline';
  return (
    <ThemedText type="small" style={{ color: state.complete ? theme.textSecondary : theme.accent }}>
      {label}
    </ThemedText>
  );
}

export function OfflineButton({ tripId }: { tripId: string }) {
  const [state, refresh, setState] = useOfflineState(tripId);
  const [progress, setProgress] = useState('');

  const run = async () => {
    setProgress('Przygotowuję…');
    try {
      const done = await downloadTripOffline(tripId, setProgress);
      setState(done);
      const notes = await afterDownload(done);
      const text = [done.complete ? 'Plan, mapa i dokumenty działają bez internetu.' : summary(done), ...notes].join('\n\n');
      Alert.alert(
        done.complete ? 'Wyjazd jest na telefonie' : 'Pobrano częściowo',
        text,
        remindersEnabled()
          ? undefined
          : [
              { text: 'Nie teraz', style: 'cancel' },
              {
                text: 'Włącz przypomnienia',
                onPress: () =>
                  void enableReminders().then(({ ok, exact }) => {
                    if (!ok) return Alert.alert('Brak zgody na powiadomienia', 'Włącz je w ustawieniach Androida dla tej aplikacji.');
                    if (!exact) askExactAlarms();
                  }),
              },
            ],
      );
    } catch (e) {
      Alert.alert('Nie pobrano wszystkiego', `${e instanceof Error ? e.message : String(e)}\n\nTo, co już jest, zostaje — kliknij ponownie, żeby dociągnąć resztę.`);
      refresh();
    } finally {
      setProgress('');
    }
  };

  /** Przed pobraniem: szacunek rozmiaru braków i wolne miejsce (małe pobranie — bez pytania). */
  const download = async () => {
    const estimate = await offlineEstimate(tripId).catch(() => null);
    if (estimate === null || (estimate.enough && estimate.bytes < ASK_BYTES)) return void run();
    const size = `Do pobrania ok. ${mb(estimate.bytes)}${estimate.free === null ? '' : ` (wolne na telefonie: ${mb(estimate.free)})`}.`;
    if (!estimate.enough) {
      return Alert.alert('Za mało miejsca', `${size}\n\nZwolnij miejsce na telefonie i spróbuj ponownie — plan i tak zostaje na telefonie.`);
    }
    Alert.alert('Pobrać wyjazd offline?', `${size} Najlepiej przez Wi-Fi.`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Pobierz', onPress: () => void run() },
    ]);
  };

  const busy = progress !== '';
  return (
    <Button
      label={busy ? progress : state?.complete ? 'Odśwież offline' : 'Pobierz offline'}
      variant={state?.complete ? 'secondary' : 'primary'}
      disabled={busy}
      small
      onPress={() => void download()}
    />
  );
}
