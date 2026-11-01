import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { describeBundle, describeCheck, fetchNewerBundle, shouldCheck } from './check';

// Restart gubi tylko to, co na ekranie — log i punkty są w plikach, zadania w tle trzyma system.
const offerRestart = (title: string, message: string) =>
  Alert.alert(title, message, [
    { text: 'Później', style: 'cancel' },
    { text: 'Uruchom teraz', onPress: () => void Updates.reloadAsync() },
  ]);

/**
 * Pilnuje nowych wersji bez udziału użytkownika: pyta serwer przy starcie, po powrocie na
 * pierwszy plan i co `CHECK_COOLDOWN_MS`, gdy aplikacja jest otwarta; sam pobiera paczkę, raz
 * proponuje restart, a do restartu na Start wisi znaczek (`UpdateBadge`).
 */
export function UpdateWatcher() {
  const { isUpdateAvailable, isUpdatePending, isDownloading, lastCheckForUpdateTimeSinceRestart } = Updates.useUpdates();
  const offered = useRef(false);

  useEffect(() => {
    const check = () => {
      if (!Updates.isEnabled || !shouldCheck(lastCheckForUpdateTimeSinceRestart, Date.now())) return;
      // Nieudane pytanie nie jest wiadomością dla użytkownika — bez sieci po prostu nic się nie dzieje.
      void Updates.checkForUpdateAsync().catch(() => {});
    };
    check();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && check());
    // Co pół minuty, a o pytaniu decyduje `shouldCheck` — interwał równy przerwie gubiłby co drugie sprawdzenie.
    const timer = setInterval(() => AppState.currentState === 'active' && check(), 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [lastCheckForUpdateTimeSinceRestart]);

  useEffect(() => {
    if (isUpdateAvailable && !isUpdatePending && !isDownloading) void Updates.fetchUpdateAsync().catch(() => {});
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  useEffect(() => {
    if (!isUpdatePending || offered.current) return;
    offered.current = true;
    offerRestart('Nowa wersja gotowa', 'Pobrałem aktualizację aplikacji. Zacznie działać po ponownym uruchomieniu.');
  }, [isUpdatePending]);

  return null;
}

/**
 * Znaczek na ekranie Start, gdy jest nowa wersja: w trakcie pobierania tylko informacja,
 * po pobraniu — dotknięcie proponuje restart.
 */
export function UpdateBadge() {
  const { isUpdateAvailable, isUpdatePending } = Updates.useUpdates();
  if (!isUpdateAvailable && !isUpdatePending) return null;
  return (
    <Pressable
      disabled={!isUpdatePending}
      onPress={() => offerRestart('Nowa wersja gotowa', 'Zacznie działać po ponownym uruchomieniu aplikacji.')}
      style={styles.badge}
      accessibilityLabel="Nowa wersja aplikacji">
      <ThemedText type="small" style={styles.badgeText}>
        {isUpdatePending ? '⬆ Nowa wersja' : '⬇ Pobieram…'}
      </ThemedText>
    </Pressable>
  );
}

/** Karta w Ustawieniach: która paczka działa i ręczne „Sprawdź aktualizację”. */
export function UpdateCard() {
  const [busy, setBusy] = useState(false);
  // Stałe expo-updates są ustalane przy starcie aplikacji — czytamy je raz, bez stanu.
  const bundle = describeBundle({
    isEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    channel: Updates.channel,
  });

  const check = async () => {
    setBusy(true);
    const result = await fetchNewerBundle(Updates);
    setBusy(false);
    const { title, message } = describeCheck(result);
    if (result.state === 'ready') offerRestart(title, message);
    else Alert.alert(title, message);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small">{bundle}</ThemedText>
      <Pressable onPress={check} disabled={busy} style={[styles.button, busy && styles.disabled]}>
        <ThemedText type="small">{busy ? 'Sprawdzam…' : 'Sprawdź aktualizację'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  button: { alignSelf: 'flex-start', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, borderColor: '#8888' },
  disabled: { opacity: 0.4 },
  badge: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, backgroundColor: '#3c87f7' },
  badgeText: { color: '#ffffff' },
});
