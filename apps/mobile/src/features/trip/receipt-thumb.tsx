import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { photoUri } from '@/features/trip/journal-photos';

/**
 * Zdjęcie paragonu przy wydatku: miniatura (plik z telefonu albo podpisany URL), dotknięcie — pełny
 * ekran. Bez sieci i bez lokalnej kopii (paragon z innego telefonu) — sama ikona.
 */
export function ReceiptThumb({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void photoUri(path).then(
      (found) => !cancelled && setUri(found),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (uri === null) return <ThemedText type="small">🧾 paragon</ThemedText>;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={6}>
        <Image source={{ uri }} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Image source={{ uri }} style={styles.full} contentFit="contain" />
          <ThemedText type="small" style={styles.hint}>
            Dotknij, żeby zamknąć
          </ThemedText>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 48, height: 48, borderRadius: Spacing.one },
  backdrop: { flex: 1, backgroundColor: '#000000E6', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  full: { width: '100%', height: '85%' },
  hint: { color: '#FFFFFF', marginTop: Spacing.two },
});
