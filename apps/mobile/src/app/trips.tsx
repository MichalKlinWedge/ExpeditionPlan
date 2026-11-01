import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { TripsCard } from '@/features/trips/trips-card';

/** Zakładka Wyjazdy: lista z rolą i szczegółami, wejście w plan dzień po dniu. Odświeża się przy każdym wejściu. */
export default function TripsTab() {
  const session = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  useFocusEffect(useCallback(() => setReloadKey((key) => key + 1), []));

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          {session === null && <ThemedText>Zaloguj się na ekranie Start, żeby zobaczyć wyjazdy.</ThemedText>}
          {session && <TripsCard reloadKey={reloadKey} />}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
});
