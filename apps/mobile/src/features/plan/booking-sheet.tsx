import { bookingDetails, localToday } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ContactList } from '@/features/plan/item-facts';
import { PlacePin } from '@/features/plan/place-pin';
import { DocumentsView } from '@/features/trip/documents-view';

/**
 * Rezerwacja z planu, offline: termin, kwota, warunki, punkty w pakiecie, kontakty (jedno dotknięcie =
 * połączenie) i dokumenty z sejfu. Dane z `bookingDetails` (packages/core), te same co w tabeli na webie.
 */

type Props = {
  trip: CachedTrip;
  /** `null` = zamknięte. */
  bookingRef: string | null;
  onClose: () => void;
  /** Bez `tripId` okno nie pokazuje dokumentów (pliki leżą w katalogu wyjazdu). */
  tripId?: string;
  online?: boolean;
  /** Szczegóły punktu z pakietu; okno rezerwacji zamyka się samo. */
  onOpenItem?: (itemRef: string) => void;
  /** Wszystkie kontakty wyjazdu w zakładce Info; okno rezerwacji zamyka się samo. */
  onContacts?: () => void;
};

export function BookingSheet({ trip, bookingRef, onClose, tripId, online = false, onOpenItem, onContacts }: Props) {
  const details = bookingRef === null ? null : bookingDetails(trip.state.doc, bookingRef, localToday());
  // Miejsce noclegu — pinezka otwiera je w Mapach Google.
  const place = details?.place === undefined ? undefined : trip.state.doc.places.find((each) => each.ref === details.booking.startPlaceRef);
  return (
    <Modal visible={details !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {details !== null && (
              <View style={styles.fill}>
                <View style={styles.top}>
                  <Button label="← Wróć" onPress={onClose} small />
                </View>
                <ScrollView contentContainerStyle={styles.content}>
                  <ThemedText type="subtitle">🎫 {details.booking.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {[details.kind, details.status].join(' · ')}
                  </ThemedText>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    {details.when !== '' && <ThemedText type="smallBold">{details.when}</ThemedText>}
                    {details.price !== null && <ThemedText type="small">💰 {details.price}</ThemedText>}
                    {details.line !== '' && <ThemedText type="small">{details.line}</ThemedText>}
                    {details.place !== undefined && (
                      <View style={styles.place}>
                        <ThemedText type="small" style={styles.grow}>
                          Miejsce: {details.place}
                        </ThemedText>
                        {place && <PlacePin place={place} />}
                      </View>
                    )}
                    {details.facts.map((fact) => (
                      <ThemedText key={fact} type="small" themeColor="textSecondary">
                        · {fact}
                      </ThemedText>
                    ))}
                  </ThemedView>
                  {details.items.length > 0 && (
                    <View style={styles.block}>
                      <ThemedText type="smallBold">W pakiecie</ThemedText>
                      {details.items.map((item) =>
                        onOpenItem ? (
                          <Pressable
                            key={item.ref}
                            hitSlop={6}
                            onPress={() => {
                              onClose();
                              onOpenItem(item.ref);
                            }}>
                            <ThemedText type="linkPrimary">· {item.title} ›</ThemedText>
                          </Pressable>
                        ) : (
                          <ThemedText key={item.ref} type="small">
                            · {item.title}
                          </ThemedText>
                        ),
                      )}
                    </View>
                  )}
                  {details.booking.notes.length > 0 && (
                    <View style={styles.block}>
                      {details.booking.notes.map((note) => (
                        <ThemedText key={note} type="small" themeColor="textSecondary">
                          {note}
                        </ThemedText>
                      ))}
                    </View>
                  )}
                  {details.contacts.length > 0 && (
                    <View style={styles.block}>
                      <ThemedText type="smallBold">Kontakty</ThemedText>
                      <ContactList contacts={details.contacts} />
                    </View>
                  )}
                  {onContacts && trip.state.doc.contacts.length > 0 && (
                    <Button
                      label="Kontakty wyjazdu →"
                      small
                      onPress={() => {
                        onClose();
                        onContacts();
                      }}
                      style={styles.start}
                    />
                  )}
                  {details.booking.links.length > 0 && (
                    <View style={styles.links}>
                      {details.booking.links.map((link) => (
                        <Button key={link.url} label={`${link.label} ↗`} small onPress={() => void Linking.openURL(link.url)} />
                      ))}
                    </View>
                  )}
                  {tripId !== undefined && trip.ids[details.booking.ref] !== undefined && <DocumentsView trip={trip} tripId={tripId} online={online} only={{ bookingId: trip.ids[details.booking.ref] }} />}
                </ScrollView>
              </View>
            )}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  content: { gap: Spacing.three, padding: Spacing.four, paddingTop: 0 },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  block: { gap: Spacing.one },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  start: { alignSelf: 'flex-start' },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
