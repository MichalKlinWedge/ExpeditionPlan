import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { openHelp } from '@/features/home/intro';
import { disableReminders, enableReminders, remindersEnabled } from '@/features/trip/reminders';
import { UpdateCard } from '@/features/updates/update-notice';
import { navApp, type NavApp, setNavApp } from '@/lib/navigate';
import { supabase } from '@/lib/supabase';

/** Ustawienia (zębatka na Start): konto, przypomnienia z planu, „Jak korzystać” i wersja aplikacji z ręcznym sprawdzeniem aktualizacji. */
export function SettingsScreen({ visible, onClose, onIntro }: { visible: boolean; onClose: () => void; onIntro: () => void }) {
  const session = useSession();
  const [name, setName] = useState<string | null>(null);
  const [reminders, setReminders] = useState(remindersEnabled);
  const [reminderInfo, setReminderInfo] = useState('');
  const [nav, setNav] = useState<NavApp>(navApp);
  const userId = session?.user.id;

  // Imię z profilu; bez sieci zostaje sam e-mail.
  useEffect(() => {
    if (!visible || userId === undefined) return;
    void supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setName(data?.display_name ?? null));
  }, [visible, userId]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            <View style={styles.top}>
              <Button label="← Wróć" onPress={onClose} small />
              <ThemedText type="smallBold">Ustawienia</ThemedText>
            </View>
            <ScrollView contentContainerStyle={styles.content}>
              <ThemedText type="smallBold">Konto</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                {session ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Zalogowany
                    </ThemedText>
                    {name && <ThemedText type="smallBold">{name}</ThemedText>}
                    <ThemedText type="small">{session.user.email}</ThemedText>
                    <Pressable
                      onPress={() => {
                        void supabase.auth.signOut();
                        onClose();
                      }}
                      hitSlop={8}>
                      <ThemedText type="linkPrimary">Wyloguj</ThemedText>
                    </Pressable>
                    <ThemedText type="small" themeColor="textSecondary">
                      Pobrane plany zostają na telefonie po wylogowaniu; znikną, jeśli zaloguje się inne konto.
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText type="small">Niezalogowany — zaloguj się na ekranie Start.</ThemedText>
                )}
              </ThemedView>

              <ThemedText type="smallBold">Przypomnienia</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small">
                  Powiadomienia o zadaniach z planu („Sprawdź paszporty — 14 dni przed wyjazdem”), dzień przed wyjazdem, a w trakcie — „Za 15 min” przed każdym punktem i termin decyzji wariantu (przeliczane po każdym „+15 min” i „Pomiń”). Działają bez internetu.
                </ThemedText>
                <Button
                  label={reminders ? 'Wyłącz przypomnienia' : 'Włącz przypomnienia'}
                  variant={reminders ? 'secondary' : 'primary'}
                  onPress={() =>
                    void (reminders
                      ? disableReminders().then(() => {
                          setReminders(false);
                          setReminderInfo('Przypomnienia wyłączone.');
                        })
                      : enableReminders().then(({ ok, count }) => {
                          setReminders(ok);
                          setReminderInfo(ok ? `Zaplanowano: ${count}. Nowe zadania dojdą po otwarciu planu.` : 'Brak zgody na powiadomienia — włącz je w ustawieniach Androida.');
                        }))
                  }
                />
                {reminderInfo !== '' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {reminderInfo}
                  </ThemedText>
                )}
              </ThemedView>

              <ThemedText type="smallBold">Nawigacja</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small">
                  Dokąd prowadzi „Nawiguj”. Google Maps bez internetu działa tylko na obszarze pobranym wcześniej w Google Maps. „Inna aplikacja” otwiera cel w aplikacji wybranej w Androidzie — OsmAnd, Organic Maps albo Mapy.com nawigują na własnych mapach offline (trzeba je w niej pobrać).
                </ThemedText>
                <Segmented
                  label="Nawiguj w"
                  options={[
                    { value: 'google', label: 'Google Maps' },
                    { value: 'other', label: 'inna aplikacja' },
                  ]}
                  value={nav}
                  onChange={(value) => {
                    setNavApp(value);
                    setNav(value);
                  }}
                />
              </ThemedView>

              <ThemedText type="smallBold">Jak korzystać</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small">Krótkie wprowadzenie do zakładek albo pełna instrukcja (planowanie na webie, telefon w trasie, role).</ThemedText>
                <Button label="Pokaż wprowadzenie" onPress={onIntro} />
                <Button label="Pełna instrukcja (web)" onPress={openHelp} />
              </ThemedView>

              <ThemedText type="smallBold">Wersja aplikacji</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {Constants.expoConfig?.name ?? 'Expedition Planner'} {Constants.expoConfig?.version ?? ''}
              </ThemedText>
              <UpdateCard />
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  content: { padding: Spacing.three, gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
});
