import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Błąd w jednym widoku nie zamyka aplikacji: zamiast tego widać, co się wysypało (do zgłoszenia).
 * W wersji produkcyjnej nieobsłużony błąd renderowania zamyka aplikację bez słowa.
 */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <View style={styles.box}>
        <ThemedText type="smallBold">{this.props.label} — coś poszło nie tak</ThemedText>
        <ThemedText type="small" selectable>
          {error.name}: {error.message}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {(error.stack ?? '').split('\n').slice(0, 6).join('\n')}
        </ThemedText>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12, borderWidth: 1, borderColor: '#d32f2f' },
});
