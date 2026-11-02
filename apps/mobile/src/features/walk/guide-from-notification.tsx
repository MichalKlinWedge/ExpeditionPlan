import type { PlanItem } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip } from '@expeditionplan/sync';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';

import { ItemDetails } from '@/features/plan/item-details';
import { localDb } from '@/lib/local-db';

/**
 * Dotknięcie powiadomienia „Jesteś przy X” (spacer z przewodnikiem): szczegóły punktu na wierzchu
 * i od razu czytanie przewodnika. Także wtedy, gdy powiadomienie uruchomiło aplikację od zera.
 */
export function GuideFromNotification() {
  const [open, setOpen] = useState<{ trip: CachedTrip; item: PlanItem } | null>(null);

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as { guideTrip?: unknown; guideItem?: unknown } | undefined;
      if (typeof data?.guideTrip !== 'string' || typeof data.guideItem !== 'string') return;
      // Bez tego ta sama odpowiedź otwierałaby przewodnik przy każdym starcie.
      void Notifications.clearLastNotificationResponseAsync();
      const trip = cachedTrip(localDb, data.guideTrip);
      const item = trip?.state.doc.items.find((each) => each.ref === data.guideItem);
      if (trip && item) setOpen({ trip, item });
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
    return () => subscription.remove();
  }, []);

  if (open === null) return null;
  return <ItemDetails trip={open.trip} item={open.item} autoPlay onClose={() => setOpen(null)} />;
}
