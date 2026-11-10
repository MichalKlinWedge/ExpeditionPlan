import type { TripDocument } from '@expeditionplan/core';
import { Alert, Linking } from 'react-native';

/**
 * „Nawiguj” w całej aplikacji. Dwie drogi, wybierane w Ustawieniach:
 * - `google` (domyślnie) — trasa w Google Maps z trybem podróży z planu; bez internetu działa tylko
 *   na obszarze pobranym wcześniej w samych Google Maps;
 * - `other` — `geo:` do aplikacji wybranej w Androidzie (OsmAnd, Organic Maps, Mapy.com — nawigują
 *   na własnych mapach offline). `geo:` pokazuje cel, trasę włącza się już w tamtej aplikacji.
 */

export type NavApp = 'google' | 'other';
export type TravelMode = 'walking' | 'driving' | 'transit' | 'bicycling';

const KEY = 'nav_app';

export function navApp(): NavApp {
  try {
    return localStorage.getItem(KEY) === 'other' ? 'other' : 'google';
  } catch {
    return 'google';
  }
}

export function setNavApp(app: NavApp): void {
  try {
    if (app === 'other') localStorage.setItem(KEY, 'other');
    else localStorage.removeItem(KEY);
  } catch {
    // Bez zapisu zostaje Google Maps.
  }
}

type Leg = NonNullable<TripDocument['items'][number]['leg']>;

const MODE: Partial<Record<Leg['mode'], TravelMode>> = {
  walk: 'walking',
  hike: 'walking',
  bike: 'bicycling',
  car: 'driving',
  rental_car: 'driving',
  taxi: 'driving',
  hired_driver: 'driving',
  bus: 'transit',
  metro: 'transit',
  tram: 'transit',
  train: 'transit',
  ferry: 'transit',
  cable_car: 'transit',
};

/** Tryb podróży z przejazdu w planie (lot i łódź — bez trybu, Google wybierze sam). */
export const travelMode = (leg: Leg | undefined): TravelMode | undefined => (leg === undefined ? undefined : MODE[leg.mode]);

export type NavTarget = { lat: number; lng: number; name?: string };

export function navigateUrl(to: NavTarget, mode?: TravelMode, app: NavApp = navApp()): string {
  if (app === 'other') {
    const label = to.name ? `(${encodeURIComponent(to.name)})` : '';
    return `geo:${to.lat},${to.lng}?q=${to.lat},${to.lng}${label}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}${mode ? `&travelmode=${mode}` : ''}`;
}

/** Dokąd prowadzić do punktu planu: cel przejazdu albo miejsce punktu (ze współrzędnymi), z trybem z przejazdu. */
export function itemTarget(doc: TripDocument, itemRef: string): (NavTarget & { name: string; mode?: TravelMode }) | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  const ref = item?.leg?.toPlaceRef ?? item?.placeRef;
  const place = ref === undefined ? undefined : doc.places.find((each) => each.ref === ref);
  if (place?.lat === undefined || place.lng === undefined) return null;
  const mode = travelMode(item?.leg);
  return { name: place.name, lat: place.lat, lng: place.lng, ...(mode ? { mode } : {}) };
}

export function navigate(to: NavTarget, mode?: TravelMode): void {
  const app = navApp();
  Linking.openURL(navigateUrl(to, mode, app)).catch(() =>
    Alert.alert(
      'Nie otwarto nawigacji',
      app === 'other' ? 'Na telefonie nie ma aplikacji map, która przyjmuje cel (np. OsmAnd, Organic Maps, Mapy.com). Zmień wybór w Ustawieniach.' : 'Nie udało się otworzyć Google Maps.',
    ),
  );
}
