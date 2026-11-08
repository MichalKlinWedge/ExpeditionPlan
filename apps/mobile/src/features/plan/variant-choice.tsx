import type { TripDocument } from '@expeditionplan/core';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Group = TripDocument['variantGroups'][number];

/**
 * Wybór wariantu w planie dnia: tylko wybrany wariant i „Zmień”, które otwiera okno z wariantami
 * grupy (★ = polecany, krótki opis, plusy i minusy). Wybór idzie do `onChoose` jak dotąd.
 */
export function VariantChoice({ doc, group, active, onChoose }: { doc: TripDocument; group: Group; active: ReadonlySet<string>; onChoose: (groupRef: string, variantRef: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const variants = doc.variants.filter((variant) => variant.groupRef === group.ref);
  const chosen = variants.find((variant) => active.has(variant.ref));
  const label = (variant: (typeof variants)[number]) => `${variant.label}${variant.recommended ? ' ★' : ''}`;

  return (
    <View style={styles.line}>
      <ThemedText type="small" style={styles.grow}>
        <ThemedText type="small" themeColor="textSecondary">
          {group.title}:{' '}
        </ThemedText>
        <ThemedText type="smallBold">{chosen === undefined ? 'nie wybrano' : label(chosen)}</ThemedText>
      </ThemedText>
      {variants.length > 1 && <Button label="Zmień" small onPress={() => setOpen(true)} />}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <ThemedView style={styles.sheet}>
            <ThemedText type="smallBold">{group.title}</ThemedText>
            <ScrollView>
              {variants.map((variant) => {
                const on = active.has(variant.ref);
                return (
                  <Pressable
                    key={variant.ref}
                    onPress={() => {
                      setOpen(false);
                      if (!on) onChoose(group.ref, variant.ref);
                    }}
                    style={[styles.row, { borderColor: theme.backgroundSelected }]}>
                    <ThemedText type={on ? 'smallBold' : 'small'} style={on ? { color: theme.accent } : undefined}>
                      {on ? '✓ ' : ''}
                      {label(variant)}
                    </ThemedText>
                    {variant.summary ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {variant.summary}
                      </ThemedText>
                    ) : null}
                    {variant.pros.length > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        + {variant.pros.join(' · ')}
                      </ThemedText>
                    )}
                    {variant.cons.length > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        − {variant.cons.join(' · ')}
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button label="Anuluj" small onPress={() => setOpen(false)} style={styles.cancel} />
          </ThemedView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: Spacing.four },
  sheet: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, maxHeight: '80%' },
  row: { paddingVertical: Spacing.three, borderBottomWidth: 1, gap: 2 },
  cancel: { alignSelf: 'flex-end' },
});
