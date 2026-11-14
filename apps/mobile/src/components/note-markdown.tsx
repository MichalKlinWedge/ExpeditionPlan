import { type MdInline, parseMarkdown } from '@expeditionplan/core';
import { Linking, StyleSheet, View } from 'react-native';

import { LinkedText } from '@/components/linked-text';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Uwagi punktu w Markdown (`core/note-markdown.ts`, te same co na webie): nagłówki, akapity z liniami,
 * listy, pogrubienie, kursywa i linki [opis](adres) — dotknięcie otwiera przeglądarkę; gołe adresy jak
 * dotąd przez `LinkedText`. Offline, z planu w telefonie.
 */
export function NoteMarkdown({ text, secondary = false }: { text: string; secondary?: boolean }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  const color = secondary ? ('textSecondary' as const) : undefined;
  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) =>
        block.kind === 'heading' ? (
          <ThemedText key={index} type="smallBold" style={block.level === 1 ? styles.h1 : undefined}>
            {/* Nagłówek pogrubiony także w kawałkach (wewnętrzne `ThemedText` mają własną grubość). */}
            <Inline parts={block.inline.map((part) => (part.kind === 'text' ? { ...part, bold: true as const } : part))} />
          </ThemedText>
        ) : block.kind === 'paragraph' ? (
          <ThemedText key={index} type="small" themeColor={color}>
            {block.lines.map((line, at) => (
              <ThemedText key={at} type="small" themeColor={color}>
                {at > 0 ? '\n' : ''}
                <Inline parts={line} color={color} />
              </ThemedText>
            ))}
          </ThemedText>
        ) : (
          <View key={index} style={styles.list}>
            {block.items.map((item, at) => (
              <View key={at} style={styles.item}>
                <ThemedText type="small" themeColor={color} style={styles.mark}>
                  {block.ordered ? `${at + 1}.` : '•'}
                </ThemedText>
                <ThemedText type="small" themeColor={color} style={styles.grow}>
                  <Inline parts={item} color={color} />
                </ThemedText>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

function Inline({ parts, color }: { parts: MdInline[]; color?: 'textSecondary' }) {
  return parts.map((part, index) =>
    part.kind === 'link' ? (
      <ThemedText key={index} type="small" themeColor="accent" style={styles.link} onPress={() => void Linking.openURL(part.url)} accessibilityRole="link" accessibilityHint={part.url}>
        {part.label}
      </ThemedText>
    ) : (
      <ThemedText key={index} type="small" themeColor={color} style={[part.bold && styles.bold, part.italic && styles.italic]}>
        <LinkedText text={part.text} />
      </ThemedText>
    ),
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  h1: { fontSize: 16 },
  list: { gap: 2 },
  item: { flexDirection: 'row', gap: Spacing.one },
  mark: { minWidth: 16 },
  grow: { flex: 1 },
  link: { textDecorationLine: 'underline' },
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
});
