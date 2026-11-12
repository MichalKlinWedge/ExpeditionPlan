import type { TripDocument } from '@expeditionplan/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { VariantChoice, type Voting } from '@/features/plan/variant-choice';
import { useTheme } from '@/hooks/use-theme';

type Group = TripDocument['variantGroups'][number];

/**
 * „Wybory” w planie dnia: wszystkie wiersze wyboru wariantów dnia w jednej zwijanej sekcji, żeby nie
 * zajmowały miejsca nad planem. W nagłówku liczba wyborów i ile jeszcze bez wyboru. Rozwinięcie jest
 * zapamiętane na telefonie (jedno dla wszystkich dni i wyjazdów).
 */

const KEY = 'plan_choices_open';

function savedOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function ChoicesSection({
  doc,
  groups,
  active,
  onChoose,
  voting,
}: {
  doc: TripDocument;
  groups: Group[];
  active: ReadonlySet<string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  voting?: Voting | null;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(savedOpen);
  if (groups.length === 0) return null;
  const undecided = groups.filter((group) => !doc.variants.some((variant) => variant.groupRef === group.ref && active.has(variant.ref))).length;
  const toggle = () => {
    setOpen(!open);
    try {
      if (open) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '1');
    } catch {
      // Bez zapisu sekcja wróci zwinięta przy następnym otwarciu.
    }
  };

  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.backgroundSelected }]}>
      <Pressable onPress={toggle} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.head}>
        <ThemedText type="smallBold" style={styles.grow}>
          {open ? '▾' : '▸'} Wybory ({groups.length})
        </ThemedText>
        {undecided > 0 && (
          <ThemedText type="small" style={{ color: theme.primary }}>
            {undecided} bez wyboru
          </ThemedText>
        )}
      </Pressable>
      {open && (
        <View style={styles.list}>
          {groups.map((group) => (
            <VariantChoice key={group.ref} doc={doc} group={group} active={active} onChoose={onChoose} voting={voting} />
          ))}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 32 },
  grow: { flex: 1 },
  list: { gap: Spacing.two },
});
