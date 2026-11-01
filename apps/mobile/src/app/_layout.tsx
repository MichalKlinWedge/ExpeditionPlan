// Najpierw `crypto.getRandomValues` (id zapisów z telefonu).
import '@/lib/polyfills';
// Zadania w tle (PoC-3) muszą się zarejestrować przy ładowaniu modułu, zanim ruszy nawigacja.
import '@/poc/tasks';

import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { UpdateWatcher } from '@/features/updates/update-notice';

SplashScreen.preventAutoHideAsync();

// Powiadomienia o wykrytych punktach widoczne także przy otwartej aplikacji.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
      <UpdateWatcher />
    </ThemeProvider>
  );
}
