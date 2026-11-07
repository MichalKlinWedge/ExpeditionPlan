import { plural } from '@expeditionplan/core';
import { NEWS_ACTION, type NewsLine, type NewsSummary } from '@expeditionplan/sync';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * „Co nowego od ostatniej wizyty” nad zakładkami wyjazdu: zmiany innych osób (web lub inne telefony),
 * zwinięte do jednej linii. Rozwinięte — lista; punkt planu otwiera szczegóły. „Przejrzane” chowa ją
 * także na webie. Tylko online (`trip_news`); pusta lista — nic nie widać.
 */

const SHOWN = 12;

/** „dziś 14:05”, „wczoraj”, „3 dni temu”, „12.11”. */
function ago(iso: string, now: number): string {
  const at = new Date(iso);
  const days = Math.floor((now - at.getTime()) / 86_400_000);
  if (days <= 0) return `dziś ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (days === 1) return 'wczoraj';
  if (days < 7) return `${days} dni temu`;
  return `${at.getDate()}.${String(at.getMonth() + 1).padStart(2, '0')}`;
}

const changes = (n: number) => plural(n, ['zmiana', 'zmiany', 'zmian']);

function lineText(line: NewsLine): string {
  const fields = line.fields.length > 0 ? ` — ${line.fields.join(', ')}` : '';
  return `${NEWS_ACTION[line.action]} ${line.kind} ${line.title ? `„${line.title}”` : ''}${fields}`;
}

export function TripNewsBanner({ news, now, onSeen, onOpenItem }: { news: NewsSummary; now: number; onSeen: () => void; onOpenItem: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  const count = news.lines.length + (news.reordered > 0 ? 1 : 0);
  if (count === 0) return null;
  const authors = [...new Set(news.lines.flatMap((line) => line.actors))].slice(0, 3).join(', ');
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8} style={styles.head}>
        <ThemedText type="smallBold" style={styles.grow}>
          🔔 Co nowego: {news.lines.length > 0 ? changes(news.lines.length) : 'kolejność w planie'}
          {authors !== '' ? ` · ${authors}` : ''}
        </ThemedText>
        <ThemedText type="linkPrimary">{open ? 'zwiń' : 'pokaż'}</ThemedText>
      </Pressable>
      {open && (
        <View style={styles.list}>
          <ThemedText type="small" themeColor="textSecondary">
            od Twojej ostatniej wizyty ({ago(news.since, now)})
          </ThemedText>
          {news.lines.slice(0, SHOWN).map((line) => {
            const text = (
              <ThemedText type="small">
                {lineText(line)}
                <ThemedText type="small" themeColor="textSecondary">
                  {` · ${line.actors.join(', ')} · ${ago(line.at, now)}`}
                </ThemedText>
              </ThemedText>
            );
            return line.entity === 'items' && line.action !== 'removed' ? (
              <Pressable key={`${line.entity}:${line.id}`} onPress={() => onOpenItem(line.ref)}>
                {text}
              </Pressable>
            ) : (
              <View key={`${line.entity}:${line.id}`}>{text}</View>
            );
          })}
          {news.lines.length > SHOWN && (
            <ThemedText type="small" themeColor="textSecondary">
              …i {news.lines.length - SHOWN} więcej (pełna lista na webie)
            </ThemedText>
          )}
          {news.reordered > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              Zmieniona kolejność w planie: {news.reordered} pkt.
            </ThemedText>
          )}
          <Button label="Przejrzane" small onPress={onSeen} />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: Spacing.three, marginTop: Spacing.two, padding: Spacing.two, borderRadius: 12, gap: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  list: { gap: Spacing.one, alignItems: 'flex-start' },
});
