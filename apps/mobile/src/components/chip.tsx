import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Przycisk-pigułka wyboru (dni, scenariusz, waluta, kategoria…). */
export function Chip({ active, label, onPress, compact = false }: { active: boolean; label: string; onPress: () => void; compact?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, compact && styles.compact, active ? { borderColor: theme.accent, backgroundColor: theme.accent } : { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type={active ? 'smallBold' : 'small'} style={active ? { color: theme.onPrimary } : { color: theme.textSecondary }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  /** Ciasna siatka (wszystkie dni wyjazdu naraz). */
  compact: { paddingHorizontal: Spacing.two, paddingVertical: 4 },
});
