import { z } from 'zod';

import { formatMoneyRange } from './budget.ts';
import { plainName } from './place-list.ts';
import { Currency, IsoDate, MinorAmount } from './schemas/common.ts';
import type { TripDocument, Venue, VenuePrice, VenueRating } from './schemas/trip-document.ts';

/**
 * Lokal na stronie „Posiłki”: punkty opisu, przykładowe ceny i ocena z tekstu, który wkleił użytkownik (Google Maps,
 * TripAdvisor, menu). AI robi szkic, a zapisuje człowiek po podglądzie. Kolejny odczyt dopisuje: nowe punkty i ceny
 * dochodzą do zapisanych, a ta sama nazwa ceny, ocena czy adres zmieniają się tylko po świadomym zaznaczeniu.
 */

type Doc = TripDocument;
type Place = Doc['places'][number];

const short = (max: number) => z.string().trim().min(1).max(max).nullable();

export const VENUE_POINT_LIMIT = 300;

export const VenueDraft = z.object({
  /** Czy tekst w ogóle dotyczy lokalu gastronomicznego. */
  isVenue: z.boolean(),
  points: z.array(z.string().trim().min(1).max(VENUE_POINT_LIMIT)).max(8),
  address: short(200),
  openingHours: short(200),
  website: z.url().regex(/^https?:\/\//i).max(500).nullable(),
  prices: z
    .array(
      z
        .object({ name: z.string().trim().min(1).max(80), currency: Currency, minMinor: MinorAmount, maxMinor: MinorAmount })
        .refine((price) => price.minMinor <= price.maxMinor, { message: 'Dolna granica ceny nie może być większa od górnej.', path: ['maxMinor'] }),
    )
    .max(8),
  rating: z
    .object({ value: z.number().positive(), scale: z.number().positive().max(100), count: z.number().int().positive().nullable(), source: short(40) })
    .refine((rating) => rating.value <= rating.scale, { message: 'Ocena nie może przekraczać skali.', path: ['value'] })
    .nullable(),
});
export type VenueDraft = z.infer<typeof VenueDraft>;

/** Klucz wiersza podglądu: `point:<nr>` i `price:<nr>` wskazują pozycję w szkicu, reszta to pola. */
export const VENUE_FIELD = /^(point:\d+|price:\d+|rating|address|openingHours|website)$/;

/** Wiersz podglądu; `current` — inna wartość, którą ten wiersz by zastąpił (nie zaznaczamy go domyślnie). */
export type VenueDraftRow = { key: string; label: string; value: string; current?: string };

/** Punkty opisu; dawny opis jednym tekstem jest pierwszym punktem. */
export const venuePoints = (venue: Venue | undefined): string[] => [...(venue?.description ? [venue.description] : []), ...(venue?.points ?? [])];

const samePoint = (a: string, b: string) => plainName(a) === plainName(b);

/** „4,6/5 · opinie: 1240 · Google Maps” */
export function venueRatingLabel(rating: Pick<VenueRating, 'value' | 'scale'> & { count?: number | null | undefined; source?: string | null | undefined }): string {
  const value = rating.value.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  return [`${value}/${rating.scale}`, rating.count ? `opinie: ${rating.count}` : null, rating.source ?? null].filter(Boolean).join(' · ');
}

/** „Pizza margherita: 32 zł”, „Zupa: 18 zł – 24 zł” */
export function venuePriceLabel(price: VenuePrice): string {
  return `${price.name}: ${formatMoneyRange(price.minMinor, price.maxMinor, price.currency)}`;
}

/** Wiersze szkicu do podglądu: każdy punkt i każda cena osobno, bez tych, które już są zapisane w tej samej postaci. */
export function venueDraftRows(place: Place, draft: VenueDraft): VenueDraftRow[] {
  const { venue } = place;
  const saved = venuePoints(venue);
  const rows: VenueDraftRow[] = [];
  draft.points.forEach((point, index) => {
    if (!saved.some((each) => samePoint(each, point))) rows.push({ key: `point:${index}`, label: 'Punkt', value: point });
  });
  if (draft.rating !== null) {
    const value = venueRatingLabel(draft.rating);
    const current = venue?.rating && venueRatingLabel(venue.rating);
    if (value !== current) rows.push({ key: 'rating', label: 'Średnia ocena', value, ...(current ? { current } : {}) });
  }
  draft.prices.forEach((price, index) => {
    const value = venuePriceLabel(price);
    const same = venue?.prices.find((each) => samePoint(each.name, price.name));
    const current = same && venuePriceLabel(same);
    if (value !== current) rows.push({ key: `price:${index}`, label: 'Cena', value, ...(current ? { current } : {}) });
  });
  const fields: [string, string, string | null, string | undefined][] = [
    ['address', 'Adres', draft.address, place.address],
    ['openingHours', 'Godziny otwarcia', draft.openingHours, place.openingHours],
    ['website', 'Strona', draft.website, place.website],
  ];
  for (const [key, label, value, current] of fields) {
    if (value !== null && value !== current) rows.push({ key, label, value, ...(current ? { current } : {}) });
  }
  return rows;
}

type VenueEdit = { doc: Doc; writes: { collection: 'places'; element: { ref: string } & Record<string, unknown>; op: 'update' }[] };

const withPlace = (doc: Doc, place: Place): VenueEdit => ({
  doc: { ...doc, places: doc.places.map((each) => (each.ref === place.ref ? place : each)) },
  writes: [{ collection: 'places', element: place as { ref: string } & Record<string, unknown>, op: 'update' }],
});

/** Zapisywana postać: same punkty, bez dawnego opisu jednym tekstem. */
function withVenue(doc: Doc, place: Place, change: Partial<Venue>): VenueEdit {
  const { description: _old, ...venue } = place.venue ?? { prices: [] };
  return withPlace(doc, { ...place, venue: { ...venue, points: venuePoints(place.venue), ...change } });
}

/** Dopisuje zaznaczone wiersze szkicu. Zapisane punkty i ceny zostają; `readOn` przesuwa się tylko przy danych lokalu. `null` = nie ma miejsca. */
export function applyVenueDraft(doc: Doc, placeRef: string, draft: VenueDraft, fields: readonly string[], today: string): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return null;
  const picked = new Set(fields);
  const old = place.venue;
  const points = venuePoints(old);
  draft.points.forEach((point, index) => {
    if (picked.has(`point:${index}`) && !points.some((each) => samePoint(each, point))) points.push(point);
  });
  const prices = [...(old?.prices ?? [])];
  draft.prices.forEach((price, index) => {
    if (!picked.has(`price:${index}`)) return;
    const same = prices.findIndex((each) => samePoint(each.name, price.name));
    if (same === -1) prices.push(price);
    else prices[same] = price;
  });
  const rating = picked.has('rating') && draft.rating ? { value: draft.rating.value, scale: draft.rating.scale, ...(draft.rating.count ? { count: draft.rating.count } : {}), ...(draft.rating.source ? { source: draft.rating.source } : {}) } : old?.rating;
  const fresh = [...picked].some((key) => key === 'rating' || key.startsWith('point:') || key.startsWith('price:'));
  const readOn = fresh ? IsoDate.parse(today) : old?.readOn;
  const hasVenue = old !== undefined || points.length > 0 || rating !== undefined || prices.length > 0;
  const { venue: _dropped, ...rest } = place;
  return withPlace(doc, {
    ...rest,
    ...(hasVenue ? { venue: { points, prices, ...(rating ? { rating } : {}), ...(readOn ? { readOn } : {}) } } : {}),
    ...(picked.has('address') && draft.address ? { address: draft.address } : {}),
    ...(picked.has('openingHours') && draft.openingHours ? { openingHours: draft.openingHours } : {}),
    ...(picked.has('website') && draft.website ? { website: draft.website } : {}),
  });
}

/**
 * Punkt opisu: `old === null` dopisuje nowy, `next === null` albo pusty usuwa. Wskazanie po treści, nie po numerze:
 * ktoś inny mógł w tym czasie zmienić listę. `null` = nie ma już miejsca albo tego punktu; powtórzenia nie dopisuje.
 */
export function editVenuePoint(doc: Doc, placeRef: string, old: string | null, next: string | null): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return null;
  const points = venuePoints(place.venue);
  const text = next?.trim() ?? '';
  const others = points.filter((each) => each !== old);
  if (text !== '' && others.some((each) => samePoint(each, text))) return null;
  if (old === null) return text === '' ? null : withVenue(doc, place, { points: [...points, text] });
  const index = points.indexOf(old);
  if (index === -1) return null;
  return withVenue(doc, place, { points: text === '' ? others : points.map((each, at) => (at === index ? text : each)) });
}

/** Przykładowa cena, wskazana po nazwie: `oldName === null` dopisuje, `next === null` usuwa. `null` = nie ma już miejsca albo tej ceny. */
export function editVenuePrice(doc: Doc, placeRef: string, oldName: string | null, next: VenuePrice | null): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return null;
  const prices = place.venue?.prices ?? [];
  if (oldName === null) return next === null ? null : withVenue(doc, place, { prices: [...prices, next] });
  if (!prices.some((each) => each.name === oldName)) return null;
  return withVenue(doc, place, { prices: next === null ? prices.filter((each) => each.name !== oldName) : prices.map((each) => (each.name === oldName ? next : each)) });
}

/** Usuwa samą ocenę. */
export function removeVenueRating(doc: Doc, placeRef: string): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place?.venue?.rating === undefined) return null;
  const { rating: _dropped, ...venue } = place.venue;
  return withPlace(doc, { ...place, venue });
}

/** Usuwa punkty, ceny i ocenę. Miejsce zostaje knajpą, a jego adres, godziny i strona się nie zmieniają. */
export function removeVenue(doc: Doc, placeRef: string): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place?.venue === undefined) return null;
  return withPlace(doc, { ...place, venue: { prices: [] } });
}
