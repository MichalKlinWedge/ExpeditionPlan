import { z } from 'zod';

import { formatMoney } from './budget.ts';
import { Currency, IsoDate, MinorAmount } from './schemas/common.ts';
import type { TripDocument, Venue, VenuePrice, VenueRating } from './schemas/trip-document.ts';

/**
 * Lokal na stronie „Posiłki”: opis, przykładowe ceny i ocena z tekstu, który wkleił użytkownik (Google Maps,
 * TripAdvisor, menu). Tak jak przy noclegu (`lodging-info.ts`) AI robi szkic, a zapisuje człowiek po podglądzie.
 */

type Doc = TripDocument;
type Place = Doc['places'][number];

const short = (max: number) => z.string().trim().min(1).max(max).nullable();

export const VenueDraft = z.object({
  /** Czy tekst w ogóle dotyczy lokalu gastronomicznego. */
  isVenue: z.boolean(),
  description: short(600),
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

export const VENUE_FIELDS = ['description', 'rating', 'prices', 'address', 'openingHours', 'website'] as const;
export type VenueField = (typeof VENUE_FIELDS)[number];

/** Wiersz podglądu; `current` — inna wartość, która już jest przy miejscu (nie zaznaczamy jej domyślnie). */
export type VenueDraftRow = { key: VenueField; label: string; value: string; current?: string };

/** „4,6/5 · opinie: 1240 · Google Maps” */
export function venueRatingLabel(rating: Pick<VenueRating, 'value' | 'scale'> & { count?: number | null | undefined; source?: string | null | undefined }): string {
  const value = rating.value.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  return [`${value}/${rating.scale}`, rating.count ? `opinie: ${rating.count}` : null, rating.source ?? null].filter(Boolean).join(' · ');
}

/** „Pizza margherita: 32 zł”, „Zupa: 18 zł – 24 zł” */
export function venuePriceLabel(price: VenuePrice): string {
  const low = formatMoney(price.minMinor, price.currency);
  return `${price.name}: ${price.minMinor === price.maxMinor ? low : `${low} – ${formatMoney(price.maxMinor, price.currency)}`}`;
}

const pricesLabel = (prices: VenuePrice[]) => prices.map(venuePriceLabel).join('; ');

/** Pola szkicu do podglądu: bez pustych i bez tych, które już są zapisane w tej samej postaci. */
export function venueDraftRows(place: Place, draft: VenueDraft): VenueDraftRow[] {
  const { venue } = place;
  const candidates: { key: VenueField; label: string; value: string | null; current: string | undefined }[] = [
    { key: 'description', label: 'Opis', value: draft.description, current: venue?.description },
    { key: 'rating', label: 'Średnia ocena', value: draft.rating && venueRatingLabel(draft.rating), current: venue?.rating && venueRatingLabel(venue.rating) },
    { key: 'prices', label: 'Przykładowe ceny', value: draft.prices.length > 0 ? pricesLabel(draft.prices) : null, current: venue && venue.prices.length > 0 ? pricesLabel(venue.prices) : undefined },
    { key: 'address', label: 'Adres', value: draft.address, current: place.address },
    { key: 'openingHours', label: 'Godziny otwarcia', value: draft.openingHours, current: place.openingHours },
    { key: 'website', label: 'Strona', value: draft.website, current: place.website },
  ];
  return candidates.flatMap(({ key, label, value, current }) => (value === null || value === undefined || value === current ? [] : [{ key, label, value, ...(current ? { current } : {}) }]));
}

type VenueEdit = { doc: Doc; writes: { collection: 'places'; element: { ref: string } & Record<string, unknown>; op: 'update' }[] };

const withPlace = (doc: Doc, place: Place): VenueEdit => ({
  doc: { ...doc, places: doc.places.map((each) => (each.ref === place.ref ? place : each)) },
  writes: [{ collection: 'places', element: place as { ref: string } & Record<string, unknown>, op: 'update' }],
});

/** Zapisuje zaznaczone pola szkicu; `readOn` przesuwa się tylko, gdy zmienia się coś z danych lokalu. `null` = nie ma miejsca. */
export function applyVenueDraft(doc: Doc, placeRef: string, draft: VenueDraft, fields: readonly VenueField[], today: string): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return null;
  const picked = new Set(fields);
  const old = place.venue;
  const description = picked.has('description') ? (draft.description ?? undefined) : old?.description;
  const rating = picked.has('rating') && draft.rating ? { value: draft.rating.value, scale: draft.rating.scale, ...(draft.rating.count ? { count: draft.rating.count } : {}), ...(draft.rating.source ? { source: draft.rating.source } : {}) } : old?.rating;
  const prices = picked.has('prices') ? draft.prices : (old?.prices ?? []);
  const fresh = picked.has('description') || picked.has('rating') || picked.has('prices');
  const venue: Venue = { ...(description ? { description } : {}), prices, ...(rating ? { rating } : {}), readOn: IsoDate.parse(fresh ? today : (old?.readOn ?? today)) };
  const hasVenue = description !== undefined || rating !== undefined || prices.length > 0;
  const { venue: _dropped, ...rest } = place;
  return withPlace(doc, {
    ...rest,
    ...(hasVenue ? { venue } : {}),
    ...(picked.has('address') && draft.address ? { address: draft.address } : {}),
    ...(picked.has('openingHours') && draft.openingHours ? { openingHours: draft.openingHours } : {}),
    ...(picked.has('website') && draft.website ? { website: draft.website } : {}),
  });
}

/** Usuwa opis, ceny i ocenę; adres, godziny i strona należą do miejsca i zostają. */
export function removeVenue(doc: Doc, placeRef: string): VenueEdit | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place?.venue === undefined) return null;
  const { venue: _dropped, ...rest } = place;
  return withPlace(doc, rest);
}
