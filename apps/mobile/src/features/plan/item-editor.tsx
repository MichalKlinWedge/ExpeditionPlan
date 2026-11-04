import { type KindChoice, kindChoice, kindChoices, kindPatch, type PlanItem as Item, type TripDocument } from '@expeditionplan/core';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Edycja punktu na telefonie: nazwa, rodzaj, godzina i czas trwania. Pełny edytor (precyzja
 * godziny, przedziały, bufor, priorytet) jest na webie — tu godzina inna niż „dokładnie” zostaje
 * nietknięta, dopóki pole się nie zmieni.
 */

export const KIND: Record<string, string> = {
  visit: 'zwiedzanie',
  activity: 'aktywność',
  meal: 'posiłek',
  transport: 'przejazd',
  lodging: 'nocleg',
  errand: 'sprawa',
  meetup: 'spotkanie',
  free: 'czas wolny',
  decision: 'decyzja',
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export type ItemFields = Pick<Item, 'title' | 'kind'> & Partial<Item>;

type EditorProps = {
  /** `null` = nowy punkt. */
  item: Item | null;
  visible: boolean;
  onCancel: () => void;
  onSave: (fields: ItemFields) => void;
};

function timeText(item: Item | null): string {
  const time = item?.time;
  return time && 'start' in time && time.start ? time.start : '';
}

export function ItemEditor({ item, visible, onCancel, onSave }: EditorProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {visible && <Form key={item?.ref ?? 'new'} item={item} onCancel={onCancel} onSave={onSave} />}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Form({ item, onCancel, onSave }: Omit<EditorProps, 'visible'>) {
  const theme = useTheme();
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<KindChoice>(item === null ? 'visit' : kindChoice(item));
  const [time, setTime] = useState(timeText(item));
  const [duration, setDuration] = useState(item?.durationMin?.toString() ?? (item === null ? '60' : ''));
  const [stops, setStops] = useState(item?.stopsMin?.toString() ?? '');
  const [selfCooked, setSelfCooked] = useState(item?.selfCooked === true);
  const [problem, setProblem] = useState('');
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  const save = () => {
    if (title.trim() === '') return setProblem('Podaj nazwę punktu.');
    if (time.trim() !== '' && !HHMM.test(time.trim())) return setProblem('Godzina w formacie GG:MM, np. 09:30.');
    if (duration.trim() !== '' && !(Number(duration) >= 0)) return setProblem('Czas trwania w minutach.');
    if (stops.trim() !== '' && !(Number(stops) >= 0)) return setProblem('Postoje i przerwy w minutach.');
    const chosen = kindPatch(item, kind);
    const fields: ItemFields = {
      title: title.trim(),
      ...chosen,
      // Bez szczegółów przejazdu czas drogi zostaje czasem punktu.
      durationMin: duration.trim() === '' ? (chosen.leg === undefined ? item?.leg?.durationMin : undefined) : Math.round(Number(duration)),
      stopsMin: Math.round(Number(stops)) || undefined,
      selfCooked: kind === 'meal' && selfCooked ? true : undefined,
    };
    // Godzina zmienia się tylko, gdy zmieniło się pole — inaczej zostaje precyzja z planu (pora dnia, przedział…).
    if (time.trim() !== timeText(item)) {
      const tz = item?.time && 'tz' in item.time ? item.time.tz : undefined;
      const start = time.trim().padStart(5, '0');
      fields.time = time.trim() === '' ? undefined : { precision: 'exact', start, ...(tz ? { tz } : {}) };
    }
    onSave(fields);
  };

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <ThemedText type="linkPrimary">Anuluj</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.title}>
          {item === null ? 'Nowy punkt' : 'Edycja punktu'}
        </ThemedText>
        <Pressable onPress={save} hitSlop={12}>
          <ThemedText type="linkPrimary">Zapisz</ThemedText>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="small" themeColor="textSecondary">
          Nazwa
        </ThemedText>
        <TextInput value={title} onChangeText={setTitle} style={input} placeholder="np. Ogrody Majorelle" placeholderTextColor={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Rodzaj
        </ThemedText>
        <View style={styles.wrap}>
          {kindChoices(KIND).map(([key, name]) => (
            <Pressable
              key={key}
              onPress={() => setKind(key)}
              style={[styles.chip, { borderColor: kind === key ? theme.text : theme.backgroundSelected, backgroundColor: kind === key ? theme.backgroundSelected : 'transparent' }]}>
              <ThemedText type="small" themeColor={kind === key ? 'text' : 'textSecondary'}>
                {name}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {kind === 'meal' && (
          <Pressable
            onPress={() => setSelfCooked(!selfCooked)}
            style={[styles.chip, styles.self, { borderColor: selfCooked ? theme.text : theme.backgroundSelected, backgroundColor: selfCooked ? theme.backgroundSelected : 'transparent' }]}>
            <ThemedText type="small" themeColor={selfCooked ? 'text' : 'textSecondary'}>
              {selfCooked ? '☑' : '☐'} 🍳 gotujemy sami (porcje i zakupy)
            </ThemedText>
          </Pressable>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          Godzina (puste = zaraz po poprzednim)
        </ThemedText>
        <TextInput value={time} onChangeText={setTime} style={input} placeholder="GG:MM" placeholderTextColor={theme.textSecondary} keyboardType="numbers-and-punctuation" />
        <ThemedText type="small" themeColor="textSecondary">
          Czas trwania (minuty)
        </ThemedText>
        <TextInput value={duration} onChangeText={setDuration} style={input} keyboardType="number-pad" />
        <ThemedText type="small" themeColor="textSecondary">
          Postoje, przerwy (minuty, wydłużają punkt)
        </ThemedText>
        <TextInput value={stops} onChangeText={setStops} style={input} keyboardType="number-pad" />
        {problem !== '' && (
          <ThemedText type="small" style={styles.problem}>
            {problem}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          Pozostałe ustawienia (przedziały, bufor, priorytet) — w edytorze na webie.
        </ThemedText>
      </ScrollView>
    </View>
  );
}

/** Wybór dnia (albo puli) dla „Przenieś”. */
export function DayPicker({ doc, current, visible, onCancel, onPick }: { doc: TripDocument; current: string; visible: boolean; onCancel: () => void; onPick: (dayRef: string | null) => void }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="smallBold">Przenieś do…</ThemedText>
          <ScrollView>
            {doc.days
              .filter((day) => day.ref !== current)
              .map((day) => (
                <Pressable key={day.ref} onPress={() => onPick(day.ref)} style={[styles.row, { borderColor: theme.backgroundSelected }]}>
                  <ThemedText type="small">
                    {day.date}
                    {day.title ? ` — ${day.title}` : ''}
                  </ThemedText>
                </Pressable>
              ))}
            <Pressable onPress={() => onPick(null)} style={[styles.row, { borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small">do puli (poza dniami)</ThemedText>
            </Pressable>
          </ScrollView>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  self: { alignSelf: 'flex-start' },
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  title: { flex: 1, textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  problem: { color: '#d32f2f' },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: Spacing.four },
  sheet: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, maxHeight: '80%' },
  row: { paddingVertical: Spacing.three, borderBottomWidth: 1 },
});
