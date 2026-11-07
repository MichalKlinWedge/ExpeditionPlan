import { CONTACT_ROLE, itemBookingRef, type ItemFacts, itemFacts, type PlanItem as Item, type TripDocument } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DocumentsView } from '@/features/trip/documents-view';

/**
 * Karta punktu w terenie (MVP-4, offline): ile zapłaci grupa i czym, rezerwacja z kontaktami
 * (jedno dotknięcie = połączenie) i dokumenty tego punktu albo jego rezerwacji — kod QR biletu
 * na pełnym ekranie, bez szukania w Info. Dane z `itemFacts` (packages/core).
 */

type Contact = TripDocument['contacts'][number];


/** Połączenie z numerem z planu (spacje, myślniki i nawiasy znikają). */
export function callPhone(phone: string) {
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => Alert.alert('Nie można zadzwonić', phone));
}

/** Kontakty z przyciskiem „Zadzwoń” (bez numeru — sama nazwa i notatka, np. „telefon nie jest podany”). */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  return (
    <>
      {contacts.map((contact) => (
        <View key={contact.ref} style={styles.contact}>
          <ThemedText type="small">
            {contact.name} <ThemedText type="small" themeColor="textSecondary">· {CONTACT_ROLE[contact.role]}</ThemedText>
          </ThemedText>
          {contact.phone ? (
            <Button label={`📞 Zadzwoń ${contact.phone}`} small onPress={() => callPhone(contact.phone!)} />
          ) : contact.email ? (
            <Button label={`✉ ${contact.email}`} small onPress={() => void Linking.openURL(`mailto:${contact.email}`)} />
          ) : null}
          {contact.notes && !contact.phone ? (
            <ThemedText type="small" themeColor="textSecondary">
              {contact.notes}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </>
  );
}

type Props = {
  trip: CachedTrip;
  item: Item;
  /** Bez `tripId` karta nie pokazuje dokumentów (pliki leżą w katalogu wyjazdu). */
  tripId?: string;
  online?: boolean;
  /** Okno rezerwacji punktu (także biletu odcinka i noclegu dnia). */
  onBooking?: (bookingRef: string) => void;
};

export function ItemFactsCard({ trip, item, tripId, online = false, onBooking }: Props) {
  const doc = trip.state.doc;
  const facts: ItemFacts = itemFacts(doc, item);
  const hasMoney = facts.price !== undefined || facts.payment !== undefined;
  const bookingId = facts.booking === undefined ? undefined : trip.ids[facts.booking.ref];
  const itemId = trip.ids[item.ref];
  const bookingRef = itemBookingRef(doc, item);
  const booking = bookingRef === undefined ? undefined : doc.bookings.find((each) => each.ref === bookingRef);
  if (!hasMoney && booking === undefined && facts.contacts.length === 0 && tripId === undefined) return null;
  return (
    <>
      {(hasMoney || booking !== undefined || facts.contacts.length > 0) && (
        <ThemedView type="backgroundElement" style={styles.card}>
          {facts.price && (
            <ThemedText type="smallBold">
              💰 {facts.price}
            </ThemedText>
          )}
          {facts.payment && <ThemedText type="small">Płatność: {facts.payment}</ThemedText>}
          {facts.priceNote && (
            <ThemedText type="small" themeColor="textSecondary">
              {facts.priceNote}
            </ThemedText>
          )}
          {booking && (
            <View style={styles.booking}>
              <ThemedText type="small">
                🎫 {booking.title}
                {booking.confirmationCode ? ` · kod ${booking.confirmationCode}` : ''}
              </ThemedText>
              {onBooking && <Button label="Szczegóły rezerwacji" small onPress={() => onBooking(booking.ref)} style={styles.start} />}
            </View>
          )}
          <ContactList contacts={facts.contacts} />
        </ThemedView>
      )}
      {tripId !== undefined && <DocumentsView trip={trip} tripId={tripId} online={online} only={{ itemId, bookingId }} />}
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  contact: { gap: Spacing.one },
  booking: { gap: Spacing.one },
  start: { alignSelf: 'flex-start' },
});
