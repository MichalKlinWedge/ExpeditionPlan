import {
  activeVariants as resolveVariants,
  addItem,
  addPoolItem,
  dayLodging,
  lodgingContacts,
  type DaySchedule,
  documentProblem,
  type DayWeather,
  flightLine,
  flightOf,
  instantToZoned,
  itemIcon,
  ItemInUseError,
  legLabel,
  mapCoverage,
  missingOnMap,
  moveToDay,
  moveWithinDay,
  type PlanEdit,
  type PlanItem,
  removeItemClosingGap,
  updateItem,
  proposeCuts,
  type Scenario,
  scheduleDay,
  type ScheduleWarning,
  weatherLine,
  weatherVariantHint,
} from '@expeditionplan/core';
import {
  type CachedTrip,
  cachedTrip,
  type DayEvent,
  fetchTripNews,
  markNewsSeen,
  newsRows,
  type NewsSummary,
  recordDayEvent,
  recordVariantChoice,
  refreshTrip,
  savePlanEdit,
  serialPuller,
  summarizeNews,
  type TripState,
  uuidv7,
  watchTrip,
} from '@expeditionplan/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button as AppButton } from '@/components/button';
import { Chip } from '@/components/chip';
import { Segmented, Tabs } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DayMap } from '@/features/plan/day-map';
import { ContactList } from '@/features/plan/item-facts';
import { guidedPlaces, ItemDetails, itemGuide, prefetchGuideImages } from '@/features/plan/item-details';
import { DayPicker, ItemEditor, type ItemFields, KIND } from '@/features/plan/item-editor';
import { PoolView } from '@/features/plan/pool-view';
import { TripNewsBanner } from '@/features/plan/trip-news';
import { type LastEvent, NowCard } from '@/features/plan/now-card';
import { InfoView } from '@/features/trip/info-view';
import { TasksView } from '@/features/trip/tasks-view';
import { JournalView } from '@/features/trip/journal-view';
import { scheduleTripReminders } from '@/features/trip/reminders';
import { useTripWeather } from '@/features/trip/trip-weather';
import { PackingView } from '@/features/trip/packing-view';
import { WalletView } from '@/features/trip/wallet-view';
import { useTheme } from '@/hooks/use-theme';
import { localDb, remote } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Plan dnia na telefonie. Offline: najpierw stan z SQLite (`cachedTrip`), potem synchronizacja
 * przyrostowa (`refreshTrip`) — przy otwarciu, „Odśwież”, powrocie aplikacji na pierwszy plan
 * i na żywo: Realtime daje znać o każdej zmianie wyjazdu (np. edycji na webie). Godziny liczy silnik z packages/core na telefonie. Jeden dzień na ekranie;
 * domyślnie dzisiejszy, jeśli wyjazd trwa.
 */

const SLACK: Record<string, { label: string; color: string }> = {
  large: { label: 'duży zapas', color: '#2e7d32' },
  small: { label: 'mały zapas', color: '#b26a00' },
  none: { label: 'bez zapasu', color: '#e65100' },
  negative: { label: 'dzień się nie spina', color: '#c62828' },
};

const HARD = '#d32f2f';
const SOFT = '#b26a00';

const weekday = (date: string) => {
  const text = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const hm = (instant: number | null | undefined, tz: string) => (instant == null ? '—' : instantToZoned(instant, tz).time);

/** Dzisiejszy dzień wyjazdu (data w strefie dnia), inaczej pierwszy. */
function initialDay(state: TripState): number {
  const now = Date.now();
  const today = state.doc.days.findIndex((day) => instantToZoned(now, day.tz).date === day.date);
  return Math.max(today, 0);
}

type Access = { signedIn: boolean; canAct: boolean; canAddExpense: boolean; userId: string | null };
type Props = Access & { tripId: string | null; onClose: () => void };

/** Plan w pełnoekranowym oknie nad listą wyjazdów (Start). */
export function PlanScreen({ tripId, onClose, ...access }: Props) {
  return (
    <Modal visible={tripId !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {tripId !== null && <Plan tripId={tripId} onClose={onClose} {...access} />}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

type PlanProps = {
  tripId: string;
  /** Bez logowania: tylko stan z telefonu, bez synchronizacji. */
  signedIn: boolean;
  /** Edycja planu, „Zostajemy dłużej” i „Pomiń”, pakowanie za innych — organizator i edytor (RLS). */
  canAct: boolean;
  /** Dodawanie wydatków (`can_add_expenses`). */
  canAddExpense: boolean;
  /** Zalogowany użytkownik — „ja” na liście pakowania. */
  userId: string | null;
  /** Przycisk powrotu (okno z listy wyjazdów). */
  onClose?: () => void;
  /** Miejsce na pasek zakładek. */
  bottomInset?: number;
};

/** Plan jednego wyjazdu. */
export function Plan({ tripId, signedIn, canAct, canAddExpense, userId, onClose, bottomInset = 0 }: PlanProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<'plan' | 'wallet' | 'packing' | 'tasks' | 'journal' | 'info'>('plan');
  const [trip, setTrip] = useState<CachedTrip | null>(null);
  /** „Co nowego” — zmiany innych od ostatniej wizyty (online). */
  const [news, setNews] = useState<NewsSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);
  const [editMode, setEditMode] = useState(false);
  /** Punkt otwarty w szczegółach (opis, przewodnik). */
  const [detail, setDetail] = useState<PlanItem | null>(null);
  /** Szczegóły otwarte „Posłuchaj” z mapy dnia — od razu czytanie na głos. */
  const [detailPlay, setDetailPlay] = useState(false);
  const [saving, setSaving] = useState(0);
  /** Id nowych punktów, zanim synchronizacja wpisze je do bazy telefonu. */
  const extraIds = useRef<Record<string, string>>({});
  /** Zapisy idą po kolei — kolejna zmiana może dotyczyć punktu dodanego przed chwilą. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [sync, setSync] = useState<{ busy: boolean; syncedAt?: string; error?: string }>({ busy: signedIn });
  const [invalid, setInvalid] = useState('');
  const [index, setIndex] = useState(0);
  const [scenario, setScenario] = useState<Scenario>('optimistic');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const placed = useRef(false);

  const state = trip?.state ?? null;
  const weather = useTripWeather(tripId, state?.doc ?? null);

  const show = useCallback((next: CachedTrip) => {
    setTrip(next);
    prefetchGuideImages(next);
    // Przypomnienia z zadań planu (jeśli włączone w Ustawieniach) — po każdym wczytaniu.
    void scheduleTripReminders(tripId, next.state.doc).catch(() => undefined);
    setInvalid('');
    // Dzień ustawia się raz — odświeżenie nie przerzuca oglądanego dnia.
    if (!placed.current) setIndex(initialDay(next.state));
    placed.current = true;
    setSync({ busy: false, syncedAt: next.syncedAt });
  }, [tripId]);

  /** `quiet` — pobranie z sygnału Realtime, bez „Synchronizuję…” w statusie. */
  const load = useCallback(async (quiet = false) => {
    if (!signedIn) return;
    if (!quiet) setSync((current) => ({ ...current, busy: true }));
    try {
      const fresh = await refreshTrip(localDb, remote, tripId);
      show(fresh);
      // „Ostatnio w telefonie” (statystyki organizatora) i nowa wizyta, potem „Co nowego” — bez czekania;
      // błąd (np. serwer przed migracją) bez znaczenia.
      const client = supabase as unknown as SupabaseClient;
      void Promise.resolve(client.rpc('touch_trip', { p_trip: tripId, p_client: 'phone' }))
        .then(() => fetchTripNews(client, tripId))
        .then(async (found) => setNews(found === null ? null : summarizeNews(found, await newsRows(client, found))))
        .catch(() => undefined);
      if (fresh.rejected.length > 0) {
        Alert.alert('Serwer nie przyjął zmiany', `${fresh.rejected.length === 1 ? 'Jeden zapis' : `${fresh.rejected.length} zapisy`} z telefonu wycofano — brak uprawnień albo dane już się zmieniły.

${fresh.rejected[0]!.error}`);
      }
    } catch (e) {
      setSync((current) => ({ ...current, busy: false, error: message(e) }));
    }
  }, [tripId, signedIn, show]);

  useEffect(() => {
    const first = setTimeout(() => {
      try {
        const cached = cachedTrip(localDb, tripId);
        if (cached !== null) show(cached);
      } catch (e) {
        setInvalid(`Plan na telefonie nie przechodzi walidacji: ${message(e)}`);
      }
      void load();
    }, 0);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load();
    });
    // Karta „Teraz / następny” przesuwa się z zegarem.
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      listener.remove();
      clearInterval(tick);
    };
  }, [tripId, load, show]);

  // Na żywo: sygnał o zmianie wyjazdu → pobranie przyrostowe; sygnały w trakcie pobierania zlewają się w jedno.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    if (!signedIn) return;
    const pull = serialPuller(() => loadRef.current(true));
    const stop = watchTrip(supabase as unknown as SupabaseClient, tripId, () => void pull());
    return () => void stop();
  }, [tripId, signedIn]);

  /**
   * Edycja planu (online): zmiana od razu w dokumencie na ekranie, zapis w bazie przez
   * `savePlanEdit`, potem synchronizacja do SQLite. Błąd (np. brak sieci) cofa zmianę.
   */
  const apply = (edit: PlanEdit | null) => {
    if (edit === null || trip === null) return;
    const invalidDoc = documentProblem(edit.doc);
    if (invalidDoc !== null) return Alert.alert('Nie zapisano', invalidDoc);
    const before = trip;
    setTrip({ ...trip, state: { ...trip.state, doc: edit.doc } });
    setSaving((count) => count + 1);
    queue.current = queue.current
      .then(async () => {
        const ids = await savePlanEdit(supabase as unknown as SupabaseClient, tripId, edit, { ...before.ids, ...extraIds.current });
        extraIds.current = { ...extraIds.current, ...ids };
        await load();
      })
      .catch((e: unknown) => {
        setTrip(before);
        Alert.alert('Nie zapisano zmiany', `${message(e)}\n\nEdycja planu wymaga połączenia z internetem.`);
      })
      .finally(() => setSaving((count) => count - 1));
  };

  const actions: Actions | null =
    signedIn && canAct && editMode && trip !== null
      ? {
          move: (ref, direction) => apply(moveWithinDay(trip.state.doc, ref, direction)),
          moveTo: (ref, dayRef) => apply(moveToDay(trip.state.doc, ref, dayRef)),
          update: (ref, fields) => apply(updateItem(trip.state.doc, ref, fields)),
          add: (dayRef, fields) => apply(addItem(trip.state.doc, dayRef, uuidv7(), fields)),
          addToPool: (fields, placeName, at) => apply(addPoolItem(trip.state.doc, { itemId: uuidv7(), placeId: uuidv7() }, fields, placeName, at)),
          remove: (ref) => {
            try {
              apply(removeItemClosingGap(trip.state.doc, ref));
            } catch (e) {
              Alert.alert('Nie można usunąć', e instanceof ItemInUseError ? e.message : message(e));
            }
          },
        }
      : null;

  /** Po zapisie z telefonu: stan z SQLite od razu na ekranie, potem wysyłka i pobranie w tle. */
  const afterLocalWrite = () => {
    const updated = cachedTrip(localDb, tripId);
    if (updated !== null) {
      setTrip(updated);
      // Oś dnia po „+15 min” / „Pomiń” od razu, także bez sieci (load niżej przelicza tylko z siecią).
      void scheduleTripReminders(tripId, updated.state.doc).catch(() => undefined);
    }
    void load(true);
  };

  /** Zdarzenie dnia: zapis lokalny (od razu w planie), potem wysyłka przy synchronizacji. */
  const record = (dayRef: string, itemRef: string, event: DayEvent) => {
    if (trip === null) return;
    try {
      recordDayEvent(localDb, tripId, trip, dayRef, itemRef, event);
      const title = trip.state.doc.items.find((each) => each.ref === itemRef)?.title ?? '';
      setLastEvent(
        event.kind === 'delay' && event.minutes > 0
          ? { itemRef, kind: 'delay', minutes: event.minutes }
          : event.kind === 'done' && event.undo !== true
            ? { itemRef, kind: 'done', title }
            : event.kind === 'pull_from_pool' && event.undo !== true
              ? { itemRef, kind: 'pull_from_pool', title }
              : null,
      );
      setNow(Date.now());
      afterLocalWrite();
    } catch (e) {
      Alert.alert('Nie zapisano', message(e));
    }
  };

  /**
   * „Wybierz wariant”: organizator i edytor zapisują wybór jako zdarzenie dnia (outbox — widać go
   * na webie i u innych, a przypomnienie o decyzji znika); widz i niezalogowany tylko podglądają.
   */
  const choose = (groupRef: string, variantRef: string) => {
    if (trip === null) return;
    if (!signedIn || !canAct) {
      setOverrides((current) => ({ ...current, [groupRef]: variantRef }));
      return;
    }
    try {
      recordVariantChoice(localDb, tripId, trip, groupRef, variantRef);
      setOverrides(({ [groupRef]: _, ...rest }) => rest);
      afterLocalWrite();
    } catch (e) {
      Alert.alert('Nie zapisano', message(e));
    }
  };

  let status: string;
  if (!signedIn) status = sync.syncedAt ? `Niezalogowany — plan z ${stamp(sync.syncedAt)}, bez synchronizacji` : 'Ten plan nie był pobrany na telefon — zaloguj się na ekranie Start.';
  else if (saving > 0) status = 'Zapisuję zmianę…';
  else if (sync.busy) status = 'Synchronizuję…';
  else if (sync.error !== undefined) status = sync.syncedAt ? `Bez połączenia — plan z ${stamp(sync.syncedAt)}` : `Brak połączenia, a plan nie był jeszcze pobrany na telefon (${sync.error}).`;
  else status = sync.syncedAt ? `Zsynchronizowano ${stamp(sync.syncedAt)}` : '';
  if (trip !== null && trip.pending > 0) status += ` · ${trip.pending === 1 ? '1 zmiana czeka' : `${trip.pending} zmian czeka`} na wysłanie`;
  // Ile planu jest na mapie — miejsca ze współrzędnymi i przejazdy policzone trasą (web: „Uzupełnij”, „Przelicz”).
  const coverage = trip === null ? null : mapCoverage(trip.state.doc);
  if (coverage !== null && coverage.places.total > 0) {
    status += `
Na mapie ${coverage.places.onMap} z ${coverage.places.total} miejsc${coverage.legs.routable > 0 ? ` · przejazdy z trasy: ${coverage.legs.routed} z ${coverage.legs.routable}` : ''}`;
  }
  const error = invalid;

  const variants = useMemo(() => ({ ...state?.inputs.activeVariants, ...overrides }), [state, overrides]);
  const days = state?.doc.days ?? [];
  const day = days[index];
  /** Pula — chip po ostatnim dniu (`index === days.length`): punkty poza dniami. */
  const poolCount = state?.doc.items.filter((item) => item.dayRef === undefined && item.parentRef === undefined).length ?? 0;
  const showPool = days.length > 0 && index === days.length;

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12}>
            <ThemedText type="linkPrimary">← Wyjazdy</ThemedText>
          </Pressable>
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
          {state?.doc.trip.title ?? ''}
        </ThemedText>
        {signedIn && canAct && state !== null && mode === 'plan' && (
          <Pressable onPress={() => setEditMode(!editMode)} hitSlop={12}>
            <ThemedText type="linkPrimary">{editMode ? 'Gotowe' : 'Edytuj'}</ThemedText>
          </Pressable>
        )}
        {signedIn && !editMode && (
          <Pressable onPress={() => void load()} hitSlop={12}>
            <ThemedText type="linkPrimary">Odśwież</ThemedText>
          </Pressable>
        )}
      </View>

      {/* Plan jeszcze niewczytany — status na górze (to jedyna treść); potem na końcu strony. */}
      {trip === null && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
          {status}
        </ThemedText>
      )}
      {error !== '' && <ThemedText style={[styles.pad, { color: HARD }]}>{error}</ThemedText>}
      {trip !== null && news !== null && (
        <TripNewsBanner
          news={news}
          now={now}
          onSeen={() => {
            setNews(null);
            void markNewsSeen(supabase as unknown as SupabaseClient, tripId).catch(() => undefined);
          }}
          onOpenItem={(ref) => {
            const item = trip.state.doc.items.find((each) => each.ref === ref);
            if (item === undefined) return;
            setDetailPlay(false);
            setDetail(item);
          }}
        />
      )}
      {trip !== null && (
        <Tabs
          options={[
            { value: 'plan', label: 'Plan' },
            { value: 'wallet', label: 'Wydatki' },
            { value: 'packing', label: 'Pakowanie' },
            { value: 'tasks', label: 'Zadania' },
            { value: 'journal', label: 'Dziennik' },
            { value: 'info', label: 'Info' },
          ]}
          value={mode}
          onChange={setMode}
        />
      )}
      {trip !== null && mode !== 'plan' && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.three }]} keyboardShouldPersistTaps="handled">
          {mode === 'wallet' ? (
            <WalletView trip={trip} tripId={tripId} canAdd={signedIn && canAddExpense} canEditAll={signedIn && canAct} userId={signedIn ? userId : null} onChanged={afterLocalWrite} />
          ) : mode === 'info' ? (
            <InfoView trip={trip} tripId={tripId} signedIn={signedIn} />
          ) : mode === 'tasks' ? (
            <TasksView trip={trip} tripId={tripId} signedIn={signedIn} userId={signedIn ? userId : null} canAct={signedIn && canAct} onChanged={afterLocalWrite} />
          ) : mode === 'journal' ? (
            <JournalView trip={trip} tripId={tripId} signedIn={signedIn} userId={signedIn ? userId : null} canEditAll={signedIn && canAct} onChanged={afterLocalWrite} />
          ) : (
            <PackingView trip={trip} tripId={tripId} canEdit={signedIn && canAct} userId={signedIn ? userId : null} onChanged={afterLocalWrite} />
          )}
          <SyncStatus text={status} />
        </ScrollView>
      )}
      {mode === 'plan' && state !== null && days.length === 0 && <ThemedText style={styles.pad}>Plan nie ma jeszcze dni.</ThemedText>}

      {mode === 'plan' && state !== null && (day || showPool) && (
        <>
          {/* Dni i scenariusz na osobnym pasku — oddzielone od zakładek i od treści dnia. */}
          <View style={[styles.dayBar, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.backgroundSelected }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips}>
              {days.map((each, at) => (
                <Chip
                  key={each.ref}
                  active={at === index}
                  label={instantToZoned(now, each.tz).date === each.date ? `${at + 1}. dziś` : `${at + 1}. ${each.date.slice(8)}.${each.date.slice(5, 7)}`}
                  onPress={() => setIndex(at)}
                />
              ))}
              {(poolCount > 0 || actions !== null) && <Chip active={showPool} label={`Pula (${poolCount})`} onPress={() => setIndex(days.length)} />}
            </ScrollView>
            <View style={styles.scenario}>
              <Segmented
                label="Scenariusz"
                options={[
                  { value: 'optimistic', label: 'optymistyczny' },
                  { value: 'pessimistic', label: 'pesymistyczny' },
                ]}
                value={scenario}
                onChange={setScenario}
              />
            </View>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.three }]}>
            {showPool && trip !== null && (
              <PoolView
                trip={trip}
                onMove={actions === null ? null : (ref, dayRef) => actions.moveTo(ref, dayRef)}
                onAdd={actions === null ? null : actions.addToPool}
                onOpen={(item) => {
                  setDetailPlay(false);
                  setDetail(item);
                }}
              />
            )}
            {day && (
              <>
                <Day
                  state={state}
                  dayRef={day.ref}
                  scenario={scenario}
                  variants={variants}
                  onChoose={choose}
                  actions={actions}
                  weather={weather?.days[day.ref]}
                  weatherAt={weather?.fetchedAt}
                  onOpen={(item) => {
                    setDetailPlay(false);
                    setDetail(item);
                  }}
                  guides={trip === null ? undefined : guidedPlaces(trip)}
                  onGuide={(item, play) => {
                    setDetailPlay(play);
                    setDetail(item);
                  }}
                  guided={trip === null ? undefined : new Set(trip.state.doc.items.filter((each) => itemGuide(trip, each) !== null).map((each) => each.ref))}
                  top={
                    instantToZoned(now, day.tz).date === day.date
                      ? (schedule) => (
                          <NowCard
                            schedule={schedule}
                            now={now}
                            lastEvent={lastEvent}
                        pool={{ doc: state.doc, pulled: state.inputs.pulled.filter((each) => each.dayRef === day.ref).map((each) => each.itemRef) }}
                            onEvent={signedIn && canAct ? (itemRef, event) => record(day.ref, itemRef, event) : null}
                          />
                        )
                      : undefined
                  }
                />
                <View style={styles.nav}>
                  <Pressable disabled={index === 0} onPress={() => setIndex(index - 1)} hitSlop={12}>
                    <ThemedText type="linkPrimary" style={index === 0 && styles.hidden}>
                      ← poprzedni dzień
                    </ThemedText>
                  </Pressable>
                  <Pressable disabled={index === days.length - 1} onPress={() => setIndex(index + 1)} hitSlop={12}>
                    <ThemedText type="linkPrimary" style={index === days.length - 1 && styles.hidden}>
                      następny dzień →
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
            <SyncStatus text={status} />
          </ScrollView>
        </>
      )}
      {trip !== null && <ItemDetails trip={trip} item={detail} autoPlay={detailPlay} onClose={() => setDetail(null)} tripId={tripId} online={signedIn} />}
    </View>
  );
}

/** Synchronizacja i pokrycie mapy — na końcu strony, pod mapą dnia (nie zabiera miejsca na górze). */
function SyncStatus({ text }: { text: string }) {
  const theme = useTheme();
  if (text === '') return null;
  return (
    <ThemedText type="small" themeColor="textSecondary" style={[styles.syncStatus, { borderTopColor: theme.backgroundSelected }]}>
      {text}
    </ThemedText>
  );
}

type DayProps = {
  state: TripState;
  dayRef: string;
  scenario: Scenario;
  variants: Record<string, string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  /** Karta nad punktami dnia, liczona z tego samego harmonogramu („Teraz / następny” w dniu dzisiejszym). */
  top?: (schedule: DaySchedule) => ReactNode;
  /** Tryb edycji (organizator, edytor); `null` = tylko odczyt. */
  actions: Actions | null;
  /** Prognoza dnia (Open-Meteo) i kiedy pobrana — offline ostatnia zapisana. */
  weather?: DayWeather;
  weatherAt?: string;
  /** Szczegóły punktu (dotknięcie nazwy). */
  onOpen?: (item: PlanItem) => void;
  /** Punkty z przewodnikiem — znaczek 📖. */
  guided?: Set<string>;
  /** Miejsca z przewodnikiem do mapy dnia i „Poczytaj / Posłuchaj” z karty pinezki. */
  guides?: Map<string, PlanItem>;
  onGuide?: (item: PlanItem, play: boolean) => void;
};

type Actions = {
  move: (ref: string, direction: -1 | 1) => void;
  moveTo: (ref: string, dayRef: string | null) => void;
  update: (ref: string, fields: ItemFields) => void;
  add: (dayRef: string, fields: ItemFields) => void;
  /** Nowy punkt w puli; `at` — pozycja telefonu („tu, gdzie jestem”). */
  addToPool: (fields: ItemFields, placeName?: string, at?: { lat: number; lng: number }) => void;
  remove: (ref: string) => void;
};

/** Pasek z lewej karty punktu — kolor według rodzaju (jak kropki na osi dnia na webie). */
/** Nocleg — jak pinezka bazy na mapie. */
const LODGING = '#1B2A41';
const KIND_COLOR: Record<string, string> = {
  visit: '#2E7D74',
  activity: '#2E7D74',
  meal: '#E8692C',
  meetup: '#E8692C',
  transport: '#34425A',
  lodging: '#6366F1',
  errand: '#9C9584',
  free: '#10B981',
  decision: '#F59E0B',
};

function Day({ state, dayRef, scenario, variants, onChoose, top, actions, weather, weatherAt, onOpen, guided, guides, onGuide }: DayProps) {
  const theme = useTheme();
  const { doc, inputs } = state;
  const [editing, setEditing] = useState<PlanItem | 'new' | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const day = doc.days.find((each) => each.ref === dayRef)!;
  const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled };
  let schedule: DaySchedule | null = null;
  let failure: string | null = null;
  try {
    schedule = scheduleDay(doc, dayRef, options);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  const cuts = schedule?.slack === 'negative' || schedule?.warnings.some((each) => each.severity === 'hard') ? proposeCuts(doc, dayRef, options) : [];
  const active = resolveVariants(doc, variants);
  const groups = doc.variantGroups.filter((group) => group.dayRef === dayRef && group.scope !== 'trip' && group.scope !== 'booking');
  const notes = doc.notes.filter((note) => note.scope === 'day' && note.targetRef === dayRef);
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const byRef = new Map(doc.items.map((item) => [item.ref, item]));
  const base = day.baseRef === undefined ? undefined : places.get(day.baseRef)?.name;
  const lodging = dayLodging(doc, dayRef);
  const sun = schedule?.facts.sun;
  const slack = schedule?.slack ? SLACK[schedule.slack] : undefined;

  return (
    <View style={styles.day}>
      <ThemedText style={styles.dayTitle}>
        {weekday(day.date)}
        {day.title ? ` — ${day.title}` : ''}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {base ? `baza: ${base}\n` : ''}
        {sun ? `wschód ${hm(sun.sunrise, day.tz)} · zachód ${hm(sun.sunset, day.tz)} · zmrok ${hm(sun.civilDusk, day.tz)}` : 'słońce: brak współrzędnych bazy'}
        {schedule?.facts.dst ? ' · zmiana czasu' : ''}
      </ThemedText>
      {weather && (
        <ThemedText type="smallBold" themeColor="accent">
          {weatherLine(weather)}
          {weatherAt ? (
            <ThemedText type="small" themeColor="textSecondary">
              {' '}
              · prognoza z {new Date(weatherAt).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
          ) : null}
        </ThemedText>
      )}
      {(() => {
        const hint = weatherVariantHint(doc, dayRef, weather);
        if (hint === null || active.has(hint.variantRef)) return null;
        return (
          <Pressable onPress={() => onChoose(hint.groupRef, hint.variantRef)} style={[styles.hint, { borderColor: theme.primary }]}>
            <ThemedText type="small">
              Zapowiada się niepogoda — {hint.group}: <ThemedText type="smallBold">„{hint.variant}”</ThemedText> (dotknij, żeby włączyć)
            </ThemedText>
          </Pressable>
        );
      })()}
      {slack && (
        <View style={[styles.badge, { borderColor: slack.color }]}>
          <ThemedText type="small" style={{ color: slack.color }}>
            {slack.label}
            {schedule?.slackMin != null ? ` (${schedule.slackMin} min)` : ''}
          </ThemedText>
        </View>
      )}
      {day.summary ? (
        <ThemedText type="small" themeColor="textSecondary">
          {day.summary}
        </ThemedText>
      ) : null}

      {groups.map((group) => (
        <View key={group.ref} style={styles.group}>
          <ThemedText type="small" themeColor="textSecondary">
            {group.title}:
          </ThemedText>
          <View style={styles.wrap}>
            {doc.variants
              .filter((variant) => variant.groupRef === group.ref)
              .map((variant) => (
                <Chip key={variant.ref} active={active.has(variant.ref)} label={`${variant.label}${variant.recommended ? ' ★' : ''}`} onPress={() => onChoose(group.ref, variant.ref)} />
              ))}
          </View>
        </View>
      ))}

      {schedule && top?.(schedule)}

      {failure && <ThemedText style={{ color: HARD }}>Nie udało się policzyć dnia: {failure}</ThemedText>}

      {schedule?.items.map((item) => {
        const source = byRef.get(item.ref);
        const place = source?.placeRef === undefined ? undefined : places.get(source.placeRef)?.name;
        const leg = source === undefined ? null : legLabel(source);
        const offMap = source !== undefined && missingOnMap(doc, source);
        const flight = source === undefined ? undefined : flightOf(doc, source);
        const flightText = flight === undefined ? undefined : flightLine(flight);
        return (
          <ThemedView
            key={item.ref}
            type="backgroundElement"
            style={[styles.item, { borderColor: theme.backgroundSelected, borderLeftColor: KIND_COLOR[item.kind] ?? theme.textSecondary }, source?.parentRef !== undefined && styles.child]}>
            <ThemedText style={[styles.time, { color: theme.text }]}>
              {item.startLocal}–{item.endLocal}
              {item.endDate !== day.date ? ' +1' : ''}
              {item.done ? '  ✓ zrobione' : ''}
              {inputs.pulled.some((each) => each.itemRef === item.ref) ? '  · z puli' : ''}
            </ThemedText>
            <Pressable disabled={source === undefined || onOpen === undefined} onPress={() => source && onOpen?.(source)} hitSlop={4}>
              <ThemedText type="smallBold" style={styles.itemTitle}>
                {source ? `${itemIcon(doc, source)} ` : ''}
                {item.title}
                {guided?.has(item.ref) ? '  📖' : ''}
                <ThemedText type="small" themeColor="accent">
                  {'  ›'}
                </ThemedText>
              </ThemedText>
            </Pressable>
            {flightText && (
              <ThemedText type="smallBold" themeColor="accent">
                ✈ {flightText}
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {KIND[item.kind]}
              {place && place !== item.title ? ` · ${place}` : ''}
              {item.driftMin > 15 && item.statedLocal ? ` · plan mówi ${item.statedLocal}, wychodzi +${item.driftMin} min` : ''}
            </ThemedText>
            {leg && (
              <ThemedText type="small" themeColor="textSecondary">
                {leg}
              </ThemedText>
            )}
            {offMap && (
              <ThemedText type="small" style={{ color: SOFT }}>
                brak na mapie (miejsce bez współrzędnych)
              </ThemedText>
            )}
            <Warnings list={schedule!.warnings.filter((warning) => warning.itemRef === item.ref)} />
            {actions && source && (
              <View style={styles.edit}>
                <EditButton label="↑" onPress={() => actions.move(item.ref, -1)} />
                <EditButton label="↓" onPress={() => actions.move(item.ref, 1)} />
                <EditButton label="Edytuj" onPress={() => setEditing(source)} />
                <EditButton label="Przenieś" onPress={() => setMoving(item.ref)} />
                <EditButton
                  label="Usuń"
                  onPress={() =>
                    Alert.alert('Usunąć punkt?', `„${item.title}” zniknie z planu.`, [
                      { text: 'Anuluj', style: 'cancel' },
                      { text: 'Usuń', style: 'destructive', onPress: () => actions.remove(item.ref) },
                    ])
                  }
                />
              </View>
            )}
          </ThemedView>
        );
      })}

      {/* Nocleg na koniec dnia (baza dnia / rezerwacja tej nocy) — na mapie pinezka ⌂. */}
      {schedule && lodging && (
        <ThemedView type="backgroundElement" style={[styles.item, { borderColor: theme.backgroundSelected, borderLeftColor: LODGING }]}>
          {lodging.booking?.checkInFrom ? <ThemedText style={[styles.time, { color: theme.text }]}>od {lodging.booking.checkInFrom}</ThemedText> : null}
          <ThemedText type="smallBold" style={styles.itemTitle}>
            🛏️ Nocleg: {lodging.name}
          </ThemedText>
          {lodging.booking && (lodging.booking.title !== lodging.name || lodging.booking.code) ? (
            <ThemedText type="small" themeColor="textSecondary">
              {[lodging.booking.title !== lodging.name ? lodging.booking.title : null, lodging.booking.code ? `kod ${lodging.booking.code}` : null].filter(Boolean).join(' · ')}
            </ThemedText>
          ) : null}
          {!lodging.onMap && (
            <ThemedText type="small" style={{ color: SOFT }}>
              brak na mapie (miejsce bez współrzędnych)
            </ThemedText>
          )}
          {/* Gospodarz i inne kontakty rezerwacji tej nocy — jedno dotknięcie = połączenie. */}
          <ContactList contacts={lodgingContacts(doc, lodging)} />
        </ThemedView>
      )}

      {actions && (
        <Pressable onPress={() => setEditing('new')} hitSlop={8}>
          <ThemedText type="linkPrimary">+ Dodaj punkt</ThemedText>
        </Pressable>
      )}
      {actions && (
        <>
          <ItemEditor
            item={editing === 'new' ? null : editing}
            visible={editing !== null}
            onCancel={() => setEditing(null)}
            onSave={(fields) => {
              if (editing === 'new') actions.add(dayRef, fields);
              else if (editing !== null) actions.update(editing.ref, fields);
              setEditing(null);
            }}
          />
          <DayPicker
            doc={doc}
            current={dayRef}
            visible={moving !== null}
            onCancel={() => setMoving(null)}
            onPick={(target) => {
              if (moving !== null) actions.moveTo(moving, target);
              setMoving(null);
            }}
          />
        </>
      )}

      {schedule && <Warnings list={schedule.warnings.filter((warning) => warning.itemRef === undefined)} />}

      {schedule && <DayMap doc={doc} dayRef={dayRef} schedule={schedule} guides={guides} onGuide={onGuide} />}

      {cuts.length > 0 && (
        <View style={styles.group}>
          <ThemedText type="smallBold">Co wyciąć, żeby dzień się spiął:</ThemedText>
          {cuts.map((cut) => (
            <ThemedText key={cut.itemRef} type="small" themeColor="textSecondary">
              • {cut.title} — zwalnia {cut.freesMin} min{cut.resolves ? ' (wystarczy)' : ''}
            </ThemedText>
          ))}
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.group}>
          <Pressable onPress={() => setNotesOpen(!notesOpen)} hitSlop={8}>
            <ThemedText type="linkPrimary">
              {notesOpen ? '▾' : '▸'} Notatki dnia ({notes.length})
            </ThemedText>
          </Pressable>
          {notesOpen &&
            notes.map((note, at) => (
              <ThemedText key={at} type="small" themeColor="textSecondary">
                {note.title ? `${note.title}: ` : ''}
                {note.body}
              </ThemedText>
            ))}
        </View>
      )}
    </View>
  );
}

function EditButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <AppButton label={label} onPress={onPress} small />;
}

function Warnings({ list }: { list: ScheduleWarning[] }) {
  return list.map((warning, at) => (
    <ThemedText key={at} type="small" style={{ color: warning.severity === 'hard' ? HARD : SOFT }}>
      {warning.severity === 'hard' ? '⚠ ' : '· '}
      {warning.message}
    </ThemedText>
  ));
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  title: { flex: 1, textAlign: 'center' },
  pad: { padding: Spacing.three },
  status: { paddingHorizontal: Spacing.three },
  syncStatus: { borderTopWidth: 1, paddingTop: Spacing.two },
  // ScrollView domyślnie ma flexShrink: 1 — pasek dni ściskał się w pionie i ucinał tekst.
  chipsBar: { flexGrow: 0, flexShrink: 0 },
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  dayBar: { borderBottomWidth: 1, paddingTop: Spacing.one, paddingBottom: Spacing.two },
  scenario: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one },
  content: { padding: Spacing.three, gap: Spacing.three },
  day: { gap: Spacing.two },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  group: { gap: Spacing.one },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  item: { padding: Spacing.three, borderRadius: 14, gap: 2, borderWidth: 1, borderLeftWidth: 5 },
  time: { fontSize: 15, lineHeight: 20, fontWeight: 800, fontVariant: ['tabular-nums'] },
  itemTitle: { fontSize: 16, lineHeight: 22 },
  dayTitle: { fontSize: 20, lineHeight: 26, fontWeight: 800 },
  hint: { borderWidth: 1.5, borderRadius: 12, padding: Spacing.two },
  child: { marginLeft: Spacing.four },
  nav: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.three },
  hidden: { opacity: 0 },
  edit: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.two },
});
