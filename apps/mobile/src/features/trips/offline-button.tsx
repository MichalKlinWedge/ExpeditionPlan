import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { downloadTripOffline, onOfflineChange, type OfflineState, offlineState } from '@/features/trip/offline-download';

/**
 * „Pobierz wyjazd offline” na karcie wyjazdu: stan (plan z dnia…, mapa, dokumenty) i jeden przycisk,
 * który dociąga braki z postępem. Ekran nie musi być otwarty do końca kroku mapy — MapLibre pobiera
 * paczkę dalej, a następne kliknięcie wznawia od miejsca przerwania.
 */

const stamp = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function summary(state: OfflineState): string {
  if (state.syncedAt === null) return 'Na telefonie: nic — pobierz przed wyjazdem.';
  return [
    `plan z ${stamp(state.syncedAt)}`,
    state.map.total > 0 ? `mapa ${state.map.done}/${state.map.total} obszarów` : 'mapa: brak miejsc ze współrzędnymi',
    state.documents.total > 0 ? `dokumenty ${state.documents.done}/${state.documents.total}` : null,
    state.guides > 0 ? `przewodnik: ${state.guides} opisów` : null,
  ]
    .filter(Boolean)
    .join(' · ');
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

export function OfflineButton({ tripId, online }: { tripId: string; online: boolean }) {
  const [state, refresh, setState] = useOfflineState(tripId);
  const [progress, setProgress] = useState('');

  const download = async () => {
    setProgress('Przygotowuję…');
    try {
      const done = await downloadTripOffline(tripId, setProgress);
      setState(done);
      Alert.alert(done.complete ? 'Wyjazd jest na telefonie' : 'Pobrano częściowo', done.complete ? 'Plan, mapa i dokumenty działają bez internetu.' : summary(done));
    } catch (e) {
      Alert.alert('Nie pobrano wszystkiego', `${e instanceof Error ? e.message : String(e)}\n\nTo, co już jest, zostaje — kliknij ponownie, żeby dociągnąć resztę.`);
      refresh();
    } finally {
      setProgress('');
    }
  };

  const busy = progress !== '';
  return (
    <View style={styles.box}>
      <ThemedText type="small" themeColor="textSecondary">
        {state === null
          ? 'Sprawdzam, co jest na telefonie…'
          : `${state.complete ? '✓ Offline: ' : state.stale ? 'Plan zmienił się od pobrania — dociągnij brakujące. Offline: ' : 'Offline: '}${summary(state)}`}
      </ThemedText>
      {online && (
        <Button
          label={busy ? progress : state?.complete ? 'Odśwież wyjazd offline' : 'Pobierz wyjazd offline'}
          variant={state?.complete ? 'secondary' : 'primary'}
          disabled={busy}
          onPress={() => void download()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.one },
});
