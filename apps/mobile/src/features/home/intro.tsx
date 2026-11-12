import 'expo-sqlite/localStorage/install';

import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_URL } from '@/lib/web-api';

/**
 * Wprowadzenie przy pierwszym uruchomieniu: kilka ekranów o tym, do czego jest która zakładka,
 * i link do pełnej instrukcji na webie (`/help`). Pokazane raz (`localStorage`); ponownie z Ustawień.
 */

const SEEN_KEY = 'intro-seen-v1';

export const introSeen = () => localStorage.getItem(SEEN_KEY) !== null;
const markSeen = () => localStorage.setItem(SEEN_KEY, new Date().toISOString());

export const openHelp = () => void Linking.openURL(`${WEB_URL}/help`);

const PAGES: { icon: string; title: string; points: string[] }[] = [
  {
    icon: '🧭',
    title: 'Plan wyjazdu w kieszeni',
    points: [
      'Wyjazd planuje się na webie (Planner Hub), a tu masz go w trasie — także bez internetu.',
      'Zaloguj się tym samym adresem e-mail, którym dołączyłeś(-aś) do wyjazdu z linku zaproszenia.',
    ],
  },
  {
    icon: '🧳',
    title: 'Wyjazdy',
    points: ['Tu są Twoje wyjazdy.', 'Przed wyjazdem, najlepiej na Wi-Fi: „Pobierz offline” — plan, mapa okolicy, dokumenty i opisy miejsc zostaną w telefonie.'],
  },
  {
    icon: '🗓',
    title: 'Plan',
    points: [
      'Plan dnia z godzinami. W dniu wyjazdu karta „Teraz”: „✓ Zrobione”, „+15 min” (zostajemy dłużej — reszta dnia się przesuwa) i „Pomiń”.',
      'Niżej: Wydatki (📷 paragon — kwotę odczyta AI), Posiłki, Zadania, Dziennik ze zdjęciami i Info (numery alarmowe).',
      '„Pula” to pomysły spoza dni — do wstawienia, gdy zmienią się plany.',
    ],
  },
  {
    icon: '🗺',
    title: 'Mapa i Spacer',
    points: [
      'Mapa działa offline; „Nawiguj” otwiera Google Maps. Długie przytrzymanie mapy dodaje miejsce do puli.',
      'Spacer z przewodnikiem: telefon powiadomi przy opisanym miejscu i przeczyta opis na głos.',
    ],
  },
  {
    icon: '🔔',
    title: 'Zawsze aktualnie',
    points: [
      'Zmiany z webu i od innych przychodzą same; „Co nowego” nad zakładkami wyjazdu pokazuje, co zmienili inni.',
      'Wydatki i wpisy zapisane bez zasięgu wyślą się, gdy wróci internet.',
      'Nowa wersja aplikacji — znaczek na Start i propozycja restartu.',
    ],
  },
];

export function Intro({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const close = () => {
    markSeen();
    setPage(0);
    onClose();
  };
  const current = PAGES[page]!;
  const last = page === PAGES.length - 1;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            <View style={styles.top}>
              <ThemedText type="small" themeColor="textSecondary">
                {page + 1} / {PAGES.length}
              </ThemedText>
              <Pressable onPress={close} hitSlop={12}>
                <ThemedText type="linkPrimary">Pomiń</ThemedText>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.content}>
              <ThemedText style={styles.icon}>{current.icon}</ThemedText>
              <ThemedText type="subtitle">{current.title}</ThemedText>
              {current.points.map((point) => (
                <ThemedText key={point}>{point}</ThemedText>
              ))}
              {last && <Button label="Pełna instrukcja (web)" onPress={openHelp} />}
            </ScrollView>
            <View style={styles.dots}>
              {PAGES.map((each, at) => (
                <View key={each.title} style={[styles.dot, { backgroundColor: at === page ? theme.accent : theme.backgroundSelected }]} />
              ))}
            </View>
            <View style={styles.bottom}>
              {page > 0 ? <Button label="← Wstecz" onPress={() => setPage(page - 1)} /> : <View />}
              <Button label={last ? 'Zaczynamy' : 'Dalej →'} variant="primary" onPress={() => (last ? close() : setPage(page + 1))} />
            </View>
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  content: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1, justifyContent: 'center' },
  icon: { fontSize: 56, lineHeight: 68 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
});
