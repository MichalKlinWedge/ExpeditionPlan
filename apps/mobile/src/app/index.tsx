import { dbErrorMessage } from '@expeditionplan/sync';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopoHeader } from '@/components/topo-header';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { LoginCard } from '@/features/auth/login-card';
import { useSession } from '@/features/auth/session';
import { Intro, introSeen } from '@/features/home/intro';
import { StatsCard } from '@/features/home/stats-card';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { UpdateBadge } from '@/features/updates/update-notice';
import { useEditMode } from '@/lib/edit-mode';
import { isConfigured, supabase } from '@/lib/supabase';

/**
 * Start: statystyki wyjazdów (także offline i bez logowania), logowanie, dołączenie z linku,
 * ikona nowej wersji i wejście w Ustawienia (konto, wersja). Przy pierwszym uruchomieniu — wprowadzenie (`Intro`). Wyjazdy i plan mają własne zakładki. Linki z zewnątrz przychodzą tu jako
 * parametry (`+native-intent`): `code` — powrót z linku logowania, `join` — zaproszenie.
 * Pod statystykami przełącznik trybu podgląd / edycja — jeden dla całej aplikacji (`lib/edit-mode.ts`).
 * Zaproszenie otwarte przed zalogowaniem czeka, aż logowanie się skończy.
 */
export default function HomeScreen() {
  const session = useSession();
  const params = useLocalSearchParams<{ code?: string; join?: string }>();
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [intro, setIntro] = useState(() => !introSeen());
  const pendingJoin = useRef<string | null>(null);

  useEffect(() => {
    if (!params.code) return;
    const code = params.code;
    router.setParams({ code: undefined });
    void supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error && (await supabase.auth.getSession()).data.session === null) setMessage(dbErrorMessage(error, 'Logowanie nie powiodło się. Spróbuj jeszcze raz.'));
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
          <TopoHeader
            title="Expedition Planner"
            subtitle="Pocket Guide"
            actions={
              <View style={styles.actions}>
                <UpdateBadge />
                <Pressable onPress={() => setSettings(true)} hitSlop={12} accessibilityLabel="Ustawienia">
                  <ThemedText style={styles.gear}>⚙︎</ThemedText>
                </Pressable>
              </View>
            }
          />
          {message !== '' && <ThemedText type="small">{message}</ThemedText>}
          {!isConfigured && <ThemedText type="small">Brak adresu Supabase w tej wersji aplikacji (EXPO_PUBLIC_SUPABASE_URL).</ThemedText>}
          {isConfigured && session === undefined && <ThemedText type="small">Wczytuję…</ThemedText>}
          {isConfigured && session === null && <LoginCard />}
          {isConfigured && session !== undefined && <StatsCard signedIn={session !== null} />}
          {isConfigured && session && <EditModeCard />}
        </ScrollView>
      </SafeAreaView>
      <SettingsScreen
        visible={settings}
        onClose={() => setSettings(false)}
        onIntro={() => {
          setSettings(false);
          setIntro(true);
        }}
      />
      <Intro visible={intro && !settings} onClose={() => setIntro(false)} />
    </ThemedView>
  );
}

/** Tryb całej aplikacji: podgląd albo edycja planu (organizator i edytor, z internetem). */
function EditModeCard() {
  const [edit, setEdit] = useEditMode();
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Segmented
        label="Tryb"
        options={[
          { value: 'view', label: 'podgląd' },
          { value: 'edit', label: 'edycja' },
        ]}
        value={edit ? 'edit' : 'view'}
        onChange={(value) => setEdit(value === 'edit')}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {edit
          ? 'Edycja: w planie przesuwasz, poprawiasz, usuwasz i dodajesz punkty (organizator i edytor, z internetem). Plan zmienia się dla wszystkich.'
          : 'Podgląd: plan tylko do oglądania — bez przypadkowych zmian. „+15 min”, wydatki, sprzęt i dziennik działają w obu trybach.'}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { gap: Spacing.three, padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  gear: { fontSize: 28, lineHeight: 34, color: '#FFFFFF' },
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
});
