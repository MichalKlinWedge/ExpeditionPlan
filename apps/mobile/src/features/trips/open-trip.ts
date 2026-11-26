import { router } from 'expo-router';

import type { PlanTabName } from '@/features/plan/plan-screen';
import { setCurrentTrip } from '@/features/trips/my-trips';

/**
 * Zakładka Plan na danym wyjeździe i jego zakładce (np. zadania). `at` zmienia się przy każdym wejściu,
 * więc działa też wtedy, gdy Plan był już otwarty na innym wyjeździe albo innej zakładce (`app/plan.tsx`).
 */
export function openTripTab(tripId: string, tab: PlanTabName) {
  setCurrentTrip(tripId);
  router.navigate(`/plan?tab=${tab}&at=${Date.now()}`);
}
