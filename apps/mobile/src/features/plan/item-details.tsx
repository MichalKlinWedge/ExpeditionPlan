import {
  type EatOutEdit,
  flightLine,
  flightOf,
  GUIDE_SITE,
  guideLinkTargets,
  type GuideRow,
  guideFor,
  type GuideSegment,
  guideText,
  itemIcon,
  legLabel,
  transitDetails,
  legRouteLink,
  stopsLabel,
  linkGuideText,
  lodgingDetails,
  type PlanItem as Item,
  speechParts,
  mealEateries,
} from '@expeditionplan/core';
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
import { EateriesCard } from '@/features/plan/eateries-card';
import { BookingSheet } from '@/features/plan/booking-sheet';
import { ItemFactsCard } from '@/features/plan/item-facts';
import { type PlanChoice, PlanPlace } from '@/features/plan/plan-place';
import { TrackCard } from '@/features/plan/track-card';

/**
 * Szczegóły punktu na telefonie: miejsce z „Nawiguj”, opis, notatki, linki i przewodnik
 * (opis, ciekawostki, historia, zdjęcia z Commons). Tekst przewodnika jest w bazie telefonu —
 * offline zawsze; zdjęcia z pamięci podręcznej (pobierane po synchronizacji, `prefetchGuideImages`).
 * Nazwy innych opisanych miejsc w treści są odnośnikami — przejście do ich szczegółów, „← Wstecz” wraca.
 * „Posłuchaj” czyta przewodnik syntezatorem mowy telefonu (`expo-speech`, offline, jeśli telefon
 * ma polski głos); zamknięcie szczegółów przerywa czytanie.
 */

/** Limit kawałka tekstu dla syntezatora telefonu. */
const SPEECH_LIMIT = Math.min(Speech.maxSpeechInputLength || 4000, 3500);

type Props = {
  trip: CachedTrip;
  item: Item | null;
  onClose: () => void;
  /** Od razu czytaj przewodnik (powiadomienie ze spaceru). */
  autoPlay?: boolean;
  /** Dokumenty punktu na karcie (bez — sama cena, płatność i kontakty). */
  tripId?: string;
  online?: boolean;
  /** Zapis knajp wybranych przy posiłku („Knajpy w pobliżu”); bez — sama lista. */
  onSaveEatOut?: (edit: EatOutEdit) => Promise<void>;
  /** Z okna rezerwacji: kontakty wyjazdu w zakładce Info. */
  onContacts?: () => void;
  /** Przy posiłku: knajpa prowadzi do tego posiłku w zakładce Posiłki (szczegóły się zamykają). */
  onMeal?: (itemRef: string) => void;
  /** Wybór z planu (scenariusz, warianty) — godziny i sąsiednie punkty jak w planie. Bez — domyślne warianty. */
  plan?: PlanChoice;
};

/** Przewodnik punktu z wierszy `audio_guides` telefonu. */
export function itemGuide(trip: CachedTrip, item: Item) {
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  return guideFor(trip.live.guides as unknown as GuideRow[], trip.ids[item.ref], placeRef === undefined ? undefined : trip.ids[placeRef]);
}

/** Miejsca z przewodnikiem: `placeRef` → pierwszy punkt w tym miejscu (do kart pinezek na mapach). */
export function guidedPlaces(trip: CachedTrip): Map<string, Item> {
  const places = new Map<string, Item>();
  for (const item of trip.state.doc.items) {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    if (placeRef !== undefined && !places.has(placeRef) && itemGuide(trip, item) !== null) places.set(placeRef, item);
  }
  return places;
}

/** Zdjęcia przewodników do pamięci podręcznej, póki jest sieć — na trasie będą offline. */
/** Miniatury zdjęć wszystkich przewodników wyjazdu (do pamięci podręcznej — offline). */
export function guideImageUrls(trip: CachedTrip): string[] {
  return (trip.live.guides as unknown as GuideRow[]).flatMap((row) => {
    const images = (row.content as { images?: { thumbUrl?: string }[] } | null)?.images ?? [];
    return images.flatMap((image) => (typeof image.thumbUrl === 'string' ? [image.thumbUrl] : []));
  });
}

export function prefetchGuideImages(trip: CachedTrip) {
  const urls = guideImageUrls(trip);
  if (urls.length > 0) void Image.prefetch(urls, 'disk').catch(() => undefined);
}

export function ItemDetails({ trip, item, onClose, autoPlay = false, tripId, online, onSaveEatOut, onContacts, plan, onMeal }: Props) {
  // Przejścia po odnośnikach: stos punktów nad otwartym; nowy `item` z zewnątrz zaczyna od zera.
  // „Poprzedni” / „Następny” zastępują oglądany punkt (`base` albo szczyt stosu) — „← Wróć” nadal zamyka.
  const [path, setPath] = useState<{ root: string | null; base?: Item; stack: Item[] }>({ root: null, stack: [] });
  const fresh = path.root === (item?.ref ?? null);
  const stack = fresh ? path.stack : [];
  const base = fresh ? path.base : undefined;
  const current = stack.at(-1) ?? base ?? item;
  const root = item?.ref ?? null;
  const back = () => (stack.length > 0 ? setPath({ root, base, stack: stack.slice(0, -1) }) : onClose());
  const find = (ref: string) => trip.state.doc.items.find((each) => each.ref === ref);
  const go = (ref: string) => {
    const next = find(ref);
    if (next) setPath({ root, base, stack: [...stack, next] });
  };
  const jump = (ref: string) => {
    const next = find(ref);
    if (next === undefined) return;
    setPath(stack.length > 0 ? { root, base, stack: [...stack.slice(0, -1), next] } : { root, base: next, stack: [] });
  };
  return (
    <Modal visible={item !== null} animationType="slide" onRequestClose={back}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {current !== null && (
              <Details key={current.ref} trip={trip} item={current} onBack={back} backLabel={stack.length > 0 ? '← Wstecz' : '← Wróć'} onOpen={go} autoPlay={autoPlay && stack.length === 0 && base === undefined} tripId={tripId} online={online} onSaveEatOut={onSaveEatOut} onContacts={onContacts} onMeal={onMeal} plan={plan} onJump={jump} />
            )}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

type DetailsProps = {
  trip: CachedTrip;
  item: Item;
  onBack: () => void;
  backLabel: string;
  onOpen: (ref: string) => void;
  autoPlay: boolean;
  tripId?: string;
  online?: boolean;
  onSaveEatOut?: (edit: EatOutEdit) => Promise<void>;
  onContacts?: () => void;
  /** Przy posiłku: knajpa prowadzi do tego posiłku w zakładce Posiłki (szczegóły się zamykają). */
  onMeal?: (itemRef: string) => void;
  plan?: PlanChoice;
  onJump: (ref: string) => void;
};

function Details({ trip, item, onBack, backLabel, onOpen, autoPlay, tripId, online, onSaveEatOut, onContacts, plan, onJump, onMeal }: DetailsProps) {
  const doc = trip.state.doc;
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const flight = flightOf(doc, item);
  const leg = legLabel(item) ?? stopsLabel(item);
  const route = legRouteLink(doc, item);
  // Przy noclegu zamiast przewodnika są dane obiektu.
  const guide = item.kind === 'lodging' ? null : itemGuide(trip, item);
  const notes = doc.notes.filter((note) => note.scope === 'item' && note.targetRef === item.ref).map((note) => (note.title ? `${note.title}: ${note.body}` : note.body));
  const open = (url: string) => void Linking.openURL(url);
  const targets = guide === null ? [] : guideLinkTargets(doc, trip.live.guides as unknown as GuideRow[], trip.ids, item.ref);
  const used = new Set<string>();
  const linked = (text: string) => <Linked segments={linkGuideText(text, targets, used)} onOpen={onOpen} />;
  const [speaking, setSpeaking] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
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
    const parts = speechParts(`${guide.title}.\n\n${guideText(guide)}`, SPEECH_LIMIT);
    const finished = () => setSpeaking(false);
    parts.forEach((part, i) =>
      Speech.speak(part, { language: 'pl-PL', rate: 0.95, ...(i === parts.length - 1 ? { onDone: finished } : {}), onStopped: finished, onError: finished }),
    );
    setSpeaking(true);
  };
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setTimeout(listen, 300);
    return () => clearTimeout(timer);
    // Tylko przy otwarciu z powiadomienia — `listen` zmienia się z każdym renderem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={12}>
          <ThemedText type="linkPrimary">{backLabel}</ThemedText>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">
          {itemIcon(doc, item)} {item.title}
        </ThemedText>
        <PlanPlace trip={trip} item={item} plan={plan} onJump={onJump} />
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
        {transitDetails(item).map((line) => (
          <ThemedText key={line} type="small">
            {line}
          </ThemedText>
        ))}
        {route && (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button small label={route.label} onPress={() => open(route.url)} />
          </View>
        )}
        {flight && <ThemedText type="smallBold">✈ {flightLine(flight)}</ThemedText>}
        {item.description && <ThemedText>{item.description}</ThemedText>}
        {item.kind === 'lodging' &&
          lodgingDetails(doc, item).map((line) => (
            <ThemedText key={line} type="small">
              {line}
            </ThemedText>
          ))}
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
        <ItemFactsCard trip={trip} item={item} tripId={tripId} online={online} onBooking={setBooking} />
        <BookingSheet trip={trip} bookingRef={booking} onClose={() => setBooking(null)} tripId={tripId} online={online} onOpenItem={(ref) => ref !== item.ref && onOpen(ref)} onContacts={onContacts} />
        {item.kind === 'meal' && mealEateries(doc, item.ref).length > 0 && (
          <View style={styles.eateries}>
            <ThemedText type="smallBold">Gdzie jemy</ThemedText>
            {mealEateries(doc, item.ref).map((eatery, _, all) => {
              const label = `${all.length > 1 && eatery.active ? '✓ ' : ''}${eatery.name}`;
              return (
                <View key={eatery.placeRef} style={styles.eatery}>
                  {onMeal ? <Button small label={label} onPress={() => onMeal(item.ref)} /> : <ThemedText type="small">{label}</ThemedText>}
                  {eatery.summary ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.eaterySummary}>
                      {eatery.summary}
                    </ThemedText>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
        {item.kind === 'meal' && !item.selfCooked && online && tripId !== undefined && <EateriesCard trip={trip} tripId={tripId} item={item} onSave={onSaveEatOut} />}
        <TrackCard doc={doc} item={item} />

        {guide !== null && (
          <View style={styles.guide}>
            <View style={styles.row}>
              <ThemedText type="smallBold" themeColor="accent" style={styles.grow}>
                PRZEWODNIK
              </ThemedText>
              <Button small variant={speaking ? 'accent' : 'secondary'} label={speaking ? '■ Zatrzymaj' : '▶ Posłuchaj'} onPress={listen} />
            </View>
            <ThemedText>{linked(guide.summary)}</ThemedText>
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
                  <ThemedText key={fact}>• {linked(fact)}</ThemedText>
                ))}
              </View>
            )}
            {guide.history && (
              <View style={styles.block}>
                <ThemedText type="smallBold">Historia</ThemedText>
                <ThemedText>{linked(guide.history)}</ThemedText>
              </View>
            )}
            {guide.tips.length > 0 && (
              <View style={styles.block}>
                <ThemedText type="smallBold">Na miejscu</ThemedText>
                {guide.tips.map((tip) => (
                  <ThemedText key={tip}>• {linked(tip)}</ThemedText>
                ))}
              </View>
            )}
            <Pressable onPress={() => open(guide.article.url)} hitSlop={6}>
              <ThemedText type="small" themeColor="textSecondary">
                {guide.article.site === 'web' ? `Na podstawie strony „${guide.article.title}”; streszczenie: AI.` : `Na podstawie artykułu „${guide.article.title}” z ${GUIDE_SITE[guide.article.site]}, licencja CC BY-SA 4.0; streszczenie: AI.`}
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

/** Kawałki tekstu przewodnika; odnośnik = zagnieżdżony tekst z dotknięciem (zawija się z resztą akapitu). */
function Linked({ segments, onOpen }: { segments: GuideSegment[]; onOpen: (ref: string) => void }) {
  return segments.map((segment, i) =>
    segment.ref ? (
      <ThemedText key={i} themeColor="accent" style={styles.link} onPress={() => onOpen(segment.ref!)}>
        {segment.text}
      </ThemedText>
    ) : (
      segment.text
    ),
  );
}

const styles = StyleSheet.create({
  eateries: { gap: Spacing.one },
  eatery: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  eaterySummary: { flexShrink: 1 },
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
  link: { textDecorationLine: 'underline', fontWeight: 600 },
});
