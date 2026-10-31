import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { LoginCard } from '@/features/auth/login-card';
import { useSession } from '@/features/auth/session';
import { TripsCard } from '@/features/trips/trips-card';
import { UpdateCard } from '@/features/updates/update-notice';
import { isConfigured, supabase } from '@/lib/supabase';

/**
 * Start (MVP-1): logowanie, moje wyjazdy, dołączenie z linku. Linki z zewnątrz przychodzą tu jako
 * parametry (`+native-intent`): `code` — powrót z linku logowania, `join` — zaproszenie.
 * Zaproszenie otwarte przed zalogowaniem czeka, aż logowanie się skończy.
 */
export default function HomeScreen() {
  const session = useSession();
  const params = useLocalSearchParams<{ code?: string; join?: string }>();
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
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
      setMessage(error ? 'Zaproszenie wygasło, zostało wykorzystane albo jest nieprawidłowe.' : 'Dołączono do wyjazdu.');
      setReloadKey((key) => key + 1);
    });
  }, [params.join, session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">ExpeditionPlan</ThemedText>
          <ThemedText>Pocket Guide · testy PoC-2 i PoC-3</ThemedText>
          {message !== '' && <ThemedText type="small">{message}</ThemedText>}
          {!isConfigured && <ThemedText type="small">Brak adresu Supabase w tej wersji aplikacji (EXPO_PUBLIC_SUPABASE_URL).</ThemedText>}
          {isConfigured && session === undefined && <ThemedText type="small">Wczytuję…</ThemedText>}
          {isConfigured && session === null && <LoginCard />}
          {session && (
            <>
              <ThemedView type="backgroundElement" style={styles.account}>
                <ThemedText type="small">{session.user.email}</ThemedText>
                <Pressable onPress={() => void supabase.auth.signOut()}>
                  <ThemedText type="small" style={styles.link}>
                    Wyloguj
                  </ThemedText>
                </Pressable>
              </ThemedView>
              <TripsCard reloadKey={reloadKey} />
            </>
          )}
          <UpdateCard />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { gap: Spacing.three, padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
  account: { flexDirection: 'row', justifyContent: 'space-between', padding: Spacing.three, borderRadius: Spacing.three },
  link: { textDecorationLine: 'underline' },
});
