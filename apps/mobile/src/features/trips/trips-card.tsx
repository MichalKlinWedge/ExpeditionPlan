import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PlanScreen } from '@/features/plan/plan-screen';
import { useTheme } from '@/hooks/use-theme';
import { loadMyTrips, removeTrip, type Trip } from '@/features/trips/my-trips';
import { supabase } from '@/lib/supabase';

/**
 * Moje wyjazdy (MVP-1): lista z rolą, po dotknięciu — plan w liczbach, uczestnicy, kto ma dostęp
 * i wejście w plan dnia. Bez logowania (`signedIn = false`) — lista i plany z telefonu, do odczytu.
 * Z siecią właściciel usuwa wyjazd, pozostali z niego wychodzą.
 */

const ROLE: Record<string, string> = { owner: 'właściciel', editor: 'edytor', viewer: 'widz' };

type Details = {
  travelers: { id: string; name: string; age: number | null }[];
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

  const load = useCallback(async () => {
    const result = await loadMyTrips(signedIn);
    setError(result.error);
    setOffline(result.offline);
    setTrips(result.trips);
  }, [signedIn]);

  // Pierwsze wczytanie z timera, nie wprost w efekcie (reguła react-hooks/set-state-in-effect).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load, reloadKey]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDetails(null);
    if (!signedIn) return;
    const [travelers, members, days, items] = await Promise.all([
      supabase.from('travelers').select('id, name, age').eq('trip_id', id).is('deleted_at', null).order('sort_key'),
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

  const remove = (trip: Trip) => {
    const owner = trip.role === 'owner';
    Alert.alert(
      owner ? 'Usunąć wyjazd?' : 'Opuścić wyjazd?',
      owner
        ? `„${trip.title}” zniknie u wszystkich uczestników — na webie i na telefonach.`
        : `„${trip.title}” zniknie z Twojej listy. Wrócić można tylko z nowego zaproszenia.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: owner ? 'Usuń' : 'Opuść',
          style: 'destructive',
          onPress: async () => {
            const failure = await removeTrip(trip);
            if (failure !== null) return Alert.alert(owner ? 'Nie usunięto wyjazdu' : 'Nie opuszczono wyjazdu', failure);
            setOpen(null);
            setPlan((current) => (current === trip.id ? null : current));
            setTrips((current) => current?.filter((each) => each.id !== trip.id) ?? null);
          },
        },
      ],
    );
  };

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
      {trips?.map((trip) => (
        <ThemedView key={trip.id} type="backgroundElement" style={[styles.trip, { borderColor: open === trip.id ? theme.accent : theme.backgroundSelected }]}>
          <Pressable onPress={() => void toggle(trip.id!)} style={styles.tripHead}>
            <View style={styles.grow}>
              <ThemedText type="smallBold" style={styles.tripTitle}>
                {trip.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {trip.start_date} – {trip.end_date} · {ROLE[trip.role!]}
              </ThemedText>
            </View>
            <ThemedText themeColor="accent">{open === trip.id ? '▾' : '▸'}</ThemedText>
          </Pressable>
          {open === trip.id && (
            <View style={styles.details}>
              {details === null ? (
                <>
                  {!offline && <ThemedText type="small">Wczytuję…</ThemedText>}
                  <AppButton label="Plan dzień po dniu →" onPress={() => setPlan(trip.id)} variant="primary" />
                </>
              ) : (
                <>
                  <ThemedText type="small">
                    Plan: {details.days} dni, {details.items} punktów
                  </ThemedText>
                  {details.days > 0 && (
                    <AppButton label="Plan dzień po dniu →" onPress={() => setPlan(trip.id)} variant="primary" />
                  )}
                  <ThemedText type="small">
                    Uczestnicy:{' '}
                    {details.travelers.map((person) => (person.age === null ? person.name : `${person.name} (${person.age})`)).join(', ') || '—'}
                  </ThemedText>
                  <ThemedText type="small">
                    Dostęp: {details.members.map((member) => `${member.name} — ${ROLE[member.role]}`).join(', ')}
                  </ThemedText>
                </>
              )}
              {signedIn && !offline && (
                <Pressable onPress={() => remove(trip)} hitSlop={8}>
                  <ThemedText type="small" style={styles.danger}>
                    {trip.role === 'owner' ? 'Usuń wyjazd' : 'Opuść wyjazd'}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          )}
        </ThemedView>
      ))}
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
  danger: { color: '#d32f2f', paddingTop: Spacing.one },
});
