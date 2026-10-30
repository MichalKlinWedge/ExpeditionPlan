import { z } from 'zod';

/**
 * Typy podstawowe wspólne dla całego modelu (SPECYFIKACJA §5, konwencje).
 *
 * Czas planu to **czas lokalny + strefa IANA**, nie chwila w UTC: „09:45 z T2” znaczy 09:45 w
 * Barcelonie niezależnie od tego, gdzie stoi serwer, a lot ląduje w innej strefie niż startuje.
 */

/** Kod waluty ISO 4217: PLN, EUR, MAD, GEL. */
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'Kod waluty to trzy wielkie litery (ISO 4217).');

/** Kod kraju ISO 3166-1 alfa-2: PL, ES, MA, GE, HR. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'Kod kraju to dwie wielkie litery (ISO 3166-1).');

/** Data kalendarzowa bez strefy: 2026-12-26. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data w formacie RRRR-MM-DD.');

/** Godzina lokalna: 09:45. */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Godzina w formacie GG:MM.');

/** Data i godzina lokalna bez strefy: 2026-12-26T06:10. Strefa idzie osobnym polem. */
export const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Data i godzina w formacie RRRR-MM-DDTGG:MM.');

/**
 * Strefa IANA: Europe/Warsaw, Africa/Casablanca, Asia/Tbilisi. Sprawdzana przez Intl, więc literówka
 * („Europe/Warsow”) nie przejdzie, a skrót „CET” — też nie, bo nie zna zmiany czasu.
 */
export const TimeZone = z.string().refine((value) => {
  if (!value.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Strefa IANA, np. Europe/Warsaw.');

/** Kwota w groszach/centach. Nigdy float. */
export const MinorAmount = z.number().int().nonnegative();

export const Coordinates = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const Link = z.object({ label: z.string().min(1), url: z.url() });
