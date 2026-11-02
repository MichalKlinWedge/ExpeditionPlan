import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Dwa wyglądy wyboru, inne niż pigułki (`Chip`), żeby poziomy ekranu się nie myliły:
 * `Tabs` — główne części ekranu, zakładki z podkreśleniem na całą szerokość;
 * `Segmented` — mały przełącznik opcji (np. scenariusz) z podpisem.
 */

type Option<T extends string> = { value: T; label: string };

export function Tabs<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.tabs, { borderBottomColor: theme.backgroundSelected }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.tab, { borderBottomColor: active ? theme.accent : 'transparent' }]}>
            <ThemedText type={active ? 'smallBold' : 'small'} style={{ color: active ? theme.accent : theme.textSecondary }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
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
  tabs: { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: Spacing.two },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderBottomWidth: 3, marginBottom: -1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  segments: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  segment: { paddingHorizontal: Spacing.two + 2, paddingVertical: 3 },
});
