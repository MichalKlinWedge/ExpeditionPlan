import { dayExtras, EXTRA_FIT, extraDistanceText, extraMinutes, extraTimeText, type TripDocument } from '@expeditionplan/core';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * „Po drodze i w pobliżu” dnia na telefonie — tylko podgląd, offline z planu (`DocDay.extras`): atrakcje,
 * które da się dorzucić, gdy zostanie czas albo coś wypadnie, z dodatkowym czasem. Szukanie i zmiany są na webie.
 */
export function DayExtrasCard({ doc, dayRef, slackMin, open, onToggle }: { doc: TripDocument; dayRef: string; slackMin: number | null; open: boolean; onToggle: () => void }) {
  const list = dayExtras(doc, dayRef).open;
  if (list.length === 0) return null;
  const titles = new Map(doc.items.map((item) => [item.ref, item.title]));
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable onPress={onToggle} hitSlop={8}>
        <ThemedText type="linkPrimary">
          {open ? '▾' : '▸'} ★ Po drodze i w pobliżu ({list.length})
        </ThemedText>
      </Pressable>
      {open && (
        <>
          {list.map((extra) => {
            const near = extra.nearRef === undefined ? undefined : titles.get(extra.nearRef);
            const swap = extra.swapRef === undefined ? undefined : titles.get(extra.swapRef);
            const minutes = extraMinutes(extra);
            return (
              <View key={extra.id} style={styles.entry}>
                <ThemedText type="smallBold">
                  {extra.title}
                  {extra.type ? <ThemedText type="small" themeColor="textSecondary">{` · ${extra.type}`}</ThemedText> : null}
                </ThemedText>
                <ThemedText type="small">
                  {extraTimeText(extra)}
                  <ThemedText type="small" themeColor="textSecondary">
                    {` · ${EXTRA_FIT[extra.fit]} · ${extraDistanceText(extra)}${near ? ` · przy „${near}”` : ''}`}
                    {extra.fit !== 'pass' && slackMin !== null ? (minutes <= slackMin ? ' · mieści się w zapasie dnia' : ' · więcej niż zapas dnia') : ''}
                  </ThemedText>
                </ThemedText>
                {swap ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    ⇄ może zastąpić „{swap}”, gdy wypadnie
                  </ThemedText>
                ) : null}
                {extra.why ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {extra.why}
                  </ThemedText>
                ) : null}
                <View style={styles.links}>
                  {extra.wikipedia ? (
                    <Pressable onPress={() => void Linking.openURL(extra.wikipedia!)} hitSlop={6}>
                      <ThemedText type="linkPrimary">Wikipedia</ThemedText>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${extra.lat},${extra.lng}`)} hitSlop={6}>
                    <ThemedText type="linkPrimary">Mapa</ThemedText>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <ThemedText type="small" themeColor="textSecondary">
            Atrakcje: © OpenStreetMap (ODbL); wybór i opis: AI; czas objazdu szacunkowy. Zmiany na webie.
          </ThemedText>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: 14, gap: Spacing.two },
  entry: { gap: 2 },
  links: { flexDirection: 'row', gap: Spacing.three },
});
