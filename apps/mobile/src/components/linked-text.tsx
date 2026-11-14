import { splitLinks } from '@expeditionplan/core';
import { Linking, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/**
 * Kawałki tekstu, w którym wklejone adresy są klikalne: nazwa strony z globem (jak `btn-web` na webie),
 * dotknięcie otwiera przeglądarkę. Do wstawienia w `ThemedText`.
 */
export function LinkedText({ text }: { text: string }) {
  return splitLinks(text).map((part, index) =>
    'url' in part ? (
      <ThemedText key={index} themeColor="accent" style={styles.link} onPress={() => void Linking.openURL(part.url)} accessibilityRole="link" accessibilityHint={part.url}>
        🌐 {part.label}
      </ThemedText>
    ) : (
      part.text
    ),
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', fontWeight: 600 },
});
