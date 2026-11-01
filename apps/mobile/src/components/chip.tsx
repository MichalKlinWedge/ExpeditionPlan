import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Przycisk-pigułka wyboru (dni, scenariusz, waluta, kategoria…). */
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

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
});
