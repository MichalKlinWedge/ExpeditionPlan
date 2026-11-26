import { ID_DOCUMENT, ID_DOCUMENT_VALID, type IdDocument, idDocumentProblem, localToday } from '@expeditionplan/core';
import { type CachedTrip, setTravelerDocuments } from '@expeditionplan/sync';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localDb } from '@/lib/local-db';

/**
 * Ważność paszportu, dowodu i EKUZ uczestników — offline, z planu zapisanego w telefonie (te same
 * ostrzeżenia co „Gotowość do wyjazdu” na webie, `core/travel-documents.ts`). Same daty, bez numerów.
 * „zmień” zapisuje przez outbox (`setTravelerDocuments`, także offline): organizator i edytor każdemu,
 * uczestnik połączony z kontem sobie i swoim dzieciom. Karty nie ma, gdy nie ma żadnej daty ani
 * osoby, której daty wolno mi zmienić.
 */

const RED = '#D92D20';
const AMBER = '#b26a00';
const DOCS: IdDocument[] = ['passport', 'id_card', 'ekuz'];
const FIELD: Record<IdDocument, 'passport_until' | 'id_card_until' | 'ekuz_until'> = { passport: 'passport_until', id_card: 'id_card_until', ekuz: 'ekuz_until' };
const LABEL: Record<IdDocument, string> = { passport: 'Paszport ważny do', id_card: 'Dowód ważny do', ekuz: 'EKUZ ważna do' };

const dayMonthYear = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** Prawdziwa data kalendarzowa RRRR-MM-DD (nie 2027-02-31). */
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

type Row = { id: string; ref?: string | null; name?: string; user_id?: string | null; guardian_id?: string | null; to_date?: string | null } & Partial<Record<(typeof FIELD)[IdDocument], string | null>>;

export function TravelDocumentsCard({
  trip,
  tripId,
  userId,
  canEditAll,
  onChanged,
}: {
  trip: CachedTrip;
  tripId?: string;
  /** Zalogowany użytkownik; `null` = tylko odczyt. */
  userId: string | null;
  canEditAll: boolean;
  onChanged?: () => void;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<IdDocument, string>>({ passport: '', id_card: '', ekuz: '' });
  const [message, setMessage] = useState('');
  const today = localToday();
  const doc = trip.state.doc;
  const order = new Map(doc.travelers.map((each, index) => [each.ref, index]));
  const rows = [...(trip.live.travelers as Row[])].sort((a, b) => (order.get(a.ref ?? '') ?? 1e6) - (order.get(b.ref ?? '') ?? 1e6));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const mayEdit = (row: Row) =>
    tripId !== undefined && userId !== null && onChanged !== undefined && (canEditAll || row.user_id === userId || (row.guardian_id != null && byId.get(row.guardian_id)?.user_id === userId));
  const people = rows
    .map((row) => ({ row, docs: DOCS.filter((document) => typeof row[FIELD[document]] === 'string').map((document) => [document, row[FIELD[document]] as string] as const) }))
    .filter((each) => each.docs.length > 0 || mayEdit(each.row));
  if (people.length === 0) return null;

  const start = (row: Row) => {
    setEditing(row.id);
    setValues({ passport: row.passport_until ?? '', id_card: row.id_card_until ?? '', ekuz: row.ekuz_until ?? '' });
    setMessage('');
  };
  const save = (row: Row) => {
    const typed = Object.fromEntries(DOCS.map((document) => [document, values[document].trim()])) as Record<IdDocument, string>;
    if (DOCS.some((document) => typed[document] !== '' && !isDate(typed[document]))) {
      setMessage('Data w formacie RRRR-MM-DD albo puste pole.');
      return;
    }
    try {
      const date = (document: IdDocument) => (typed[document] === '' ? null : typed[document]);
      setTravelerDocuments(localDb, tripId!, row.id, { passportUntil: date('passport'), idCardUntil: date('id_card'), ekuzUntil: date('ekuz') });
      setEditing(null);
      onChanged?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Dokumenty podróży</ThemedText>
      {people.map(({ row, docs }) => {
        const back = row.to_date ?? doc.trip.endDate;
        const name = row.name ?? doc.travelers.find((each) => each.ref === row.ref)?.name ?? '?';
        return (
          <View key={row.id} style={styles.block}>
            <View style={styles.row}>
              <ThemedText type="small" style={styles.grow}>
                {name}
              </ThemedText>
              {mayEdit(row) && editing !== row.id && <Button small label="zmień" onPress={() => start(row)} />}
            </View>
            {editing === row.id ? (
              <View style={styles.block}>
                {DOCS.map((document) => (
                  <View key={document} style={styles.row}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                      {LABEL[document]}
                    </ThemedText>
                    <TextInput
                      value={values[document]}
                      onChangeText={(text) => setValues({ ...values, [document]: text })}
                      keyboardType="numbers-and-punctuation"
                      maxLength={10}
                      placeholder="RRRR-MM-DD"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, styles.grow, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    />
                  </View>
                ))}
                <ThemedText type="small" themeColor="textSecondary">
                  Same daty, bez numerów. Puste pole = brak daty. U osoby z kontem data uzupełni się też w jej innych wyjazdach, gdzie pole jest puste.
                </ThemedText>
                {message !== '' && (
                  <ThemedText type="small" style={{ color: RED }}>
                    {message}
                  </ThemedText>
                )}
                <View style={styles.row}>
                  <Button small variant="primary" label="Zapisz" onPress={() => save(row)} />
                  <Button small label="Anuluj" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : docs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                brak dat
              </ThemedText>
            ) : (
              docs.map(([document, until]) => {
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
              })
            )}
          </View>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  block: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  label: { width: 130 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 15 },
});
