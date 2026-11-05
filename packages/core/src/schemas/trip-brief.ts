import { z } from 'zod';

import { Coordinates, CountryCode, Currency, IsoDate, LocalDateTime, LocalTime, MinorAmount, TimeZone } from './common.ts';
import { Price } from './price.ts';

/**
 * Wejście kreatora wyjazdu (SPECYFIKACJA §3 M2) — to, co AI dostaje na start Etapu 1.
 *
 * Kształt wynika z planów w `exaples/`: każdy zaczyna się od założeń, składu grupy z wiekiem
 * i tego, co już jest kupione (loty, mecz, pakiet). AI planuje wokół tych elementów, nie zamiast nich.
 */

export const TripProfile = z.enum([
  'sightseeing',
  'relax',
  'trekking',
  'food_culture',
  'photo',
  'sport',
  'family',
  'road_trip',
]);

export const TransportMode = z.enum([
  'flight',
  'own_car',
  'rental_car',
  'hired_driver',
  'public',
  'taxi',
  'bike',
  'walk',
]);

export const BriefTraveler = z.object({
  name: z.string().min(1),
  nickname: z.string().optional(),
  /** Wiek w chwili wyjazdu. Decyduje o cenach (progi przy kasach) i o tempie tras. */
  age: z.number().int().min(0).max(120).optional(),
  /** Rodzina albo para — do podziału kosztów „na rodzinę” i przydziału opieki nad dziećmi. */
  household: z.string().optional(),
  isDriver: z.boolean().optional(),
  notes: z.string().optional(),
});

export const BriefDates = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), start: IsoDate, end: IsoDate }),
  z.object({
    kind: z.literal('flexible'),
    days: z.number().int().min(1),
    /** „maj 2027”, „długi weekend sierpniowy” — wolnym tekstem. */
    window: z.string().min(1),
  }),
]);

export const BriefLocation = z.object({
  kind: z.enum(['city', 'region', 'route', 'base_camps', 'outdoor']),
  countries: z.array(CountryCode).min(1),
  /** Miasta, regiony, punkty trasy w kolejności — tak, jak użytkownik je wymienił. */
  places: z.array(z.string().min(1)).min(1),
  /** Punkt bez adresu, który trzeba znać dokładnie (chatka „nie na każdej mapie”, parking). */
  pins: z.array(z.object({ name: z.string().min(1), ...Coordinates.shape })).optional(),
});

/**
 * Element już ustalony: kupiony lot, zarezerwowany nocleg, bilet na mecz, voucher na auto.
 * Wchodzi do planu jako stały (`user_locked`), AI planuje wokół niego.
 */
export const BriefFixed = z.object({
  kind: z.enum(['flight', 'train', 'lodging', 'car_rental', 'event', 'activity', 'package', 'ticket', 'other']),
  title: z.string().min(1),
  status: z.enum(['booked', 'paid', 'candidate']).optional(),
  provider: z.string().optional(),
  /** Numer lotu, rezerwacji, vouchera. */
  reference: z.string().optional(),
  startLocal: LocalDateTime.optional(),
  startTz: TimeZone.optional(),
  endLocal: LocalDateTime.optional(),
  endTz: TimeZone.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  place: z.string().optional(),
  price: Price.optional(),
  note: z.string().optional(),
});

export const BriefConstraints = z.object({
  diet: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  accessibility: z.array(z.string()).default([]),
  dayStart: LocalTime.optional(),
  dayEnd: LocalTime.optional(),
  pace: z.enum(['calm', 'normal', 'intense']).default('normal'),
  /** Najdłuższa jazda autem w ciągu dnia (Maroko: żaden dzień ponad ~3 h). */
  maxDrivingMinPerDay: z.number().int().positive().optional(),
  noDrivingAfterDark: z.boolean().default(false),
  /** Reszta ograniczeń wolnym tekstem: „być w chatce najpóźniej o 14:00–15:00”. */
  notes: z.array(z.string()).default([]),
});

export const TripBrief = z
  .object({
    title: z.string().min(1),
    /** Założenia: po co ten wyjazd i co jest w nim najważniejsze. */
    goal: z.string().min(1),
    location: BriefLocation,
    dates: BriefDates,
    homeTz: TimeZone.default('Europe/Warsaw'),
    profiles: z.array(TripProfile).min(1),
    travelers: z.array(BriefTraveler).min(1),
    transport: z.array(TransportMode).min(1),
    budget: z.object({
      level: z.enum(['low', 'medium', 'premium']),
      currency: Currency,
      /** Górny pułap całości, jeśli jest. */
      capMinor: MinorAmount.optional(),
    }),
    constraints: BriefConstraints.default({
      diet: [],
      allergies: [],
      accessibility: [],
      pace: 'normal',
      noDrivingAfterDark: false,
      notes: [],
    }),
    fixed: z.array(BriefFixed).default([]),
    mustSee: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
    /** Wszystko, czego nie da się wyrazić polami — trafia do polecenia dla AI jako kontekst. */
    notes: z.array(z.string()).default([]),
  })
  .refine((brief) => brief.dates.kind !== 'fixed' || brief.dates.start <= brief.dates.end, {
    message: 'Wyjazd nie może kończyć się przed początkiem.',
    path: ['dates', 'end'],
  });

export type TripBrief = z.infer<typeof TripBrief>;

/**
 * Brief pobrany ze strony wyjazdu do planowania poza serwerem (`npm run plan-ai -- --brief`):
 * sam brief plus to, czego łańcuch nie wyczyta z briefu, a co ma zgadzać się z wyjazdem.
 */
export const BriefFile = z.object({
  title: z.string().min(1),
  primaryTz: TimeZone.optional(),
  brief: TripBrief,
});
export type BriefFile = z.infer<typeof BriefFile>;
export type TripBriefInput = z.input<typeof TripBrief>;
