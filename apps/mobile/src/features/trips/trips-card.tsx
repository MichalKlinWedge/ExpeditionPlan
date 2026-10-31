import type { Tables } from '@expeditionplan/db';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Moje wyjazdy (MVP-1): lista z rolą, po dotknięciu — plan w liczbach, uczestnicy i kto ma dostęp. */

const ROLE: Record<string, string> = { owner: 'właściciel', editor: 'edytor', viewer: 'widz' };

type Trip = Tables<'my_trips'>;
type Details = {
  travelers: { id: string; name: string; age: number | null }[];
  members: { role: string; name: string }[];
  days: number;
  items: number;
};

export function TripsCard({ reloadKey }: { reloadKey: number }) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('my_trips').select('*').order('start_date');
    setError(loadError?.message ?? '');
    setTrips(data ?? []);
  }, []);

  // Pierwsze wczytanie z timera, nie wprost w efekcie (reguła react-hooks/set-state-in-effect).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load, reloadKey]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDetails(null);
    const [travelers, members, days, items] = await Promise.all([
      supabase.from('travelers').select('id, name, age').eq('trip_id', id).is('deleted_at', null).order('sort_key'),
      supabase.from('trip_members').select('role, profiles(display_name)').eq('trip_id', id),
      supabase.from('days').select('id', { count: 'exact', head: true }).eq('trip_id', id).is('deleted_at', null),
      supabase.from('items').select('id', { count: 'exact', head: true }).eq('trip_id', id).is('deleted_at', null),
    ]);
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
      {trips === null && <ThemedText type="small">Wczytuję…</ThemedText>}
      {trips?.length === 0 && <ThemedText type="small">Nie masz jeszcze wyjazdów — utwórz je na webie albo dołącz z linku.</ThemedText>}
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
                <ThemedText type="small">Wczytuję…</ThemedText>
              ) : (
                <>
                  <ThemedText type="small">
                    Plan: {details.days} dni, {details.items} punktów
                  </ThemedText>
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  trip: { gap: Spacing.one, paddingVertical: Spacing.one },
  details: { gap: Spacing.one, paddingLeft: Spacing.two },
});
