import { useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { openTripTab } from '@/features/trips/open-trip';

/**
 * Dotknięcie przypomnienia z planu (`reminders.ts`: dane `reminderTrip` i `key`) otwiera jego wyjazd:
 * przypomnienie o zadaniu (`task:…`) — listę zadań, pozostałe (oś dnia, pogoda, pobranie offline) — plan.
 * Także wtedy, gdy powiadomienie uruchomiło aplikację od zera: czeka, aż nawigacja będzie gotowa.
 */
export function ReminderFromNotification() {
  const ready = useRootNavigationState()?.key !== undefined;

  useEffect(() => {
    if (!ready) return;
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as { reminderTrip?: unknown; key?: unknown } | undefined;
      if (typeof data?.reminderTrip !== 'string') return;
      // Bez tego ta sama odpowiedź otwierałaby wyjazd przy każdym starcie.
      void Notifications.clearLastNotificationResponseAsync();
      const task = typeof data.key === 'string' && data.key.startsWith('task:');
      openTripTab(data.reminderTrip, task ? 'tasks' : 'plan');
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
    return () => subscription.remove();
  }, [ready]);

  return null;
}
