import { TripBrief } from '@expeditionplan/core';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { UpdateCard } from '@/features/updates/update-notice';

/**
 * Ekran zastępczy z Etapu 0. Jedyne, co sprawdza, to że aplikacja widzi wspólny pakiet
 * `@expeditionplan/core` z monorepo i potrafi nim zwalidować dane — „Tu i teraz” przyjdzie w MVP-4.
 */
const check = TripBrief.safeParse({
  title: 'Test',
  goal: 'Sprawdzić, że pakiet core działa w aplikacji',
  location: { kind: 'city', countries: ['PL'], places: ['Wrocław'] },
  dates: { kind: 'fixed', start: '2026-11-01', end: '2026-11-02' },
  profiles: ['sightseeing'],
  travelers: [{ name: 'Ala' }],
  transport: ['walk'],
  budget: { level: 'low', currency: 'PLN' },
});

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.center}>
          ExpeditionPlan
        </ThemedText>
        <ThemedText style={styles.center}>Pocket Guide · testy PoC-2 i PoC-3</ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">
            Pakiet @expeditionplan/core: {check.success ? 'działa' : 'błąd walidacji'}
          </ThemedText>
        </ThemedView>
        <UpdateCard />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  center: {
    textAlign: 'center',
  },
  card: {
    alignSelf: 'stretch',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
