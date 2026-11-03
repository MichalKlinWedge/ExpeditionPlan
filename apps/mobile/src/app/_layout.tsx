// Najpierw `crypto.getRandomValues` (id zapisów z telefonu).
import '@/lib/polyfills';
// Ślad krytycznego błędu JS na następny start — zanim cokolwiek innego się załaduje.
import { showLastCrash } from '@/lib/crash-log';
// Zadania w tle (PoC-3) muszą się zarejestrować przy ładowaniu modułu, zanim ruszy nawigacja.
import '@/poc/tasks';
import '@/features/walk/guide-walk';

import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { refreshCurrentReminders } from '@/features/trip/reminders';
import { UpdateWatcher } from '@/features/updates/update-notice';
import { GuideFromNotification } from '@/features/walk/guide-from-notification';

SplashScreen.preventAutoHideAsync();

// Powiadomienia o wykrytych punktach widoczne także przy otwartej aplikacji.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export default function TabLayout() {
  const colorScheme = useColorScheme();
  useEffect(showLastCrash, []);
  // Oś dnia trwającego wyjazdu: powiadomienia na najbliższe godziny, także gdy nikt nie otworzy planu.
  useEffect(() => {
    void refreshCurrentReminders().catch(() => undefined);
    const listener = AppState.addEventListener('change', (state) => state === 'active' && void refreshCurrentReminders().catch(() => undefined));
    return () => listener.remove();
  }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
      <UpdateWatcher />
      <GuideFromNotification />
    </ThemeProvider>
  );
}
