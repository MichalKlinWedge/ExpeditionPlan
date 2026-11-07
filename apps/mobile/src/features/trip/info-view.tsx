import { capitalized, CONTACT_ROLE, NOTE_TOPIC } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DocumentsView } from '@/features/trip/documents-view';

/**
 * Informacje praktyczne na telefonie — offline, z planu zapisanego w SQLite: numery alarmowe
 * (jedno dotknięcie = połączenie), kontakty (gospodarz, wypożyczalnia), ważne ostrzeżenia, notatki
 * według tematów i źródła. Na webie: „Informacje praktyczne” (etap 5 AI). Zadania — osobna zakładka.
 */

const WARNING = '#b26a00';

function call(phone: string) {
  const number = phone.replace(/[^\d+]/g, '');
  Linking.openURL(`tel:${number}`).catch(() => Alert.alert('Nie można zadzwonić', phone));
}

export function InfoView({ trip, tripId, signedIn = false }: { trip: CachedTrip; tripId?: string; signedIn?: boolean }) {
  const doc = trip.state.doc;
  const emergency = doc.contacts.filter((contact) => contact.role === 'emergency');
  const others = doc.contacts.filter((contact) => contact.role !== 'emergency');
  const notes = doc.notes.filter((note) => note.scope === 'trip' && note.kind !== 'slack_audit' && note.kind !== 'rationale');
  const important = notes.filter((note) => note.kind === 'warning' || note.kind === 'safety');
  const rest = notes.filter((note) => !important.includes(note));
  const topics = [...new Set(rest.map((note) => note.topic ?? 'other'))].sort((a, b) => Object.keys(NOTE_TOPIC).indexOf(a) - Object.keys(NOTE_TOPIC).indexOf(b));
  const bookingTitle = (ref: string | undefined) => (ref === undefined ? undefined : doc.bookings.find((booking) => booking.ref === ref)?.title);

  // Dokumenty i kody na górze — po nie sięga się przy bramce, w pośpiechu.
  const vault = tripId ? <DocumentsView trip={trip} tripId={tripId} online={signedIn} /> : null;
  const hasVault = trip.live.documents.length > 0 || doc.bookings.some((booking) => booking.confirmationCode);

  if (doc.contacts.length === 0 && notes.length === 0 && !hasVault) {
    return (
      <ThemedText themeColor="textSecondary" style={styles.pad}>
        Plan nie ma jeszcze informacji praktycznych. Na webie: „Informacje praktyczne” → „Przygotuj z AI”.
      </ThemedText>
    );
  }

  return (
    <View style={styles.list}>
      {vault}
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
          {others.map((contact) => (
            <View key={contact.ref} style={styles.block}>
              <View style={styles.row}>
                <ThemedText style={styles.grow}>
                  {contact.name}
                  <ThemedText type="small" themeColor="textSecondary">
                    {' '}
                    · {CONTACT_ROLE[contact.role] ?? contact.role}
                    {bookingTitle(contact.bookingRef) ? ` · ${bookingTitle(contact.bookingRef)}` : ''}
                  </ThemedText>
                </ThemedText>
                {contact.phone && (
                  <Pressable onPress={() => call(contact.phone!)} hitSlop={6}>
                    <ThemedText type="linkPrimary">{contact.phone}</ThemedText>
                  </Pressable>
                )}
              </View>
              {contact.notes ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {contact.notes}
                </ThemedText>
              ) : null}
            </View>
          ))}
        </ThemedView>
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
  pad: { paddingHorizontal: Spacing.three },
  list: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  block: { gap: Spacing.half },
});
