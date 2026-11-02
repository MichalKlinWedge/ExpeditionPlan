import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setCurrentTrip, type Trip } from '@/features/trips/my-trips';
import { useTheme } from '@/hooks/use-theme';

/**
 * Nagłówek zakładek Plan i Mapa: wybrany wyjazd (ten sam co w zakładce Wyjazdy), a przy kilku —
 * „Zmień” rozwija listę. Wybór zapamiętuje się dla wszystkich zakładek.
 */
export function TripSwitcher({ trips, selected, onSelect }: { trips: Trip[]; selected: string; onSelect: (id: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const trip = trips.find((each) => each.id === selected);
  const many = trips.length > 1;

  const choose = (id: string) => {
    setCurrentTrip(id);
    setOpen(false);
    onSelect(id);
  };

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.backgroundSelected }]}>
      <Pressable onPress={() => many && setOpen((value) => !value)} disabled={!many} style={styles.head} hitSlop={6}>
        <View style={styles.grow}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {trip?.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {trip?.start_date} – {trip?.end_date}
          </ThemedText>
        </View>
        {many && <ThemedText type="linkPrimary">{open ? 'Zwiń ▴' : 'Zmień ▾'}</ThemedText>}
      </Pressable>
      {open &&
        trips
          .filter((each) => each.id !== selected)
          .map((each) => (
            <Pressable key={each.id} onPress={() => choose(each.id!)} style={[styles.option, { borderTopColor: theme.backgroundSelected }]}>
              <ThemedText numberOfLines={1}>{each.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {each.start_date} – {each.end_date}
              </ThemedText>
            </Pressable>
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  option: { paddingVertical: Spacing.two, borderTopWidth: 1 },
});
