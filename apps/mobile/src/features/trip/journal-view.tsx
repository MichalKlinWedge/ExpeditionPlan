import { instantToZoned } from '@expeditionplan/core';
import { type CachedTrip, removeJournalEntry, saveJournalEntry, uuidv7 } from '@expeditionplan/sync';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { keepPhoto, photoUri, uploadPhotos, waitingPhotos } from '@/features/trip/journal-photos';
import { useTheme } from '@/hooks/use-theme';
import { localDb } from '@/lib/local-db';

/**
 * Dziennik wyjazdu: krótki wpis i zdjęcie przy dniu — zapis offline (outbox), zdjęcie wysyła się,
 * gdy jest sieć. Wpis dodaje każdy uczestnik; usuwa autor albo organizator i edytor (RLS).
 * Po powrocie cała relacja jest na webie („Dziennik”).
 */

type Props = {
  trip: CachedTrip;
  tripId: string;
  signedIn: boolean;
  userId: string | null;
  canEditAll: boolean;
  onChanged: () => void;
};

type EntryRow = { id: string; day_id: string | null; item_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by?: string | null };
type TravelerRow = { name: string; user_id: string | null };

const hm = (iso: string, tz: string) => instantToZoned(Date.parse(iso), tz).time;

/** Dziennik z bezpiecznikiem — błąd widoku pokazuje się zamiast zamykać aplikację. */
export function JournalView(props: Props) {
  return (
    <ErrorBoundary label="Dziennik">
      <Journal {...props} />
    </ErrorBoundary>
  );
}

function Journal({ trip, tripId, signedIn, userId, canEditAll, onChanged }: Props) {
  const doc = trip.state.doc;
  const entries = [...(trip.live.journal as unknown as EntryRow[])].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const travelers = trip.live.travelers as unknown as TravelerRow[];
  const author = (row: EntryRow) =>
    row.created_by == null || row.created_by === userId ? 'ja' : (travelers.find((each) => each.user_id === row.created_by)?.name ?? 'uczestnik');
  const dayOfId = new Map(doc.days.map((day) => [trip.ids[day.ref], day]));
  const [writing, setWriting] = useState(false);
  const [waiting, setWaiting] = useState(() => waitingPhotos());

  useEffect(() => {
    if (signedIn) void uploadPhotos().then(setWaiting, () => undefined);
  }, [signedIn]);

  const remove = (row: EntryRow) =>
    Alert.alert('Usunąć wpis?', row.body || 'Wpis ze zdjęciem', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          removeJournalEntry(localDb, { id: row.id, tripId, dayId: row.day_id, itemId: row.item_id, body: row.body, photoPath: row.photo_path, takenAt: row.taken_at });
          onChanged();
        },
      },
    ]);

  const groups = [
    ...doc.days.map((day, index) => ({ key: day.ref, title: `Dzień ${index + 1} · ${day.title ?? day.date}`, tz: day.tz, rows: entries.filter((row) => row.day_id === trip.ids[day.ref]) })),
    { key: 'none', title: 'Bez dnia', tz: doc.trip.primaryTz, rows: entries.filter((row) => row.day_id === null || !dayOfId.has(row.day_id)) },
  ].filter((group) => group.rows.length > 0);

  return (
    <View style={styles.stack}>
      {signedIn && !writing && <Button label="+ Nowy wpis" variant="primary" onPress={() => setWriting(true)} />}
      {signedIn && writing && (
        <NewEntry
          trip={trip}
          tripId={tripId}
          onDone={() => setWriting(false)}
          onSaved={() => {
            onChanged();
            setWaiting(waitingPhotos());
            void uploadPhotos().then(setWaiting, () => undefined);
          }}
        />
      )}
      {!signedIn && (
        <ThemedText type="small" themeColor="textSecondary">
          Zaloguj się, żeby pisać w dzienniku.
        </ThemedText>
      )}
      {waiting > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {waiting === 1 ? '1 zdjęcie czeka' : `${waiting} zdjęć czeka`} na internet.
        </ThemedText>
      )}
      {groups.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Dziennik jest pusty. Wpisy i zdjęcia z trasy złożą się po powrocie w relację dzień po dniu.
        </ThemedText>
      )}
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <ThemedText type="smallBold">{group.title}</ThemedText>
          {group.rows.map((row) => (
            <ThemedView key={row.id} type="backgroundElement" style={styles.card}>
              {row.photo_path && <Photo path={row.photo_path} />}
              {row.body !== '' && <ThemedText>{row.body}</ThemedText>}
              <View style={styles.meta}>
                <ThemedText type="small" themeColor="textSecondary">
                  {hm(row.taken_at, group.tz)} · {author(row)}
                </ThemedText>
                {signedIn && (canEditAll || author(row) === 'ja') && (
                  <Button label="Usuń" onPress={() => remove(row)} small danger />
                )}
              </View>
            </ThemedView>
          ))}
        </View>
      ))}
    </View>
  );
}

function Photo({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void photoUri(path).then(
      (found) => {
        if (cancelled) return;
        setUri(found);
        setMissing(found === null);
      },
      () => !cancelled && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (missing)
    return (
      <ThemedText type="small" themeColor="textSecondary">
        📷 zdjęcie — do obejrzenia z internetem
      </ThemedText>
    );
  if (uri === null) return null;
  return <Image source={{ uri }} style={styles.photo} contentFit="cover" cachePolicy="disk" recyclingKey={path} />;
}

/** Dzień wpisu: dzisiejszy, jeśli wyjazd trwa, inaczej pierwszy. */
function todayRef(trip: CachedTrip): string | undefined {
  const now = Date.now();
  const days = trip.state.doc.days;
  return (days.find((day) => instantToZoned(now, day.tz).date === day.date) ?? days[0])?.ref;
}

function NewEntry({ trip, tripId, onDone, onSaved }: { trip: CachedTrip; tripId: string; onDone: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const [body, setBody] = useState('');
  const [dayRef, setDayRef] = useState(() => todayRef(trip));
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string; extension: string } | null>(null);
  const days = trip.state.doc.days;

  // Aparat albo galeria; kompresja JPEG (0.7) — kilkaset KB zamiast kilku MB do wysłania.
  const pick = async (source: 'camera' | 'library') => {
    if (source === 'camera' && !(await requestCameraPermissionsAsync()).granted) return Alert.alert('Brak dostępu do aparatu', 'Zezwól aplikacji na aparat w ustawieniach telefonu.');
    const options = { mediaTypes: ['images' as const], quality: 0.7 };
    const result = source === 'camera' ? await launchCameraAsync(options) : await launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) return;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extension = (asset.fileName?.split('.').pop() ?? mimeType.split('/')[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
    if ((asset.fileSize ?? 0) > 15 * 1024 * 1024) return Alert.alert('Za duże zdjęcie', 'Zdjęcie może mieć najwyżej 15 MB.');
    setPhoto({ uri: asset.uri, mimeType, extension });
  };

  const save = () => {
    if (body.trim() === '' && photo === null) return;
    const id = uuidv7();
    const photoPath = photo === null ? null : `${tripId}/${id}/zdjecie.${photo.extension}`;
    try {
      if (photo !== null && photoPath !== null) keepPhoto(photo.uri, photoPath, photo.mimeType);
    } catch (e) {
      return Alert.alert('Nie zapisano zdjęcia', e instanceof Error ? e.message : String(e));
    }
    saveJournalEntry(localDb, { id, tripId, dayId: dayRef === undefined ? null : (trip.ids[dayRef] ?? null), body: body.trim(), photoPath });
    setBody('');
    setPhoto(null);
    onSaved();
    onDone();
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <TextInput
        value={body}
        onChangeText={setBody}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        placeholder="Co się dziś wydarzyło?"
        placeholderTextColor={theme.textSecondary}
        multiline
        maxLength={4000}
        autoFocus
      />
      {days.length > 0 && (
        <View style={styles.wrap}>
          {days.map((day, index) => (
            <Chip key={day.ref} active={dayRef === day.ref} label={`Dzień ${index + 1}`} onPress={() => setDayRef(day.ref)} />
          ))}
        </View>
      )}
      {photo !== null && <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />}
      <View style={styles.wrap}>
        <Button small label="📷 Zrób zdjęcie" onPress={() => void pick('camera')} />
        <Button small label="🖼 Z galerii" onPress={() => void pick('library')} />
        {photo !== null && <Button small label="Bez zdjęcia" onPress={() => setPhoto(null)} />}
      </View>
      <View style={styles.meta}>
        <Pressable onPress={onDone} hitSlop={8}>
          <ThemedText type="linkPrimary">Anuluj</ThemedText>
        </Pressable>
        <Button small variant="primary" label="Zapisz wpis" onPress={save} disabled={body.trim() === '' && photo === null} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  group: { gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: Spacing.two },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
});
