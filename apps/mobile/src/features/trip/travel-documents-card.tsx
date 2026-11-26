import { ID_DOCUMENT, ID_DOCUMENT_VALID, type IdDocument, idDocumentProblem, localToday, type TripDocument } from '@expeditionplan/core';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Ważność paszportu, dowodu i EKUZ uczestników — offline, z planu zapisanego w telefonie (te same
 * ostrzeżenia co „Gotowość do wyjazdu” na webie, `core/travel-documents.ts`). Same daty, bez numerów;
 * wpisuje się je na webie w „Uczestnikach”. Bez żadnej daty karty nie ma.
 */

const RED = '#D92D20';
const AMBER = '#b26a00';

const dayMonthYear = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

export function TravelDocumentsCard({ doc }: { doc: TripDocument }) {
  const today = localToday();
  const people = doc.travelers
    .map((person) => ({
      person,
      docs: (
        [
          ['passport', person.passportUntil],
          ['id_card', person.idCardUntil],
          ['ekuz', person.ekuzUntil],
        ] as [IdDocument, string | undefined][]
      ).filter((pair): pair is [IdDocument, string] => pair[1] !== undefined),
    }))
    .filter((each) => each.docs.length > 0);
  if (people.length === 0) return null;
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Dokumenty podróży</ThemedText>
      {people.map(({ person, docs }) => {
        const back = person.toDate ?? doc.trip.endDate;
        return (
          <View key={person.ref} style={styles.block}>
            <ThemedText type="small">{person.name}</ThemedText>
            {docs.map(([document, until]) => {
              const found = idDocumentProblem(document, until, back, today);
              return (
                <ThemedText
                  key={document}
                  type="small"
                  themeColor={found === null ? 'textSecondary' : undefined}
                  style={found === null ? undefined : { color: found.problem === 'short_margin' ? AMBER : RED }}>
                  {found === null ? `${ID_DOCUMENT[document]} ${ID_DOCUMENT_VALID[document]} do ${dayMonthYear(until)}` : `⚠ ${found.text}`}
                </ThemedText>
              );
            })}
          </View>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  block: { gap: Spacing.half },
});
