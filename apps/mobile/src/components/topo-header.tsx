import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Granatowy nagłówek z „poziomicami” (koncentryczne owale jak warstwice na mapie) — wspólny motyw
 * z webem. `actions` po prawej (np. aktualizacja, ustawienia) — na granacie używaj jasnych kolorów.
 */
const INK = '#1B2A41';
const RINGS = [
  { width: 300, height: 170, right: -110, bottom: -95 },
  { width: 230, height: 128, right: -75, bottom: -74 },
  { width: 160, height: 88, right: -40, bottom: -54 },
  { width: 92, height: 50, right: -6, bottom: -35 },
];

export function TopoHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <View style={styles.card}>
      {RINGS.map((ring, i) => (
        <View key={i} pointerEvents="none" style={[styles.ring, ring]} />
      ))}
      <View style={styles.row}>
        <View style={styles.badge}>
          <View style={styles.needle} />
        </View>
        <View style={styles.titles}>
          <ThemedText style={styles.title}>{title}</ThemedText>
          {subtitle ? <ThemedText style={styles.subtitle}>{subtitle}</ThemedText> : null}
        </View>
        {actions}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: INK, borderRadius: 20, padding: Spacing.three, paddingVertical: Spacing.four, overflow: 'hidden', elevation: 4 },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.09)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8692C', alignItems: 'center', justifyContent: 'center' },
  // Igła kompasu: romb z obróconego kwadratu.
  needle: { width: 14, height: 14, borderWidth: 2.5, borderColor: '#FFFFFF', transform: [{ rotate: '45deg' }], borderRadius: 2 },
  titles: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 26, lineHeight: 32, fontWeight: 800 },
  subtitle: { color: '#CFC4AB', fontSize: 14, lineHeight: 18 },
});
