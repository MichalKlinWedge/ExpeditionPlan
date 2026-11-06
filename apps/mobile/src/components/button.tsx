import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Wyraźny przycisk (motyw „Kompas i mapa”): `primary` — pomarańczowy, główna akcja ekranu;
 * `secondary` — biała karta z obrysem; `accent` — zaznaczony przełącznik (morska zieleń).
 * `danger` — czerwony napis przy usuwaniu.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  small = false,
  danger = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'accent';
  disabled?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const filled = variant !== 'secondary';
  const background = variant === 'primary' ? theme.primary : variant === 'accent' ? theme.accent : theme.backgroundElement;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: background, borderColor: filled ? background : theme.backgroundSelected },
        filled && styles.raised,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      <ThemedText type="smallBold" style={{ color: filled ? theme.onPrimary : danger ? DANGER : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const DANGER = '#D92D20';

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: Spacing.three },
  small: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 },
  raised: { elevation: 3, shadowColor: '#1B2A41', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45, elevation: 0 },
});
