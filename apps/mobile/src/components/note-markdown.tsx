import { type MdBlock, type MdInline, parseMarkdown } from '@expeditionplan/core';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { LinkedText } from '@/components/linked-text';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Uwagi punktu w Markdown (`core/note-markdown.ts`, te same co na webie): nagłówki, akapity z liniami,
 * listy, tabele (przewijane w bok), pogrubienie, kursywa i linki [opis](adres) — dotknięcie otwiera przeglądarkę; gołe adresy jak
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
        ) : block.kind === 'table' ? (
          <NoteTable key={index} table={block} color={color} />
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

type MdTable = Extract<MdBlock, { kind: 'table' }>;

const plainLength = (parts: MdInline[]) => parts.reduce((sum, part) => sum + (part.kind === 'link' ? part.label : part.text).length, 0);

/** Tabela bez tabel RN: szerokość kolumny z najdłuższego tekstu (w granicach), dłuższy tekst się zawija. */
function NoteTable({ table, color }: { table: MdTable; color?: 'textSecondary' }) {
  const theme = useTheme();
  const widths = table.header.map((cell, column) => {
    const longest = Math.max(plainLength(cell), ...table.rows.map((row) => plainLength(row[column] ?? [])));
    return Math.min(220, Math.max(64, longest * 7.5 + 16));
  });
  const border = { borderColor: theme.backgroundSelected };
  const cellStyle = (column: number) => [styles.cell, border, { width: widths[column], alignItems: table.align[column] === 'right' ? ('flex-end' as const) : table.align[column] === 'center' ? ('center' as const) : ('flex-start' as const) }];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, border]}>
        <View style={[styles.row, { backgroundColor: theme.backgroundSelected }]}>
          {table.header.map((cell, column) => (
            <View key={column} style={cellStyle(column)}>
              <ThemedText type="smallBold">
                <Inline parts={cell.map((part) => (part.kind === 'text' ? { ...part, bold: true as const } : part))} />
              </ThemedText>
            </View>
          ))}
        </View>
        {table.rows.map((row, at) => (
          <View key={at} style={styles.row}>
            {row.map((cell, column) => (
              <View key={column} style={cellStyle(column)}>
                <ThemedText type="small" themeColor={color}>
                  <Inline parts={cell} color={color} />
                </ThemedText>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
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
  table: { borderTopWidth: 1, borderLeftWidth: 1 },
  row: { flexDirection: 'row' },
  cell: { borderRightWidth: 1, borderBottomWidth: 1, paddingHorizontal: Spacing.one, paddingVertical: 2 },
});
