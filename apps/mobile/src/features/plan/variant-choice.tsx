import { groupTally, type TripDocument, type Votes } from '@expeditionplan/core';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Group = TripDocument['variantGroups'][number];

/** Głosowanie w oknie wariantów: głosy wyjazdu, za kogo głosuję (`null` = nie mogę) i zapis (outbox, także offline). */
export type Voting = { votes: Votes; voterRef: string | null; onVote: (groupRef: string, variantRef: string | null, withdrawn: boolean) => void };

/**
 * Wybór wariantu w planie dnia: tylko wybrany wariant i „Zmień”, które otwiera okno z wariantami
 * grupy (★ = polecany, krótki opis, plusy i minusy). Wybór idzie do `onChoose` jak dotąd. Z `voting` przy każdym
 * wariancie są głosy i „Głosuję” — głos to podpowiedź dla organizatora, wyboru nie zmienia. Tylko w grupach,
 * nad którymi organizator otworzył głosowanie (`votingOpen`).
 */
export function VariantChoice({ doc, group, active, onChoose, voting }: { doc: TripDocument; group: Group; active: ReadonlySet<string>; onChoose: (groupRef: string, variantRef: string) => void; voting?: Voting | null }) {
  if (group.votingOpen !== true) voting = null;
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const variants = doc.variants.filter((variant) => variant.groupRef === group.ref);
  const chosen = variants.find((variant) => active.has(variant.ref));
  const label = (variant: (typeof variants)[number]) => `${variant.label}${variant.recommended ? ' ★' : ''}`;
  const tally = voting ? groupTally(doc, group.ref, voting.votes) : null;
  const myVote = tally && voting?.voterRef ? tally.byTraveler[voting.voterRef] : undefined;
  const voters = (variantRef: string) => tally?.options.find((option) => option.variantRef === variantRef)?.voters ?? [];
  const summary = tally && tally.options.some((option) => option.voters.length > 0) ? tally.options.map((option) => `${option.label} ${option.voters.length}`).join(' · ') : null;

  return (
    <View style={styles.line}>
      <ThemedText type="small" style={styles.grow}>
        <ThemedText type="small" themeColor="textSecondary">
          {group.title}:{' '}
        </ThemedText>
        <ThemedText type="smallBold">{chosen === undefined ? 'nie wybrano' : label(chosen)}</ThemedText>
      </ThemedText>
      {variants.length > 1 && <Button label={voting?.voterRef ? 'Zmień / głosuj' : 'Zmień'} small onPress={() => setOpen(true)} />}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <ThemedView style={styles.sheet}>
            <ThemedText type="smallBold">{group.title}</ThemedText>
            {summary && (
              <ThemedText type="small" themeColor="textSecondary">
                Głosy: {summary}
                {tally!.missing.length > 0 ? ` · nie głosowali: ${tally!.missing.join(', ')}` : ''}
              </ThemedText>
            )}
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
                    {voting && (
                      <View style={styles.vote}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                          głosy: {voters(variant.ref).length}
                          {voters(variant.ref).length > 0 ? ` (${voters(variant.ref).join(', ')})` : ''}
                        </ThemedText>
                        {voting.voterRef !== null &&
                          (myVote === variant.ref ? (
                            <Button label="✓ Twój głos · wycofaj" small onPress={() => voting.onVote(group.ref, variant.ref, true)} />
                          ) : (
                            <Button label="Głosuję" small onPress={() => voting.onVote(group.ref, variant.ref, false)} />
                          ))}
                      </View>
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
  vote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
});
