import Constants from 'expo-constants';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { UpdateCard } from '@/features/updates/update-notice';
import { supabase } from '@/lib/supabase';

/** Ustawienia (zębatka na Start): konto i wersja aplikacji z ręcznym sprawdzeniem aktualizacji. */
export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const session = useSession();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            <View style={styles.top}>
              <Pressable onPress={onClose} hitSlop={12}>
                <ThemedText type="linkPrimary">← Wróć</ThemedText>
              </Pressable>
              <ThemedText type="smallBold">Ustawienia</ThemedText>
            </View>
            <ScrollView contentContainerStyle={styles.content}>
              <ThemedText type="smallBold">Konto</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                {session ? (
                  <>
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

              <ThemedText type="smallBold">Wersja aplikacji</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {Constants.expoConfig?.name ?? 'Expedition Planer'} {Constants.expoConfig?.version ?? ''}
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
