import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PlanScreen } from '@/features/plan/plan-screen';
import { loadMyTrips, type Trip } from '@/features/trips/my-trips';
import { supabase } from '@/lib/supabase';

/**
 * Moje wyjazdy (MVP-1): lista z rolą, po dotknięciu — plan w liczbach, uczestnicy, kto ma dostęp
 * i wejście w plan dnia. Bez logowania (`signedIn = false`) — lista i plany z telefonu, do odczytu.
 */

const ROLE: Record<string, string> = { owner: 'właściciel', editor: 'edytor', viewer: 'widz' };

type Details = {
  travelers: { id: string; name: string; age: number | null }[];
  members: { role: string; name: string }[];
  days: number;
  items: number;
};

export function TripsCard({ reloadKey, signedIn, userId }: { reloadKey: number; signedIn: boolean; userId: string | null }) {
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

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
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
        <View key={trip.id} style={styles.trip}>
          <Pressable onPress={() => void toggle(trip.id!)}>
            <ThemedText>{trip.title}</ThemedText>
            <ThemedText type="small">
              {trip.start_date} – {trip.end_date} · {ROLE[trip.role!]}
            </ThemedText>
          </Pressable>
          {open === trip.id && (
            <View style={styles.details}>
              {details === null ? (
                <>
                  {!offline && <ThemedText type="small">Wczytuję…</ThemedText>}
                  <Pressable onPress={() => setPlan(trip.id)} hitSlop={8}>
                    <ThemedText type="linkPrimary">Plan dzień po dniu →</ThemedText>
                  </Pressable>
                </>
              ) : (
                <>
                  <ThemedText type="small">
                    Plan: {details.days} dni, {details.items} punktów
                  </ThemedText>
                  {details.days > 0 && (
                    <Pressable onPress={() => setPlan(trip.id)} hitSlop={8}>
                      <ThemedText type="linkPrimary">Plan dzień po dniu →</ThemedText>
                    </Pressable>
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
            </View>
          )}
        </View>
      ))}
      <PlanScreen
        tripId={plan}
        signedIn={signedIn}
        canAct={['owner', 'editor'].includes(trips?.find((trip) => trip.id === plan)?.role ?? '')}
        canAddExpense={trips?.find((trip) => trip.id === plan)?.can_add_expenses === true}
        userId={userId}
        onClose={() => setPlan(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  trip: { gap: Spacing.one, paddingVertical: Spacing.one },
  details: { gap: Spacing.one, paddingLeft: Spacing.two },
});
