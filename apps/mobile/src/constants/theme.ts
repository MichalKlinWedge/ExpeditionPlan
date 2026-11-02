/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Motyw „Kompas i mapa” (wspólny z webem): papier mapy, granat nawigacyjny, pomarańcz sygnałowy
 * na głównych akcjach (`primary`), morska zieleń jako akcent (`accent` — wybór, linki).
 */
export const Colors = {
  light: {
    text: '#1B2A41',
    background: '#F7F3EA',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E4DCC9',
    textSecondary: '#5F6B7A',
    primary: '#E8692C',
    onPrimary: '#FFFFFF',
    accent: '#2E7D74',
    accentSoft: '#D8ECE8',
  },
  dark: {
    text: '#F1EBDD',
    background: '#0F1A2B',
    backgroundElement: '#1B2A41',
    backgroundSelected: '#34425A',
    textSecondary: '#9CA6B5',
    primary: '#E8692C',
    onPrimary: '#FFFFFF',
    accent: '#5FC2B5',
    accentSoft: '#1E3B3F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
