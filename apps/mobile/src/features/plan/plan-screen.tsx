import {
  activeVariants as resolveVariants,
  type DaySchedule,
  instantToZoned,
  proposeCuts,
  type Scenario,
  scheduleDay,
  type ScheduleWarning,
} from '@expeditionplan/core';
import { cachedTrip, refreshTrip, type TripState } from '@expeditionplan/sync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localDb, remote } from '@/lib/local-db';

/**
 * Plan dnia na telefonie (MVP-1, tylko odczyt). Offline: najpierw stan z SQLite (`cachedTrip`),
 * potem synchronizacja przyrostowa (`refreshTrip`) — przy otwarciu, „Odśwież” i powrocie aplikacji
 * na pierwszy plan. Godziny liczy silnik z packages/core na telefonie. Jeden dzień na ekranie;
 * domyślnie dzisiejszy, jeśli wyjazd trwa.
 */

const KIND: Record<string, string> = {
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

type Props = { tripId: string | null; signedIn: boolean; onClose: () => void };

/** Plan w pełnoekranowym oknie nad listą wyjazdów (Start). */
export function PlanScreen({ tripId, signedIn, onClose }: Props) {
  return (
    <Modal visible={tripId !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {tripId !== null && <Plan tripId={tripId} signedIn={signedIn} onClose={onClose} />}
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
  /** Przycisk powrotu (okno z listy wyjazdów). */
  onClose?: () => void;
  /** Miejsce na pasek zakładek. */
  bottomInset?: number;
};

/** Plan jednego wyjazdu. */
export function Plan({ tripId, signedIn, onClose, bottomInset = 0 }: PlanProps) {
  const [state, setState] = useState<TripState | null>(null);
  const [sync, setSync] = useState<{ busy: boolean; syncedAt?: string; error?: string }>({ busy: signedIn });
  const [invalid, setInvalid] = useState('');
  const [index, setIndex] = useState(0);
  const [scenario, setScenario] = useState<Scenario>('optimistic');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const placed = useRef(false);

  const show = useCallback((next: TripState, syncedAt: string) => {
    setState(next);
    setInvalid('');
    // Dzień ustawia się raz — odświeżenie nie przerzuca oglądanego dnia.
    if (!placed.current) setIndex(initialDay(next));
    placed.current = true;
    setSync({ busy: false, syncedAt });
  }, []);

  const load = useCallback(async () => {
    if (!signedIn) return;
    setSync((current) => ({ ...current, busy: true }));
    try {
      const fresh = await refreshTrip(localDb, remote, tripId);
      show(fresh.state, fresh.syncedAt);
    } catch (e) {
      setSync((current) => ({ ...current, busy: false, error: message(e) }));
    }
  }, [tripId, signedIn, show]);

  useEffect(() => {
    const first = setTimeout(() => {
      try {
        const cached = cachedTrip(localDb, tripId);
        if (cached !== null) show(cached.state, cached.syncedAt);
      } catch (e) {
        setInvalid(`Plan na telefonie nie przechodzi walidacji: ${message(e)}`);
      }
      void load();
    }, 0);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load();
    });
    return () => {
      clearTimeout(first);
      listener.remove();
    };
  }, [tripId, load, show]);

  let status: string;
  if (!signedIn) status = sync.syncedAt ? `Niezalogowany — plan z ${stamp(sync.syncedAt)}, bez synchronizacji` : 'Ten plan nie był pobrany na telefon — zaloguj się na ekranie Start.';
  else if (sync.busy) status = 'Synchronizuję…';
  else if (sync.error !== undefined) status = sync.syncedAt ? `Bez połączenia — plan z ${stamp(sync.syncedAt)}` : `Brak połączenia, a plan nie był jeszcze pobrany na telefon (${sync.error}).`;
  else status = sync.syncedAt ? `Zsynchronizowano ${stamp(sync.syncedAt)}` : '';
  const error = invalid;

  const variants = useMemo(() => ({ ...state?.inputs.activeVariants, ...overrides }), [state, overrides]);
  const days = state?.doc.days ?? [];
  const day = days[index];

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
        {signedIn && (
          <Pressable onPress={() => void load()} hitSlop={12}>
            <ThemedText type="linkPrimary">Odśwież</ThemedText>
          </Pressable>
        )}
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
        {status}
      </ThemedText>
      {error !== '' && <ThemedText style={[styles.pad, { color: HARD }]}>{error}</ThemedText>}
      {state !== null && days.length === 0 && <ThemedText style={styles.pad}>Plan nie ma jeszcze dni.</ThemedText>}

      {state !== null && day && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips}>
            {days.map((each, at) => (
              <Chip key={each.ref} active={at === index} label={`${at + 1}. ${each.date.slice(8)}.${each.date.slice(5, 7)}`} onPress={() => setIndex(at)} />
            ))}
          </ScrollView>
          <View style={styles.chips}>
            <Chip active={scenario === 'optimistic'} label="optymistyczny" onPress={() => setScenario('optimistic')} />
            <Chip active={scenario === 'pessimistic'} label="pesymistyczny" onPress={() => setScenario('pessimistic')} />
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.three }]}>
            <Day
              state={state}
              dayRef={day.ref}
              scenario={scenario}
              variants={variants}
              onChoose={(groupRef, variantRef) => setOverrides((current) => ({ ...current, [groupRef]: variantRef }))}
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
          </ScrollView>
        </>
      )}
    </View>
  );
}

export function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? theme.text : theme.backgroundSelected, backgroundColor: active ? theme.backgroundSelected : 'transparent' }]}>
      <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

type DayProps = {
  state: TripState;
  dayRef: string;
  scenario: Scenario;
  variants: Record<string, string>;
  onChoose: (groupRef: string, variantRef: string) => void;
};

function Day({ state, dayRef, scenario, variants, onChoose }: DayProps) {
  const { doc, inputs } = state;
  const [notesOpen, setNotesOpen] = useState(false);
  const day = doc.days.find((each) => each.ref === dayRef)!;
  const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs };
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
  const sun = schedule?.facts.sun;
  const slack = schedule?.slack ? SLACK[schedule.slack] : undefined;

  return (
    <View style={styles.day}>
      <ThemedText type="smallBold">
        {weekday(day.date)}
        {day.title ? ` — ${day.title}` : ''}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {base ? `baza: ${base}\n` : ''}
        {sun ? `wschód ${hm(sun.sunrise, day.tz)} · zachód ${hm(sun.sunset, day.tz)} · zmrok ${hm(sun.civilDusk, day.tz)}` : 'słońce: brak współrzędnych bazy'}
        {schedule?.facts.dst ? ' · zmiana czasu' : ''}
      </ThemedText>
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

      {failure && <ThemedText style={{ color: HARD }}>Nie udało się policzyć dnia: {failure}</ThemedText>}

      {schedule?.items.map((item) => {
        const source = byRef.get(item.ref);
        const place = source?.placeRef === undefined ? undefined : places.get(source.placeRef)?.name;
        return (
          <ThemedView key={item.ref} type="backgroundElement" style={[styles.item, source?.parentRef !== undefined && styles.child]}>
            <ThemedText type="code">
              {item.startLocal}–{item.endLocal}
              {item.endDate !== day.date ? ' +1' : ''}
            </ThemedText>
            <ThemedText>{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {KIND[item.kind]}
              {place && place !== item.title ? ` · ${place}` : ''}
              {item.driftMin > 15 && item.statedLocal ? ` · plan mówi ${item.statedLocal}, wychodzi +${item.driftMin} min` : ''}
            </ThemedText>
            <Warnings list={schedule!.warnings.filter((warning) => warning.itemRef === item.ref)} />
          </ThemedView>
        );
      })}

      {schedule && <Warnings list={schedule.warnings.filter((warning) => warning.itemRef === undefined)} />}

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
  // ScrollView domyślnie ma flexShrink: 1 — pasek dni ściskał się w pionie i ucinał tekst.
  chipsBar: { flexGrow: 0, flexShrink: 0 },
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  content: { padding: Spacing.three, gap: Spacing.three },
  day: { gap: Spacing.two },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  group: { gap: Spacing.one },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  item: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.half },
  child: { marginLeft: Spacing.four },
  nav: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.three },
  hidden: { opacity: 0 },
});
