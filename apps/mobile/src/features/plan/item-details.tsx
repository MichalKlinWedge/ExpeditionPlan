import { flightLine, flightOf, type GuideRow, guideFor, guideText, itemIcon, legLabel, type PlanItem as Item } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { Image } from 'expo-image';
import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Szczegóły punktu na telefonie: miejsce z „Nawiguj”, opis, notatki, linki i przewodnik
 * (opis, ciekawostki, historia, zdjęcia z Commons). Tekst przewodnika jest w bazie telefonu —
 * offline zawsze; zdjęcia z pamięci podręcznej (pobierane po synchronizacji, `prefetchGuideImages`).
 * „Posłuchaj” czyta przewodnik syntezatorem mowy telefonu (`expo-speech`, offline, jeśli telefon
 * ma polski głos); zamknięcie szczegółów przerywa czytanie.
 */

/** Tekst na kawałki mieszczące się w limicie syntezatora — po akapitach, a za długie po zdaniach. */
function speechParts(text: string): string[] {
  const limit = Math.min(Speech.maxSpeechInputLength || 4000, 3500);
  return text.split(/\n\n+/).flatMap((paragraph) => {
    if (paragraph.length <= limit) return [paragraph];
    const parts: string[] = [];
    let current = '';
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if ((current + ' ' + sentence).length > limit && current !== '') {
        parts.push(current);
        current = sentence;
      } else current = current === '' ? sentence : `${current} ${sentence}`;
    }
    return current === '' ? parts : [...parts, current];
  });
}

type Props = { trip: CachedTrip; item: Item | null; onClose: () => void };

/** Przewodnik punktu z wierszy `audio_guides` telefonu. */
export function itemGuide(trip: CachedTrip, item: Item) {
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  return guideFor(trip.live.guides as unknown as GuideRow[], trip.ids[item.ref], placeRef === undefined ? undefined : trip.ids[placeRef]);
}

/** Zdjęcia przewodników do pamięci podręcznej, póki jest sieć — na trasie będą offline. */
export function prefetchGuideImages(trip: CachedTrip) {
  const urls = (trip.live.guides as unknown as GuideRow[]).flatMap((row) => {
    const images = (row.content as { images?: { thumbUrl?: string }[] } | null)?.images ?? [];
    return images.flatMap((image) => (typeof image.thumbUrl === 'string' ? [image.thumbUrl] : []));
  });
  if (urls.length > 0) void Image.prefetch(urls, 'disk').catch(() => undefined);
}

export function ItemDetails({ trip, item, onClose }: Props) {
  return (
    <Modal visible={item !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {item !== null && <Details trip={trip} item={item} onClose={onClose} />}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Details({ trip, item, onClose }: { trip: CachedTrip; item: Item; onClose: () => void }) {
  const doc = trip.state.doc;
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const flight = flightOf(doc, item);
  const leg = legLabel(item);
  const guide = itemGuide(trip, item);
  const notes = doc.notes.filter((note) => note.scope === 'item' && note.targetRef === item.ref).map((note) => (note.title ? `${note.title}: ${note.body}` : note.body));
  const open = (url: string) => void Linking.openURL(url);
  const [speaking, setSpeaking] = useState(false);
  useEffect(
    () => () => {
      void Speech.stop();
    },
    [],
  );
  const listen = () => {
    if (guide === null) return;
    void Speech.stop();
    if (speaking) return setSpeaking(false);
    const parts = speechParts(`${guide.title}.\n\n${guideText(guide)}`);
    const finished = () => setSpeaking(false);
    parts.forEach((part, i) =>
      Speech.speak(part, { language: 'pl-PL', rate: 0.95, ...(i === parts.length - 1 ? { onDone: finished } : {}), onStopped: finished, onError: finished }),
    );
    setSpeaking(true);
  };

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={onClose} hitSlop={12}>
          <ThemedText type="linkPrimary">← Wróć</ThemedText>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">
          {itemIcon(doc, item)} {item.title}
        </ThemedText>
        {place && (
          <View style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="smallBold">{place.name}</ThemedText>
              {place.address && (
                <ThemedText type="small" themeColor="textSecondary">
                  {place.address}
                </ThemedText>
              )}
            </View>
            {place.lat !== undefined && place.lng !== undefined && (
              <Button small variant="primary" label="Nawiguj" onPress={() => open(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`)} />
            )}
          </View>
        )}
        {leg && <ThemedText type="small">{leg}</ThemedText>}
        {flight && <ThemedText type="smallBold">✈ {flightLine(flight)}</ThemedText>}
        {item.description && <ThemedText>{item.description}</ThemedText>}
        {[...item.notes, ...notes].map((note, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary">
            • {note}
          </ThemedText>
        ))}
        {item.links.map((link) => (
          <Pressable key={link.url} onPress={() => open(link.url)} hitSlop={6}>
            <ThemedText type="linkPrimary">{link.label || link.url}</ThemedText>
          </Pressable>
        ))}

        {guide !== null && (
          <View style={styles.guide}>
            <View style={styles.row}>
              <ThemedText type="smallBold" themeColor="accent" style={styles.grow}>
                PRZEWODNIK
              </ThemedText>
              <Button small variant={speaking ? 'accent' : 'secondary'} label={speaking ? '■ Zatrzymaj' : '▶ Posłuchaj'} onPress={listen} />
            </View>
            <ThemedText>{guide.summary}</ThemedText>
            {guide.images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
                {guide.images.map((image) => (
                  <Pressable key={image.url} onPress={() => open(image.sourceUrl)} style={styles.figure}>
                    <Image source={{ uri: image.thumbUrl }} style={styles.photo} contentFit="cover" cachePolicy="disk" />
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.caption}>
                      {image.author ? `${image.author}, ` : ''}
                      {image.license}, Wikimedia Commons
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {guide.facts.length > 0 && (
              <View style={styles.block}>
                <ThemedText type="smallBold">Ciekawostki</ThemedText>
                {guide.facts.map((fact) => (
                  <ThemedText key={fact}>• {fact}</ThemedText>
                ))}
              </View>
            )}
            {guide.history && (
              <View style={styles.block}>
                <ThemedText type="smallBold">Historia</ThemedText>
                <ThemedText>{guide.history}</ThemedText>
              </View>
            )}
            {guide.tips.length > 0 && (
              <View style={styles.block}>
                <ThemedText type="smallBold">Na miejscu</ThemedText>
                {guide.tips.map((tip) => (
                  <ThemedText key={tip}>• {tip}</ThemedText>
                ))}
              </View>
            )}
            <Pressable onPress={() => open(guide.article.url)} hitSlop={6}>
              <ThemedText type="small" themeColor="textSecondary">
                Na podstawie artykułu „{guide.article.title}” z Wikipedii, licencja CC BY-SA 4.0; streszczenie: AI.
              </ThemedText>
            </Pressable>
          </View>
        )}
        {guide === null && (
          <ThemedText type="small" themeColor="textSecondary">
            Brak przewodnika — organizator może go przygotować na webie (karta punktu → „Przygotuj opis z Wikipedii”).
          </ThemedText>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  content: { gap: Spacing.three, padding: Spacing.four, paddingTop: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  guide: { gap: Spacing.three, marginTop: Spacing.two },
  block: { gap: Spacing.one },
  images: { gap: Spacing.two },
  figure: { width: 260, gap: Spacing.one },
  photo: { width: 260, height: 195, borderRadius: Spacing.two },
  caption: { fontSize: 11, lineHeight: 14 },
});
