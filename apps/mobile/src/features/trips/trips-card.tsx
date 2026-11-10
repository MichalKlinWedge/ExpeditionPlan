import { isPostponed, localToday, MEMBER_ROLE, tripSections } from '@expeditionplan/core';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PlanScreen } from '@/features/plan/plan-screen';
import { OfflineBadge, OfflineButton, OfflineStamp } from '@/features/trips/offline-button';
import { useTheme } from '@/hooks/use-theme';
import { archivedTrips, loadMyTrips, type MyTrips, setCurrentTrip, setTripArchived, type Trip } from '@/features/trips/my-trips';
import { supabase } from '@/lib/supabase';

/**
 * Moje wyjazdy (MVP-1): lista z rolą, po dotknięciu — plan w liczbach, uczestnicy, kto ma dostęp
 * i wejście w plan dnia albo na mapę. Rozwinięty wyjazd staje się wybranym także w zakładkach Plan i Mapa. Bez logowania (`signedIn = false`) — lista i plany z telefonu, do odczytu.
 * „Do archiwum” przenosi wyjazd do „Archiwum” tylko na tym telefonie (nigdy nie usuwa; usunąć albo
 * opuścić wyjazd można na webie), „Przywróć” cofa. Odłożone (status ustawiany na webie) —
 * w zwiniętej sekcji bez względu na datę. Wyjazdy po dacie końca i zarchiwizowane — w zwiniętym „Archiwum” pod
 * wyjazdami przed nami (najnowsze na górze). Szkice AI — w zwiniętych „Szkicach” na samym dole.
 */


type Details = {
  travelers: { id: string; name: string }[];
  members: { role: string; name: string }[];
  days: number;
  items: number;
};

export function TripsCard({ reloadKey, signedIn, userId }: { reloadKey: number; signedIn: boolean; userId: string | null }) {
  const theme = useTheme();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [postponedOpen, setPostponedOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [archived, setArchived] = useState(archivedTrips);

  const load = useCallback(async () => {
    const apply = (result: MyTrips) => {
      setError(result.error);
      setOffline(result.offline);
      setTrips(result.trips);
    };
    apply(await loadMyTrips(signedIn, apply));
  }, [signedIn]);

  // Pierwsze wczytanie z timera, nie wprost w efekcie (reguła react-hooks/set-state-in-effect).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load, reloadKey]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setCurrentTrip(id);
    setDetails(null);
    if (!signedIn) return;
    const [travelers, members, days, items] = await Promise.all([
      supabase.from('travelers').select('id, name').eq('trip_id', id).is('deleted_at', null).order('sort_key'),
      supabase.from('trip_members').select('role, profiles(display_name)').eq('trip_id', id),
      supabase.from('days').select('id', { count: 'exact', head: true }).eq('trip_id', id).is('deleted_at', null),
      supabase.from('items').select('id', { count: 'exact', head: true }).eq('trip_id', id).is('deleted_at', null),
    ]);
    // Bez sieci szczegółów nie ma, ale plan jest w bazie telefonu.
    if (travelers.error) {
      setOffline(true);
      return;
    }
    setDetails({
      travelers: travelers.data ?? [],
      members: (members.data ?? []).map((member) => ({ role: member.role, name: member.profiles?.display_name ?? '?' })),
      days: days.count ?? 0,
      items: items.count ?? 0,
    });
  };

  const showMap = (id: string) => {
    setCurrentTrip(id);
    router.navigate('/map');
  };

  const archiveTrip = (trip: Trip, value: boolean) => {
    setArchived(setTripArchived(trip.id!, value));
    setOpen(null);
  };

  const sections = tripSections((trips ?? []).filter((trip) => !archived.has(trip.id!)), localToday());
  const { ahead, postponed, drafts } = sections;
  const archive = [...sections.archive, ...(trips ?? []).filter((trip) => archived.has(trip.id!))].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));

  const tripCard = (trip: Trip) => (
    <ThemedView key={trip.id} type="backgroundElement" style={[styles.trip, { borderColor: open === trip.id ? theme.accent : theme.backgroundSelected }]}>
      <Pressable onPress={() => void toggle(trip.id!)} style={styles.tripHead}>
        <View style={styles.grow}>
          <ThemedText type="smallBold" style={styles.tripTitle}>
            {trip.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isPostponed(trip) ? 'orientacyjnie: ' : ''}
            {trip.start_date} – {trip.end_date} · {MEMBER_ROLE[trip.role!]}
            {open === trip.id && <OfflineStamp tripId={trip.id!} />}
          </ThemedText>
          <OfflineBadge tripId={trip.id!} />
        </View>
        <ThemedText themeColor="accent">{open === trip.id ? '▾' : '▸'}</ThemedText>
      </Pressable>
      {open === trip.id && (
        <View style={styles.details}>
          {details === null ? (
            <>
              {!offline && <ThemedText type="small">Wczytuję…</ThemedText>}
              <View style={styles.actions}>
                <AppButton label="Plan dzień po dniu →" onPress={() => setPlan(trip.id)} variant="primary" />
                <AppButton label="Mapa →" onPress={() => showMap(trip.id!)} />
              </View>
            </>
          ) : (
            <>
              <ThemedText type="small">
                Plan: {details.days} dni, {details.items} punktów
              </ThemedText>
              {details.days > 0 && (
                <View style={styles.actions}>
                  <AppButton label="Plan dzień po dniu →" onPress={() => setPlan(trip.id)} variant="primary" />
                  <AppButton label="Mapa →" onPress={() => showMap(trip.id!)} />
                </View>
              )}
              <ThemedText type="small">
                Uczestnicy:{' '}
                {details.travelers.map((person) => person.name).join(', ') || '—'}
              </ThemedText>
              <ThemedText type="small">
                Dostęp: {details.members.map((member) => `${member.name} — ${MEMBER_ROLE[member.role]}`).join(', ')}
              </ThemedText>
            </>
          )}
          <View style={styles.actions}>
            {signedIn && !offline && <OfflineButton tripId={trip.id!} />}
            {archived.has(trip.id!) ? (
              <AppButton label="Przywróć z archiwum" onPress={() => archiveTrip(trip, false)} small />
            ) : (
              <AppButton label="Do archiwum" onPress={() => archiveTrip(trip, true)} small />
            )}
          </View>
        </View>
      )}
    </ThemedView>
  );

  return (
    <View style={styles.card}>
      <ThemedText type="subtitle">Wyjazdy</ThemedText>
      {error !== '' && <ThemedText type="small">{error}</ThemedText>}
      {offline && (
        <ThemedText type="small">
          {signedIn ? 'Bez połączenia — lista z ostatniej synchronizacji.' : 'Niezalogowany — wyjazdy pobrane na telefon, tylko do odczytu.'}
        </ThemedText>
      )}
      {trips === null && <ThemedText type="small">Wczytuję…</ThemedText>}
      {trips?.length === 0 && (
        <ThemedText type="small">
          {signedIn ? 'Nie masz jeszcze wyjazdów — utwórz je na webie albo dołącz z linku.' : 'Na telefonie nie ma pobranych wyjazdów — zaloguj się na ekranie Start.'}
        </ThemedText>
      )}
      {trips !== null && trips.length > 0 && ahead.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Żadnego wyjazdu przed Tobą{archive.length > 0 ? ' — poprzednie są w archiwum' : ''}.
        </ThemedText>
      )}
      {ahead.map(tripCard)}
      {postponed.length > 0 && (
        <Pressable onPress={() => setPostponedOpen(!postponedOpen)} hitSlop={8} style={styles.archiveHead}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Odłożone ({postponed.length})
          </ThemedText>
          <ThemedText themeColor="accent">{postponedOpen ? '▾' : '▸'}</ThemedText>
        </Pressable>
      )}
      {postponedOpen && postponed.map(tripCard)}
      {archive.length > 0 && (
        <Pressable onPress={() => setArchiveOpen(!archiveOpen)} hitSlop={8} style={styles.archiveHead}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Archiwum ({archive.length})
          </ThemedText>
          <ThemedText themeColor="accent">{archiveOpen ? '▾' : '▸'}</ThemedText>
        </Pressable>
      )}
      {archiveOpen && archive.map(tripCard)}
      {drafts.length > 0 && (
        <Pressable onPress={() => setDraftsOpen(!draftsOpen)} hitSlop={8} style={styles.archiveHead}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Szkice ({drafts.length})
          </ThemedText>
          <ThemedText themeColor="accent">{draftsOpen ? '▾' : '▸'}</ThemedText>
        </Pressable>
      )}
      {draftsOpen && drafts.map(tripCard)}
      <PlanScreen
        tripId={plan}
        signedIn={signedIn}
        canAct={['owner', 'editor'].includes(trips?.find((trip) => trip.id === plan)?.role ?? '')}
        canAddExpense={trips?.find((trip) => trip.id === plan)?.can_add_expenses === true}
        userId={userId}
        onClose={() => setPlan(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: Spacing.three },
  trip: { borderRadius: 16, borderWidth: 1.5, padding: Spacing.three, gap: Spacing.two },
  tripHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tripTitle: { fontSize: 17, lineHeight: 22 },
  grow: { flex: 1 },
  details: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  archiveHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.two },
});
