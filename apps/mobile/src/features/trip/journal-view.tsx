import { instantToZoned, journalDroppedTime, journalMovedTime, journalRedated, journalTimeAt, plural, type TripDocument, zonedToInstant } from '@expeditionplan/core';
import { type CachedTrip, removeJournalEntry, saveJournalEntry, uuidv7 } from '@expeditionplan/sync';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { Image } from 'expo-image';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, Animated, type GestureResponderHandlers, PanResponder, Pressable, type StyleProp, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

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
 * Po powrocie cała relacja jest na webie („Dziennik”). `ItemPhotos` to samo w szczegółach punktu planu: wpisy
 * z `item_id` tego punktu, dodawane z jego dniem. Wpis zmienia autor, a cudzy organizator i edytor (`EntryCard`:
 * tekst, dzień, godzina, „Usuń zdjęcie”, ↑ / ↓, przeciąganie za „≡” w obrębie dnia) — przez outbox, cały wiersz jak
 * przy dodaniu.
 */

type Props = {
  trip: CachedTrip;
  tripId: string;
  signedIn: boolean;
  userId: string | null;
  canEditAll: boolean;
  onChanged: () => void;
  /** Przeciąganie wpisu trwa — rodzic wyłącza wtedy przewijanie, żeby nie zabrało gestu. */
  onDragging?: (active: boolean) => void;
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

function Journal({ trip, tripId, signedIn, userId, canEditAll, onChanged, onDragging }: Props) {
  const doc = trip.state.doc;
  const entries = [...(trip.live.journal as unknown as EntryRow[])].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const travelers = trip.live.travelers as unknown as TravelerRow[];
  const author = (row: EntryRow) =>
    row.created_by == null || row.created_by === userId ? 'ja' : (travelers.find((each) => each.user_id === row.created_by)?.name ?? 'uczestnik');
  const dayOfId = new Map(doc.days.map((day) => [trip.ids[day.ref], day]));
  const itemOfId = new Map(doc.items.map((item) => [trip.ids[item.ref], item]));
  const [writing, setWriting] = useState(false);
  const [waiting, setWaiting] = useState(() => waitingPhotos());

  useEffect(() => {
    if (signedIn) void uploadPhotos().then(setWaiting, () => undefined);
  }, [signedIn]);

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
          {plural(waiting, ['zdjęcie czeka', 'zdjęcia czekają', 'zdjęć czeka'])} na internet.
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
          <DraggableEntries
            rows={group.rows}
            onDragging={onDragging}
            onDrop={(from, to) => {
              const row = group.rows[from];
              const takenAt = journalDroppedTime(group.rows.map((each) => each.taken_at), from, to);
              if (row === undefined || takenAt === null) return;
              saveJournalEntry(localDb, { id: row.id, tripId, dayId: row.day_id, itemId: row.item_id, body: row.body, photoPath: row.photo_path, takenAt });
              onChanged();
            }}
            render={(row, index, handle) => (
              <EntryCard
                row={row}
                tripId={tripId}
                trip={trip}
                tz={group.tz}
                meta={`${author(row)}${row.item_id && itemOfId.has(row.item_id) ? ` · 📍 ${itemOfId.get(row.item_id)!.title}` : ''}`}
                canEdit={signedIn && (canEditAll || author(row) === 'ja')}
                days={doc.days}
                upAt={journalMovedTime(group.rows.map((each) => each.taken_at), index, -1)}
                downAt={journalMovedTime(group.rows.map((each) => each.taken_at), index, 1)}
                handle={group.rows.length > 1 ? handle : undefined}
                onChanged={onChanged}
              />
            )}
          />
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

/**
 * Zdjęcia punktu planu w jego szczegółach: wpisy dziennika z `item_id` punktu i dodawanie nowych (dzień punktu).
 * Bez zalogowania tylko podgląd. Te same wpisy są w zakładce Dziennik.
 */
export function ItemPhotos({ trip, tripId, itemRef, userId, canEditAll, onChanged }: { trip: CachedTrip; tripId: string; itemRef: string; userId: string | null; canEditAll: boolean; onChanged?: () => void }) {
  const [writing, setWriting] = useState(false);
  const itemId = trip.ids[itemRef];
  const item = trip.state.doc.items.find((each) => each.ref === itemRef);
  const day = trip.state.doc.days.find((each) => each.ref === item?.dayRef);
  const entries = itemId === undefined ? [] : (trip.live.journal as unknown as EntryRow[]).filter((row) => row.item_id === itemId).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  if (day === undefined || (entries.length === 0 && onChanged === undefined)) return null;
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Zdjęcia{entries.length > 0 ? ` (${entries.length})` : ''}</ThemedText>
      {entries.map((row) => (
        <EntryCard
          key={row.id}
          row={row}
          tripId={tripId}
          trip={trip}
          tz={day.tz}
          canEdit={onChanged !== undefined && (canEditAll || row.created_by == null || row.created_by === userId)}
          days={[day]}
          onChanged={() => onChanged?.()}
        />
      ))}
      {onChanged !== undefined &&
        (writing ? (
          <NewEntry
            trip={trip}
            tripId={tripId}
            itemRef={itemRef}
            onDone={() => setWriting(false)}
            onSaved={() => {
              onChanged();
              void uploadPhotos().catch(() => undefined);
            }}
          />
        ) : (
          <Button small label="📷 Dodaj zdjęcie" onPress={() => setWriting(true)} />
        ))}
    </View>
  );
}

type Day = TripDocument['days'][number];

type DragProps = {
  rows: EntryRow[];
  onDrop: (from: number, to: number) => void;
  onDragging?: (active: boolean) => void;
  render: (row: EntryRow, index: number, handle: GestureResponderHandlers) => ReactNode;
};

/**
 * Wpisy jednego dnia z przeciąganiem za uchwyt „≡” (`PanResponder` + `Animated`, bez modułów natywnych). Przeciągany
 * wpis jedzie za palcem, pozostałe rozsuwają się na miejsce, po puszczeniu `onDrop(from, to)` — `to` to miejsce na
 * liście po przeniesieniu (jak w `journalDroppedTime`). Pozycje z `onLayout` (transformacja ich nie zmienia).
 */
type Drag = { from: number; to: number; step: number };

/** Ruch przeciągania wspólny dla wierszy jednego dnia (wiersz po `id` wpisu) — tylko w obsłudze gestów, nie w renderze. */
type DragEngine = { begin: (id: string) => void; move: (id: string, delta: number) => void; end: (id: string, delta: number | null) => void };

function DraggableEntries({ rows, onDrop, onDragging, render }: DragProps) {
  const layouts = useRef<{ y: number; height: number }[]>([]);
  const [dy] = useState(() => new Animated.Value(0));
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef({ onDrop, onDragging, ids: rows.map((row) => row.id) });
  useEffect(() => {
    live.current = { onDrop, onDragging, ids: rows.map((row) => row.id) };
  });

  const [engine] = useState<DragEngine>(() => {
    // Miejsce po przeniesieniu: ile innych wpisów ma środek nad środkiem przeciąganego.
    const targetFor = (from: number, delta: number) => {
      const own = layouts.current[from];
      if (own === undefined) return from;
      const center = own.y + own.height / 2 + delta;
      let to = 0;
      for (let index = 0; index < live.current.ids.length; index++) {
        const each = layouts.current[index];
        if (index !== from && each !== undefined && each.y + each.height / 2 < center) to += 1;
      }
      return to;
    };
    const stop = () => {
      setDrag(null);
      dy.setValue(0);
      live.current.onDragging?.(false);
    };
    const at = (id: string) => live.current.ids.indexOf(id);
    return {
      begin: (id) => {
        const index = at(id);
        if (index < 0) return;
        dy.setValue(0);
        setDrag({ from: index, to: index, step: (layouts.current[index]?.height ?? 0) + Spacing.two });
        live.current.onDragging?.(true);
      },
      move: (id, delta) => {
        const index = at(id);
        if (index < 0) return;
        dy.setValue(delta);
        const to = targetFor(index, delta);
        setDrag((current) => (current === null || current.to === to ? current : { ...current, to }));
      },
      end: (id, delta) => {
        const index = at(id);
        const to = delta === null || index < 0 ? index : targetFor(index, delta);
        stop();
        if (index >= 0 && to !== index) live.current.onDrop(index, to);
      },
    };
  });

  // Przesunięcie pozostałych: o wysokość przeciąganego (z odstępem) w stronę zwolnionego miejsca.
  const shift = (index: number) => {
    if (drag === null || index === drag.from) return 0;
    const among = index < drag.from ? index : index - 1;
    const placed = among < drag.to ? among : among + 1;
    return placed === index ? 0 : placed > index ? drag.step : -drag.step;
  };

  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <DragRow
          key={row.id}
          id={row.id}
          engine={engine}
          onLayout={(layout) => {
            layouts.current[index] = layout;
          }}
          style={drag?.from === index ? [styles.dragged, { transform: [{ translateY: dy }] }] : shift(index) !== 0 ? { transform: [{ translateY: shift(index) }] } : undefined}>
          {(handle) => render(row, index, handle)}
        </DragRow>
      ))}
    </View>
  );
}

type DragRowProps = {
  id: string;
  engine: DragEngine;
  onLayout: (layout: { y: number; height: number }) => void;
  style: StyleProp<ViewStyle> | Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  children: (handle: GestureResponderHandlers) => ReactNode;
};

/** Jeden wiersz: własny `PanResponder` na całe życie wiersza; miejsce na liście silnik znajduje po `id`. */
function DragRow({ id, engine, onLayout, style, children }: DragRowProps) {
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => engine.begin(id),
      onPanResponderMove: (_, gesture) => engine.move(id, gesture.dy),
      onPanResponderRelease: (_, gesture) => engine.end(id, gesture.dy),
      onPanResponderTerminate: () => engine.end(id, null),
    }),
  );
  return (
    <Animated.View onLayout={(event) => onLayout({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })} style={style}>
      {children(responder.panHandlers)}
    </Animated.View>
  );
}

type CardProps = {
  row: EntryRow;
  trip: CachedTrip;
  tripId: string;
  /** Strefa dnia, w którym wpis stoi. */
  tz: string;
  /** Po godzinie: autor, punkt planu. */
  meta?: string;
  canEdit: boolean;
  /** Dni do przepięcia (wybór, gdy kilka) i do liczenia godziny. */
  days: Day[];
  upAt?: string | null;
  downAt?: string | null;
  /** Uchwyt do przeciągania (`DraggableEntries`); bez niego wpisu się nie przeciąga. */
  handle?: GestureResponderHandlers;
  onChanged: () => void;
};

type Changes = { body?: string; dayId?: string | null; photoPath?: null; takenAt?: string };

/**
 * Wpis dziennika z poprawianiem: ↑ / ↓ przesuwa jego czas za sąsiada (kolejność to `taken_at`, `journalMovedTime`),
 * „Edytuj” — tekst, dzień (godzina zostaje, data nowa: `journalRedated`), godzina, „Usuń zdjęcie” (plik zostaje
 * w buckecie). Zapis offline przez outbox jak nowy wpis.
 */
function EntryCard({ row, trip, tripId, tz, meta, canEdit, days, upAt = null, downAt = null, handle, onChanged }: CardProps) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const save = (changes: Changes) => {
    saveJournalEntry(localDb, {
      id: row.id,
      tripId,
      dayId: changes.dayId !== undefined ? changes.dayId : row.day_id,
      itemId: row.item_id,
      body: changes.body ?? row.body,
      photoPath: changes.photoPath !== undefined ? changes.photoPath : row.photo_path,
      takenAt: changes.takenAt ?? row.taken_at,
    });
    onChanged();
  };
  const remove = () =>
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
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {row.photo_path && <Photo path={row.photo_path} />}
      {editing ? (
        <EntryEdit
          row={row}
          trip={trip}
          tz={tz}
          days={days}
          onCancel={() => setEditing(false)}
          onSave={(changes) => {
            save(changes);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {row.body !== '' && <ThemedText>{row.body}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">
            {hm(row.taken_at, tz)}
            {meta ? ` · ${meta}` : ''}
          </ThemedText>
          {canEdit && (
            <View style={styles.wrap}>
              {handle && (
                <View {...handle} hitSlop={8} accessibilityLabel="Przeciągnij, żeby zmienić kolejność" style={[styles.handle, { borderColor: theme.backgroundSelected }]}>
                  <ThemedText type="smallBold">≡</ThemedText>
                </View>
              )}
              {upAt !== null && <Button small label="↑" onPress={() => save({ takenAt: upAt })} />}
              {downAt !== null && <Button small label="↓" onPress={() => save({ takenAt: downAt })} />}
              <Button small label="Edytuj" onPress={() => setEditing(true)} />
              <Button small danger label="Usuń" onPress={remove} />
            </View>
          )}
        </>
      )}
    </ThemedView>
  );
}

type EditProps = { row: EntryRow; trip: CachedTrip; tz: string; days: Day[]; onCancel: () => void; onSave: (changes: Changes) => void };

function EntryEdit({ row, trip, tz, days, onCancel, onSave }: EditProps) {
  const theme = useTheme();
  const startTime = hm(row.taken_at, tz);
  const [body, setBody] = useState(row.body);
  const [dayRef, setDayRef] = useState(() => days.find((day) => trip.ids[day.ref] === row.day_id)?.ref);
  const [time, setTime] = useState(startTime);
  const [dropPhoto, setDropPhoto] = useState(false);
  const save = () => {
    if (body.trim() === '' && (row.photo_path === null || dropPhoto)) return Alert.alert('Pusty wpis', 'Wpis bez tekstu i zdjęcia — usuń cały wpis.');
    const day = days.find((each) => each.ref === dayRef);
    const dayId = day === undefined ? row.day_id : (trip.ids[day.ref] ?? row.day_id);
    let takenAt = row.taken_at;
    // Nowa godzina — w (nowym) dniu; sam nowy dzień — ta sama godzina z nową datą.
    if (day !== undefined && time.trim() !== startTime) {
      const at = journalTimeAt(day, time);
      if (at === null) return Alert.alert('Zła godzina', 'Wpisz godzinę jako GG:MM, np. 14:30.');
      takenAt = at;
    } else if (day !== undefined && dayId !== row.day_id) takenAt = journalRedated(row.taken_at, tz, day);
    onSave({ body: body.trim(), dayId, takenAt, ...(dropPhoto ? { photoPath: null } : {}) });
  };
  return (
    <>
      <TextInput
        value={body}
        onChangeText={setBody}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        placeholder="Co się wydarzyło?"
        placeholderTextColor={theme.textSecondary}
        multiline
        maxLength={4000}
      />
      {days.length > 1 && (
        <View style={styles.wrap}>
          {days.map((day, index) => (
            <Chip key={day.ref} active={dayRef === day.ref} label={`Dzień ${index + 1}`} onPress={() => setDayRef(day.ref)} />
          ))}
        </View>
      )}
      {dayRef !== undefined && (
        <View style={styles.wrap}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Godzina
          </ThemedText>
          <TextInput
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            placeholder="GG:MM"
            placeholderTextColor={theme.textSecondary}
            style={[styles.time, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
        </View>
      )}
      {row.photo_path !== null && <Button small danger={!dropPhoto} label={dropPhoto ? 'Zostaw zdjęcie' : 'Usuń zdjęcie'} onPress={() => setDropPhoto(!dropPhoto)} />}
      {dropPhoto && (
        <ThemedText type="small" themeColor="textSecondary">
          Zdjęcie zniknie z wpisu po zapisaniu.
        </ThemedText>
      )}
      <View style={styles.meta}>
        <Pressable onPress={onCancel} hitSlop={8}>
          <ThemedText type="linkPrimary">Anuluj</ThemedText>
        </Pressable>
        <Button small variant="primary" label="Zapisz" onPress={save} />
      </View>
    </>
  );
}

/** „2026:10:24 14:37:05” z EXIF galerii → data i godzina; bez niej `null`. */
function exifMoment(exif: Record<string, unknown> | null | undefined): { date: string; time: string } | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  const match = typeof raw === 'string' ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(raw) : null;
  return match && match[1] !== '0000' ? { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` } : null;
}

/** Dzień wpisu: dzisiejszy, jeśli wyjazd trwa, inaczej pierwszy. */
function todayRef(trip: CachedTrip): string | undefined {
  const now = Date.now();
  const days = trip.state.doc.days;
  return (days.find((day) => instantToZoned(now, day.tz).date === day.date) ?? days[0])?.ref;
}

/** `itemRef` — wpis przy punkcie planu, w jego dniu (bez wyboru dnia). */
function NewEntry({ trip, tripId, itemRef, onDone, onSaved }: { trip: CachedTrip; tripId: string; itemRef?: string; onDone: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const [body, setBody] = useState('');
  const itemDay = itemRef === undefined ? undefined : trip.state.doc.items.find((each) => each.ref === itemRef)?.dayRef;
  const [dayRef, setDayRef] = useState(() => itemDay ?? todayRef(trip));
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string; extension: string; taken: { date: string; time: string } | null } | null>(null);
  const days = trip.state.doc.days;

  // Aparat albo galeria; kompresja JPEG (0.7) — kilkaset KB zamiast kilku MB do wysłania.
  const pick = async (source: 'camera' | 'library') => {
    if (source === 'camera' && !(await requestCameraPermissionsAsync()).granted) return Alert.alert('Brak dostępu do aparatu', 'Zezwól aplikacji na aparat w ustawieniach telefonu.');
    // EXIF tylko z galerii: zdjęcie dodane później dostaje czas zrobienia, nie zapisu.
    const options = { mediaTypes: ['images' as const], quality: 0.7, exif: source === 'library' };
    const result = source === 'camera' ? await launchCameraAsync(options) : await launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) return;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extension = (asset.fileName?.split('.').pop() ?? mimeType.split('/')[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
    if ((asset.fileSize ?? 0) > 15 * 1024 * 1024) return Alert.alert('Za duże zdjęcie', 'Zdjęcie może mieć najwyżej 15 MB.');
    setPhoto({ uri: asset.uri, mimeType, extension, taken: exifMoment(asset.exif) });
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
    // Czas z EXIF, gdy zdjęcie jest z dnia wyjazdu (przy punkcie — tylko z jego dnia); wtedy też ten dzień.
    const taken = photo?.taken ?? null;
    const exifDay = taken === null ? undefined : days.find((day) => day.date === taken.date && (itemRef === undefined || day.ref === dayRef));
    const entryDay = exifDay?.ref ?? dayRef;
    const takenAt = exifDay !== undefined && taken !== null ? new Date(zonedToInstant(exifDay.date, taken.time, exifDay.tz)).toISOString() : undefined;
    saveJournalEntry(localDb, { id, tripId, dayId: entryDay === undefined ? null : (trip.ids[entryDay] ?? null), itemId: itemRef === undefined ? null : (trip.ids[itemRef] ?? null), body: body.trim(), photoPath, ...(takenAt ? { takenAt } : {}) });
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
      {days.length > 0 && itemRef === undefined && (
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
  label: { alignSelf: 'center' },
  handle: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center' },
  dragged: { zIndex: 10, elevation: 8, opacity: 0.92 },
  time: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, fontSize: 16, minWidth: 80 },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
});
