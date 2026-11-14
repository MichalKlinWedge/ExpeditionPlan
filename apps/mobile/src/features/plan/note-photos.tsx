import { type NotePhoto, notePhotoCredit } from '@expeditionplan/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { guideImageUri } from '@/features/plan/guide-images';

/**
 * Zdjęcia przy uwagach punktu (dodawane na webie): pasek miniatur, dotknięcie pokazuje całe zdjęcie.
 * Pliki pobiera „Offline” razem ze zdjęciami przewodników (`guideImageUrls`), więc działa bez sieci.
 */
export function NotePhotos({ photos }: { photos: NotePhoto[] }) {
  const [shown, setShown] = useState<NotePhoto | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {photos.map((photo) => (
          <Pressable key={photo.url} onPress={() => setShown(photo)} style={styles.figure} accessibilityLabel={photo.caption ?? 'Zdjęcie do uwag'}>
            <Image source={{ uri: guideImageUri(photo.url) }} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
            {notePhotoCredit(photo) !== '' && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.caption}>
                {notePhotoCredit(photo)}
              </ThemedText>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={shown !== null} animationType="fade" onRequestClose={() => setShown(null)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.full} edges={['top', 'bottom']}>
            <View style={styles.top}>
              <Button label="← Wróć" onPress={() => setShown(null)} small />
            </View>
            {shown !== null && <Image source={{ uri: guideImageUri(shown.url) }} style={styles.fill} contentFit="contain" cachePolicy="disk" />}
            {shown !== null && notePhotoCredit(shown) !== '' && <ThemedText style={styles.fullCaption}>{notePhotoCredit(shown)}</ThemedText>}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  strip: { gap: Spacing.two },
  figure: { width: 200, gap: Spacing.one },
  thumb: { width: 200, height: 150, borderRadius: Spacing.two },
  caption: { fontSize: 11, lineHeight: 14 },
  full: { flex: 1, backgroundColor: '#000' },
  top: { padding: Spacing.two },
  fill: { flex: 1 },
  fullCaption: { color: '#fff', padding: Spacing.three, textAlign: 'center' },
});
