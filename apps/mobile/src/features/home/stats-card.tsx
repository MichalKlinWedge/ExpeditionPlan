import { isPostponed, localToday, tripStats, type TripStats } from '@expeditionplan/core';
import { pendingCount } from '@expeditionplan/sync';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OnTrip } from '@/features/home/on-trip';
import { NextTripWeather } from '@/features/home/weather-alerts';
import { loadMyTrips, setCurrentTrip } from '@/features/trips/my-trips';
import { localDb } from '@/lib/local-db';

/**
 * Start: statystyki wyjazdów — trwający (tryb „w trasie”: teraz/następny, pogoda, Nawiguj), najbliższy, liczby i dni — oraz co leży na telefonie
 * na wypadek braku sieci. Z listy wyjazdów (także tej z pamięci telefonu), więc działa offline.
 */

type Local = { downloaded: number; items: number; pending: number };
type Data = { stats: TripStats; local: Local; offline: boolean; postponed: number };

const days = (count: number) => `${count} ${count === 1 ? 'dzień' : 'dni'}`;
const shortDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}`;

function localCounts(ids: string[]): Local {
  if (ids.length === 0) return { downloaded: 0, items: 0, pending: pendingCount(localDb) };
  const marks = ids.map(() => '?').join(', ');
  const downloaded = localDb.all<{ n: number }>(`select count(*) as n from sync_state where trip_id in (${marks})`, ids)[0]?.n ?? 0;
  const items = localDb.all<{ n: number }>(`select count(*) as n from rows where tbl = 'items' and deleted_at is null and trip_id in (${marks})`, ids)[0]?.n ?? 0;
  return { downloaded, items, pending: pendingCount(localDb) };
}

export function StatsCard({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  const [data, setData] = useState<Data | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadMyTrips(signedIn).then((result) => {
        const trips = result.trips.map((trip) => ({ id: trip.id!, title: trip.title!, startDate: trip.start_date!, endDate: trip.end_date! }));
        // Odłożone nie odliczają dni ani nie wchodzą do statystyk podróży; pobrane dane liczą się dalej.
        const planned = trips.filter((_, index) => !isPostponed(result.trips[index]!));
        setData({ stats: tripStats(planned, localToday()), local: localCounts(trips.map((trip) => trip.id)), offline: result.offline, postponed: trips.length - planned.length });
      });
    }, [signedIn]),
  );

  if (data === null) return <ThemedText type="small">Wczytuję…</ThemedText>;
  const { stats, local } = data;
  if (stats.total === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {data.postponed > 0 ? `Masz tylko wyjazdy odłożone (${data.postponed}) — są w zakładce Wyjazdy.` : signedIn ? 'Nie masz jeszcze wyjazdów — utwórz je na webie albo dołącz z linku.' : 'Na telefonie nie ma pobranych wyjazdów.'}
      </ThemedText>
    );
  }
  const year = localToday().slice(0, 4);

  return (
    <View style={styles.stack}>
      {stats.ongoing && (
        <Pressable
          onPress={() => {
            setCurrentTrip(stats.ongoing!.trip.id);
            router.navigate('/plan');
          }}>
          <View style={[styles.hero, styles.ongoing, { backgroundColor: theme.primary }]}>
            <ThemedText type="smallBold" style={styles.onPrimaryMuted}>
              W TRASIE · DZIEŃ {stats.ongoing.dayNo} Z {stats.ongoing.days}
            </ThemedText>
            <ThemedText type="subtitle" numberOfLines={2} style={styles.onPrimary}>
              {stats.ongoing.trip.title}
            </ThemedText>
            <OnTrip tripId={stats.ongoing.trip.id} />
            <ThemedText type="smallBold" style={styles.onPrimary}>
              Plan dnia →
            </ThemedText>
          </View>
        </Pressable>
      )}
      {stats.next && (
        <Pressable
          onPress={() => {
            setCurrentTrip(stats.next!.trip.id);
            router.navigate('/plan');
          }}>
          <ThemedView type="backgroundElement" style={[styles.hero, styles.next, { borderColor: theme.backgroundSelected }]}>
            <View style={[styles.countdown, { backgroundColor: theme.accentSoft }]}>
              <ThemedText style={[styles.countdownValue, { color: theme.primary }]}>{stats.next.inDays}</ThemedText>
              <ThemedText type="small" themeColor="accent">
                {stats.next.inDays === 1 ? 'dzień' : 'dni'}
              </ThemedText>
            </View>
            <View style={styles.grow}>
              <ThemedText type="small" themeColor="textSecondary">
                NAJBLIŻSZY WYJAZD
              </ThemedText>
              <ThemedText type="smallBold" numberOfLines={2} style={styles.nextTitle}>
                {stats.next.trip.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {stats.next.inDays === 1 ? 'jutro' : `za ${days(stats.next.inDays)}`} · {shortDate(stats.next.trip.startDate)}–{shortDate(stats.next.trip.endDate)} · {days(stats.next.days)}
              </ThemedText>
            </View>
          </ThemedView>
        </Pressable>
      )}
      {stats.next && stats.next.inDays <= 2 && <NextTripWeather tripId={stats.next.trip.id} />}

      <View style={styles.grid}>
        <Tile value={stats.total} label="wyjazdów" />
        <Tile value={stats.upcoming} label="przed wami" />
        <Tile value={stats.past} label="zakończonych" />
        <Tile value={stats.daysTraveled} label="dni w podróży" />
        <Tile value={stats.daysAhead} label="dni zaplanowanych" />
        <Tile value={stats.daysThisYear} label={`dni w ${year}`} />
      </View>

      <ThemedView type="backgroundElement" style={[styles.hero, styles.offline, { borderLeftColor: theme.accent }]}>
        <ThemedText type="small" themeColor="textSecondary">
          NA TELEFONIE (OFFLINE)
        </ThemedText>
        <ThemedText type="small">
          {local.downloaded} z {stats.total} planów pobranych · {local.items} punktów
        </ThemedText>
        {local.pending > 0 && <ThemedText type="small">{local.pending} zapisów czeka na wysłanie</ThemedText>}
        {data.offline && (
          <ThemedText type="small" themeColor="textSecondary">
            {signedIn ? 'Bez połączenia — dane z ostatniej synchronizacji.' : 'Niezalogowany — dane z telefonu.'}
          </ThemedText>
        )}
      </ThemedView>
    </View>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.tile, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="subtitle" themeColor="accent">
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  hero: { padding: Spacing.three, borderRadius: 16, gap: Spacing.one },
  ongoing: { elevation: 4, gap: Spacing.two },
  onPrimary: { color: '#FFFFFF' },
  onPrimaryMuted: { color: '#FFFFFFCC' },
  next: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, elevation: 1 },
  countdown: { width: 76, height: 76, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  countdownValue: { fontSize: 32, lineHeight: 36, fontWeight: 800 },
  grow: { flex: 1, gap: 2 },
  nextTitle: { fontSize: 17, lineHeight: 22 },
  offline: { borderLeftWidth: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '31%', flexGrow: 1, padding: Spacing.three, borderRadius: 16, borderWidth: 1 },
});
