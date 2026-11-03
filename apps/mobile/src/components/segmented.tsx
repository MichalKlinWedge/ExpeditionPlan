import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Dwa wyglądy wyboru, inne niż pigułki (`Chip`), żeby poziomy ekranu się nie myliły:
 * `Tabs` — główne części ekranu, zakładki z podkreśleniem; przewijane w bok, gdy się nie mieszczą
 *   (wybrana przewija się do widoku), na szerokim ekranie rozciągnięte na całą szerokość;
 * `Segmented` — mały przełącznik opcji (np. scenariusz) z podpisem.
 */

type Option<T extends string> = { value: T; label: string };

export function Tabs<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  const theme = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const width = useRef(0);
  const spots = useRef<Record<string, { x: number; width: number }>>({});
  // Wybrana zakładka na środek, żeby było widać też sąsiednie (że jest coś dalej).
  const reveal = (key: string, animated = true) => {
    const spot = spots.current[key];
    if (spot !== undefined) scroll.current?.scrollTo({ x: Math.max(0, spot.x + spot.width / 2 - width.current / 2), animated });
  };
  useEffect(() => reveal(value), [value]);
  return (
    <View style={[styles.tabs, { borderBottomColor: theme.backgroundSelected }]} onLayout={(event) => (width.current = event.nativeEvent.layout.width)}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              onLayout={(event) => {
                spots.current[option.value] = event.nativeEvent.layout;
                if (active) reveal(option.value, false);
              }}
              style={[styles.tab, { borderBottomColor: active ? theme.accent : 'transparent' }]}>
              <ThemedText type={active ? 'smallBold' : 'small'} numberOfLines={1} style={{ color: active ? theme.accent : theme.textSecondary }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={[styles.segments, { borderColor: theme.accent }]}>
        {options.map((option, at) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.segment, at > 0 && { borderLeftWidth: 1, borderLeftColor: theme.accent }, active && { backgroundColor: theme.accentSoft }]}>
              <ThemedText type={active ? 'smallBold' : 'small'} style={{ color: active ? theme.accent : theme.textSecondary }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { borderBottomWidth: 1 },
  tabsRow: { flexGrow: 1, paddingHorizontal: Spacing.two },
  tab: { flexGrow: 1, alignItems: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderBottomWidth: 3, marginBottom: -1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  segments: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  segment: { paddingHorizontal: Spacing.two + 2, paddingVertical: 3 },
});
