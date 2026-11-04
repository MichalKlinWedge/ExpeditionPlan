import { supabase } from '@/lib/supabase';

/**
 * Wywołania Planner Hub (web) z telefonu — tam, gdzie potrzebny jest klucz serwera (AI). Klucze
 * nigdy nie trafiają do APK: telefon wysyła token sesji, a web sprawdza dostęp jak przy akcjach.
 */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://expedition-plan.vercel.app';

/** Odpowiedź `/api/receipt` — jak `ReceiptDraft` w `packages/planner/src/receipt.ts`. */
export type ReceiptDraft = { amountMinor: number | null; currency: string | null; date: string | null; merchant: string | null; category: string | null };

/** Szkic wydatku z obrazu paragonu (base64); `null` = na zdjęciu nie ma paragonu. Bez sieci — wyjątek. */
export async function readReceiptPhoto(tripId: string, currencies: string[], image: { mimeType: string; data: string }): Promise<ReceiptDraft | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new Error('Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(`${WEB_URL}/api/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tripId, currencies, image }),
    });
  } catch {
    throw new Error('Brak połączenia — paragon odczytam, gdy będzie sieć. Kwotę możesz wpisać ręcznie.');
  }
  const body = (await response.json().catch(() => ({}))) as { draft?: ReceiptDraft | null; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Serwer odpowiedział ${response.status}.`);
  return body.draft ?? null;
}

export type EateryKind = 'restaurant' | 'fast_food' | 'cafe' | 'pub';
export type EateryDiet = 'vegetarian' | 'vegan' | 'gluten_free' | 'halal';

/** Wynik `/api/eateries` — jak `EateryResult` w `packages/planner/src/meal-eateries.ts` (`Eatery` z core + odległość i godziny). */
export type EateryResult = {
  name: string;
  lat: number;
  lng: number;
  kind: EateryKind;
  address?: string;
  cuisine?: string;
  openingHours?: string;
  website?: string;
  phone?: string;
  osm?: { type: string; id: number };
  vegetarian?: boolean;
  vegan?: boolean;
  distanceM: number;
  open: { state: 'open' | 'closed' | 'partly' | 'unknown'; hours?: string };
  summary: string;
};
export type EateryAnswer = { center: { lat: number; lng: number; near: string }; results: EateryResult[] };

/**
 * Knajpy w pobliżu posiłku (Geoapify na serwerze). `position` — tylko po wyraźnym „Szukaj wokół
 * mnie”, już zaokrąglona; bez niej serwer szuka przy miejscu posiłku z planu. Bez sieci — wyjątek.
 */
export async function findEateriesNearby(query: { tripId: string; itemRef: string; kinds: EateryKind[]; radiusM: number; diet?: EateryDiet; position?: { lat: number; lng: number } }): Promise<EateryAnswer> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new Error('Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(`${WEB_URL}/api/eateries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(query),
    });
  } catch {
    throw new Error('Brak połączenia — knajpy wyszukam, gdy będzie sieć.');
  }
  const body = (await response.json().catch(() => ({}))) as Partial<EateryAnswer> & { error?: string };
  if (!response.ok || body.results === undefined || body.center === undefined) throw new Error(body.error ?? `Serwer odpowiedział ${response.status}.`);
  return { center: body.center, results: body.results };
}
