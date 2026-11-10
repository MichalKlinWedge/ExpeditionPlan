import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { Plan } from '@/features/plan/plan-screen';
import { currentTrip, loadMyTrips, type MyTrips, type Trip } from '@/features/trips/my-trips';
import { TripSwitcher } from '@/features/trips/trip-switcher';
import { isConfigured } from '@/lib/supabase';

/**
 * Zakładka Plan: od razu bieżący wyjazd na dzisiejszym dniu; obok plan dnia — wydatki i pakowanie. Bez logowania — plany z telefonu, do odczytu. Wybór wyjazdu: trwający dziś,
 * inaczej najbliższy nadchodzący, inaczej ostatni. Przy kilku wyjazdach — przełącznik u góry.
 */

export default function PlanTab() {
  const session = useSession();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const apply = (result: MyTrips) => {
      setError(result.error);
      setTrips(result.trips);
      setSelected(currentTrip(result.trips));
    };
    apply(await loadMyTrips(session !== null, apply));
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      if (session !== undefined) void load();
    }, [load, session]),
  );

  let message: string | null = null;
  if (!isConfigured) message = 'Brak adresu Supabase w tej wersji aplikacji.';
  else if (session === undefined) message = 'Wczytuję…';
  else if (error !== '') message = error;
  else if (trips === null) message = 'Wczytuję…';
  else if (trips.length === 0)
    message = session === null ? 'Na telefonie nie ma pobranych planów — zaloguj się na ekranie Start.' : 'Nie masz jeszcze wyjazdów — utwórz je na webie albo dołącz z linku.';

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        {message !== null || selected === null ? (
          <ThemedText style={styles.pad}>{message}</ThemedText>
        ) : (
          <View style={styles.fill}>
            <TripSwitcher trips={trips!} selected={selected} onSelect={setSelected} />
            <Plan
              key={selected}
              tripId={selected}
              signedIn={session !== null}
              canAct={['owner', 'editor'].includes(trips!.find((trip) => trip.id === selected)?.role ?? '')}
              canAddExpense={trips!.find((trip) => trip.id === selected)?.can_add_expenses === true}
              userId={session?.user.id ?? null}
              bottomInset={BottomTabInset}
            />
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: Spacing.four },
});
