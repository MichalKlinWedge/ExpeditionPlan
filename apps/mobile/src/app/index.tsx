import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { LoginCard } from '@/features/auth/login-card';
import { useSession } from '@/features/auth/session';
import { StatsCard } from '@/features/home/stats-card';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { UpdateBadge } from '@/features/updates/update-notice';
import { isConfigured, supabase } from '@/lib/supabase';

/**
 * Start: statystyki wyjazdów (także offline i bez logowania), logowanie, dołączenie z linku,
 * ikona nowej wersji i wejście w Ustawienia (konto, wersja). Wyjazdy i plan mają własne zakładki. Linki z zewnątrz przychodzą tu jako
 * parametry (`+native-intent`): `code` — powrót z linku logowania, `join` — zaproszenie.
 * Zaproszenie otwarte przed zalogowaniem czeka, aż logowanie się skończy.
 */
export default function HomeScreen() {
  const session = useSession();
  const params = useLocalSearchParams<{ code?: string; join?: string }>();
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const pendingJoin = useRef<string | null>(null);

  useEffect(() => {
    if (!params.code) return;
    const code = params.code;
    router.setParams({ code: undefined });
    void supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error && (await supabase.auth.getSession()).data.session === null) setMessage(`Logowanie nie powiodło się: ${error.message}`);
    });
  }, [params.code]);

  useEffect(() => {
    if (params.join) {
      pendingJoin.current = params.join;
      router.setParams({ join: undefined });
    }
    const token = pendingJoin.current;
    if (!token || !session) return;
    pendingJoin.current = null;
    void supabase.rpc('accept_invite', { p_token: token }).then(({ error }) => {
      setMessage(error ? 'Zaproszenie wygasło, zostało wykorzystane albo jest nieprawidłowe.' : 'Dołączono do wyjazdu — jest w zakładce Wyjazdy.');
    });
  }, [params.join, session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>
              Expedition Planer
            </ThemedText>
            <View style={styles.actions}>
              <UpdateBadge />
              <Pressable onPress={() => setSettings(true)} hitSlop={12} accessibilityLabel="Ustawienia">
                <ThemedText style={styles.gear}>⚙︎</ThemedText>
              </Pressable>
            </View>
          </View>
          <ThemedText>Pocket Guide</ThemedText>
          {message !== '' && <ThemedText type="small">{message}</ThemedText>}
          {!isConfigured && <ThemedText type="small">Brak adresu Supabase w tej wersji aplikacji (EXPO_PUBLIC_SUPABASE_URL).</ThemedText>}
          {isConfigured && session === undefined && <ThemedText type="small">Wczytuję…</ThemedText>}
          {isConfigured && session === null && <LoginCard />}
          {isConfigured && session !== undefined && <StatsCard signedIn={session !== null} />}
        </ScrollView>
      </SafeAreaView>
      <SettingsScreen visible={settings} onClose={() => setSettings(false)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { gap: Spacing.three, padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  gear: { fontSize: 28, lineHeight: 34 },
});
