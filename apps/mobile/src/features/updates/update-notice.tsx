import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
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
 * Pilnuje nowych wersji: pyta serwer przy starcie, po powrocie na pierwszy plan i co
 * `CHECK_COOLDOWN_MS`, gdy aplikacja jest otwarta. Niczego nie pobiera i o nic nie pyta —
 * nowa wersja to tylko ikona na Start (`UpdateBadge`); pobranie i restart dopiero po dotknięciu.
 */
export function UpdateWatcher() {
  const { lastCheckForUpdateTimeSinceRestart } = Updates.useUpdates();

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

  return null;
}

/**
 * Ikona na ekranie Start, gdy na serwerze jest nowa wersja. Dotknięcie pobiera ją i proponuje
 * restart (już pobrana — od razu restart).
 */
export function UpdateBadge() {
  const { isUpdateAvailable, isUpdatePending, isDownloading } = Updates.useUpdates();
  if (!isUpdateAvailable && !isUpdatePending) return null;
  const install = async () => {
    if (!isUpdatePending) {
      const result = await fetchNewerBundle(Updates);
      if (result.state !== 'ready') {
        const { title, message } = describeCheck(result);
        return Alert.alert(title, message);
      }
    }
    offerRestart('Nowa wersja', 'Zacznie działać po ponownym uruchomieniu aplikacji.');
  };
  return (
    <Pressable onPress={() => void install()} disabled={isDownloading} hitSlop={12} style={[styles.badge, isDownloading && styles.disabled]} accessibilityLabel="Nowa wersja aplikacji — dotknij, żeby zainstalować">
      <ThemedText style={styles.badgeText}>{isDownloading ? '…' : '⬆'}</ThemedText>
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
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3c87f7' },
  badgeText: { color: '#ffffff', fontSize: 18, lineHeight: 22, fontWeight: 700 },
});
