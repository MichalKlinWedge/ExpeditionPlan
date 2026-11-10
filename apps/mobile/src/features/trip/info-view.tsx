import { capitalized, CONTACT_ROLE, itemsOfBooking, NOTE_TOPIC } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PlacePin } from '@/features/plan/place-pin';
import { DocumentsView } from '@/features/trip/documents-view';

/**
 * Informacje praktyczne na telefonie — offline, z planu zapisanego w SQLite: numery alarmowe
 * (jedno dotknięcie = połączenie; 112 zawsze, nawet gdy plan go nie ma), kontakty (gospodarz, wypożyczalnia), ważne ostrzeżenia, notatki
 * według tematów i źródła. Na webie: „Informacje praktyczne” (etap 5 AI). Zadania — osobna zakładka.
 */

const WARNING = '#b26a00';

function call(phone: string) {
  const number = phone.replace(/[^\d+]/g, '');
  Linking.openURL(`tel:${number}`).catch(() => Alert.alert('Nie można zadzwonić', phone));
}

/**
 * `onContactsAt` dostaje położenie kontaktów w liście (przejście „Kontakty wyjazdu” z okna rezerwacji);
 * `onBooking` otwiera rezerwację kontaktu, `onOpenItem` punkt planu tej rezerwacji.
 */
export function InfoView({
  trip,
  tripId,
  signedIn = false,
  onContactsAt,
  onBooking,
  onOpenItem,
}: {
  trip: CachedTrip;
  tripId?: string;
  signedIn?: boolean;
  onContactsAt?: (y: number) => void;
  onBooking?: (bookingRef: string) => void;
  onOpenItem?: (itemRef: string) => void;
}) {
  const doc = trip.state.doc;
  // 112 zawsze pod ręką — działa w całej UE i w większości sieci komórkowych na świecie, także bez karty SIM.
  const planned = doc.contacts.filter((contact) => contact.role === 'emergency');
  const emergency = planned.some((contact) => contact.phone?.replace(/\D/g, '') === '112')
    ? planned
    : [{ ref: 'numer-112', name: 'Numer alarmowy (UE i większość krajów)', phone: '112' }, ...planned];
  const others = doc.contacts.filter((contact) => contact.role !== 'emergency');
  const notes = doc.notes.filter((note) => note.scope === 'trip' && note.kind !== 'slack_audit' && note.kind !== 'rationale');
  const important = notes.filter((note) => note.kind === 'warning' || note.kind === 'safety');
  const rest = notes.filter((note) => !important.includes(note));
  const topics = [...new Set(rest.map((note) => note.topic ?? 'other'))].sort((a, b) => Object.keys(NOTE_TOPIC).indexOf(a) - Object.keys(NOTE_TOPIC).indexOf(b));
  const bookingTitle = (ref: string | undefined) => (ref === undefined ? undefined : doc.bookings.find((booking) => booking.ref === ref)?.title);
  // Miejsce kontaktu = miejsce jego rezerwacji (nocleg), a bez niego miejsce pierwszego punktu tej rezerwacji.
  const contactPlace = (bookingRef: string | undefined) => {
    if (bookingRef === undefined) return undefined;
    const ref = doc.bookings.find((booking) => booking.ref === bookingRef)?.startPlaceRef ?? itemsOfBooking(doc, bookingRef).find((item) => item.placeRef !== undefined)?.placeRef;
    return ref === undefined ? undefined : doc.places.find((place) => place.ref === ref);
  };

  // Dokumenty i kody na górze — po nie sięga się przy bramce, w pośpiechu.
  const vault = tripId ? <DocumentsView trip={trip} tripId={tripId} online={signedIn} /> : null;
  const hasVault = trip.live.documents.length > 0 || doc.bookings.some((booking) => booking.confirmationCode);

  return (
    <View style={styles.list}>
      {doc.contacts.length === 0 && notes.length === 0 && !hasVault && (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Plan nie ma jeszcze informacji praktycznych. Na webie: „Informacje praktyczne” → „Przygotuj z AI”.
        </ThemedText>
      )}
      {vault}
      {(emergency.length > 0 || others.length > 0) && (
        <View style={styles.list} onLayout={(event) => onContactsAt?.(event.nativeEvent.layout.y)}>
          {emergency.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Numery alarmowe</ThemedText>
              {emergency.map((contact) => (
                <Pressable key={contact.ref} onPress={() => contact.phone && call(contact.phone)} disabled={!contact.phone} style={styles.row} hitSlop={6}>
                  <ThemedText style={styles.grow}>{contact.name}</ThemedText>
                  {contact.phone && <ThemedText type="linkPrimary">{contact.phone}</ThemedText>}
                </Pressable>
              ))}
            </ThemedView>
          )}

          {others.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Kontakty</ThemedText>
              {others.map((contact) => {
                const place = contactPlace(contact.bookingRef);
                return (
                  <View key={contact.ref} style={styles.block}>
                    <View style={styles.row}>
                      <ThemedText style={styles.grow}>
                        {contact.name}
                        <ThemedText type="small" themeColor="textSecondary">
                          {' '}
                          · {CONTACT_ROLE[contact.role] ?? contact.role}
                          {!onBooking && bookingTitle(contact.bookingRef) ? ` · ${bookingTitle(contact.bookingRef)}` : ''}
                        </ThemedText>
                      </ThemedText>
                      {contact.phone && (
                        <Pressable onPress={() => call(contact.phone!)} hitSlop={6}>
                          <ThemedText type="linkPrimary">{contact.phone}</ThemedText>
                        </Pressable>
                      )}
                      {place && <PlacePin place={place} />}
                    </View>
                    {onBooking && contact.bookingRef && bookingTitle(contact.bookingRef) ? (
                      <Pressable onPress={() => onBooking(contact.bookingRef!)} hitSlop={6}>
                        <ThemedText type="linkPrimary">🎫 {bookingTitle(contact.bookingRef)} ›</ThemedText>
                      </Pressable>
                    ) : null}
                    {onOpenItem && contact.bookingRef ? (
                      <View style={styles.items}>
                        {itemsOfBooking(doc, contact.bookingRef).map((item) => (
                          <Pressable key={item.ref} onPress={() => onOpenItem(item.ref)} hitSlop={4}>
                            <ThemedText type="small" themeColor="accent">
                              {item.title} ›
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {contact.notes ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {contact.notes}
                      </ThemedText>
                    ) : null}
                  </View>
                );
              })}
            </ThemedView>
          )}
        </View>
      )}

      {important.length > 0 && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold" style={{ color: WARNING }}>
            Ważne
          </ThemedText>
          {important.map((note, i) => (
            <View key={note.ref ?? `w${i}`} style={styles.block}>
              {note.title ? <ThemedText type="smallBold">{note.title}</ThemedText> : null}
              <ThemedText type="small">{note.body}</ThemedText>
            </View>
          ))}
        </ThemedView>
      )}

      {topics.map((topic) => (
        <ThemedView key={topic} type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{capitalized(NOTE_TOPIC[topic] ?? topic)}</ThemedText>
          {rest
            .filter((note) => (note.topic ?? 'other') === topic)
            .map((note, i) => (
              <View key={note.ref ?? `${topic}${i}`} style={styles.block}>
                {note.title ? <ThemedText type="smallBold">{note.title}</ThemedText> : null}
                <ThemedText type="small">{note.body}</ThemedText>
              </View>
            ))}
        </ThemedView>
      ))}

      {doc.sources.some((source) => source.url) && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Źródła (wymagają internetu)</ThemedText>
          {doc.sources
            .filter((source) => source.url)
            .map((source) => (
              <Pressable key={source.ref} onPress={() => Linking.openURL(source.url!)} hitSlop={4}>
                <ThemedText type="linkPrimary">{source.title}</ThemedText>
              </Pressable>
            ))}
        </ThemedView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  items: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  pad: { paddingHorizontal: Spacing.three },
  list: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  block: { gap: Spacing.half },
});
