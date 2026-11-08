import { z } from 'zod';

import { Currency, HttpUrl, IsoDate, Link, LocalDateTime, LocalTime, MinorAmount, TimeZone } from './common.ts';
import { Price } from './price.ts';

/**
 * Cały wyjazd jako jeden dokument (SPECYFIKACJA §5) — format importu planu, pakietu offline
 * i danych referencyjnych w `fixtures/plans/<plan>/plan.json`.
 *
 * Elementy wiążą się przez `ref`: krótkie klucze lokalne dokumentu („d1”, „medersa”, „lot-tam”),
 * unikalne w całym dokumencie. Przy zapisie do bazy zamieniają się na UUID. Odwołanie do
 * nieistniejącego elementu albo do elementu złego rodzaju jest błędem walidacji — import, który
 * gubi powiązania, jest gorszy niż import, który się nie udał.
 */

export const Ref = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Klucz: małe litery, cyfry i myślniki, np. „d1”, „lot-tam”.');

const text = z.string().min(1);

/**
 * Notatka jednym tekstem (uczestnik, miejsce, kontakt). Punkty i rezerwacje mają listę notatek,
 * więc AI przy imporcie myli kształty (PoC-0) — lista jest łączona w jeden tekst, zamiast odrzucać plan.
 */
const noteText = z.union([z.string(), z.array(z.string()).transform((lines) => lines.join('\n'))]);

/** Czas lokalny ze strefą: „2026-12-26T06:10” w „Europe/Warsaw”. */
export const ZonedLocal = z.object({ local: LocalDateTime, tz: TimeZone });

/**
 * Początek albo koniec rezerwacji. Data jest zawsze, godzina nie: nocleg „26–27 grudnia” nie ma
 * godziny zameldowania, a koniec pakietu „ok. 10:00” jest przybliżony (PoC-0, A5).
 */
export const BookingTime = z.object({
  date: IsoDate,
  time: LocalTime.optional(),
  precision: z.enum(['exact', 'approx']).default('exact'),
  tz: TimeZone,
});

// ---------------------------------------------------------------------------------------------
// Wyjazd, uczestnicy, miejsca

export const DocTrip = z.object({
  title: text,
  subtitle: z.string().optional(),
  /** Założenia: po co ten wyjazd i co jest w nim najważniejsze. */
  goal: z.string().optional(),
  summary: z.string().optional(),
  startDate: IsoDate,
  endDate: IsoDate,
  primaryTz: TimeZone,
  homeTz: TimeZone.default('Europe/Warsaw'),
  baseCurrency: Currency,
  /** Kursy przyjęte w planie („1 MAD ≈ 0,43 zł”): ile jednostek waluty bazowej za 1 jednostkę. */
  fx: z.array(z.object({ currency: Currency, rateToBase: z.number().positive(), date: IsoDate.optional() })).default([]),
  /** Numer wersji z dokumentu („v4”). */
  version: z.string().optional(),
});

export const DocTraveler = z.object({
  ref: Ref,
  name: text,
  nickname: z.string().optional(),
  age: z.number().int().min(0).max(120).optional(),
  /** Rodzina albo para — podział kosztów „na rodzinę”. */
  household: z.string().optional(),
  /** Dorosły odpowiedzialny za dziecko. */
  guardianRef: Ref.optional(),
  isDriver: z.boolean().optional(),
  heightCm: z.number().int().positive().optional(),
  notes: noteText.optional(),
  /** Nie jest pewne, czy jedzie. */
  tentative: z.boolean().optional(),
  /** Dołącza później niż reszta; brak = od początku wyjazdu. */
  fromDate: IsoDate.optional(),
  /** Wyjeżdża wcześniej niż reszta; brak = do końca wyjazdu. */
  toDate: IsoDate.optional(),
  /** Skąd rusza i gdzie kończy: do planowania wspólnego transportu. */
  startPlaceRef: Ref.optional(),
  endPlaceRef: Ref.optional(),
});

/** Przykładowa cena z karty lokalu. Tylko do pokazania, nic z niej nie liczymy. */
export const VenuePrice = z
  .object({ name: text, currency: Currency, minMinor: MinorAmount, maxMinor: MinorAmount })
  .refine((price) => price.minMinor <= price.maxMinor, { message: 'Dolna granica ceny nie może być większa od górnej.', path: ['maxMinor'] });
export type VenuePrice = z.infer<typeof VenuePrice>;

/** Średnia ocena tak, jak podaje źródło: skala i serwis są częścią informacji. */
export const VenueRating = z
  .object({ value: z.number().positive(), scale: z.number().positive().max(100), count: z.number().int().positive().optional(), source: z.string().optional() })
  .refine((rating) => rating.value <= rating.scale, { message: 'Ocena nie może przekraczać skali.', path: ['value'] });
export type VenueRating = z.infer<typeof VenueRating>;

/**
 * Lokal (restauracja, kawiarnia): sama obecność znaczy, że miejsce wskazano jako knajpę („knajpy w pobliżu”, `eat-out.ts`).
 * Punkty opisu, ceny i ocena to dane odczytane z tekstu wklejonego przez użytkownika (`venue-info.ts`). Sami niczego nie pobieramy,
 * a warunki Google zakazują zapisywania ocen z Places i z Grounding (docs/USLUGI.md §3, §11).
 */
export const Venue = z.object({
  /** Dawny opis jednym tekstem: tylko do odczytu, przy pierwszej zmianie staje się punktem (`venuePoints`). */
  description: z.string().optional(),
  /** Punkty opisu: kolejne odczyty dopisują, a człowiek zmienia i usuwa pojedynczo. */
  points: z.array(z.string().min(1)).optional(),
  prices: z.array(VenuePrice).default([]),
  rating: VenueRating.optional(),
  /** Kiedy wklejono tekst: ceny i oceny się starzeją. */
  readOn: IsoDate.optional(),
});
export type Venue = z.infer<typeof Venue>;

export const DocPlace = z.object({
  ref: Ref,
  name: text,
  /**
   * Nazwa do wyszukania w źródle miejsc (lokalna albo angielska: „Koutoubia Mosque”, „Ushguli”).
   * OSM nie zna polskich egzonimów („Kutubijja”, „Uszguli”) — wniosek z geokodowania planów.
   */
  searchName: z.string().optional(),
  category: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  address: z.string().optional(),
  /** Skąd miejsce: z bazy (osm, geoapify), pinezka użytkownika, albo nieustalone (import bez geokodowania). */
  provider: z.enum(['osm', 'geoapify', 'user', 'unknown']).default('unknown'),
  /** Godziny otwarcia tak, jak podaje źródło („09:00–19:00”, „zimą do 17:00”). */
  openingHours: z.string().optional(),
  elevationM: z.number().int().optional(),
  website: HttpUrl.optional(),
  links: z.array(Link).default([]),
  notes: noteText.optional(),
  venue: Venue.optional(),
});

// ---------------------------------------------------------------------------------------------
// Dni i punkty

export const DocDay = z.object({
  ref: Ref,
  date: IsoDate,
  tz: TimeZone,
  title: z.string().optional(),
  /** Wstęp dnia z dokumentu. */
  summary: z.string().optional(),
  /** Miejsce bazy dnia (miasto, nocleg). */
  baseRef: Ref.optional(),
  /**
   * Nocleg z tej nocy: rezerwacja albo grupa porównania kandydatów — wtedy dzień pokazuje tego,
   * który zostanie wybrany, bez ręcznego uzupełniania każdego dnia (PoC-0, A7).
   */
  lodgingRef: Ref.optional(),
  /** „Godzina zero” — kotwica dla godzin względnych (`+1:20`). Pusta = jeszcze nieustalona. */
  anchorTime: LocalTime.optional(),
  dayStart: LocalTime.optional(),
  dayEnd: LocalTime.optional(),
  /**
   * `false` = dzień bez scenariuszy: liczy się tylko krótszy czas punktów (jak „optymistyczny”), także
   * w propozycjach cięć, a plan nie pokazuje przełącznika optymistyczny / pesymistyczny. Brak = są.
   */
  scenarios: z.boolean().optional(),
  /** Jazda dnia tak, jak podaje dokument („246 km · 2 h 52 min”) — do porównania z wyliczoną. */
  statedDriving: z.object({ distanceKm: z.number().nonnegative().optional(), durationMin: z.number().int().nonnegative().optional() }).optional(),
});

export const PartOfDay = z.enum(['morning', 'midday', 'afternoon', 'evening', 'night']);

/**
 * Strefa godziny, gdy inna niż strefa dnia. Dzień wylotu żyje w strefie celu, a „04:10 lotnisko
 * Wrocław” jest w czasie polskim — bez tego pola silnik pomyliłby się o godzinę albo dwie (A1).
 */
const timeTz = { tz: TimeZone.optional() };

/** Godzina punktu z precyzją, z jaką podaje ją plan (SPECYFIKACJA §5, `time_precision`). */
export const ItemTime = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('exact'), start: LocalTime, end: LocalTime.optional(), ...timeTz }),
  z.object({ precision: z.literal('approx'), start: LocalTime, end: LocalTime.optional(), ...timeTz }),
  z.object({ precision: z.literal('range'), start: LocalTime, end: LocalTime, ...timeTz }),
  z.object({ precision: z.literal('part_of_day'), partOfDay: PartOfDay, ...timeTz }),
  z.object({ precision: z.literal('day') }),
  /**
   * `+1:20` — od kotwicy dnia (`DocDay.anchorTime`) albo od **początku** poprzedniego punktu
   * w aktywnym wariancie. Wzór użytkownika liczy od początku poprzedniego kroku: „0:00 wyjazd”,
   * „+1:20 wyjście na trasę” (choć jazda trwa 1:15), „Trasa (9h)”, „+9:00 powrót do auta” (A2).
   */
  z.object({
    precision: z.literal('relative'),
    offsetMin: z.number().int(),
    from: z.enum(['anchor', 'previous']).default('anchor'),
  }),
]);
export type ItemTime = z.infer<typeof ItemTime>;

export const ItemKind = z.enum([
  'visit',
  'activity',
  'meal',
  'transport',
  'lodging',
  'errand',
  'meetup',
  'free',
  'decision',
]);

/**
 * Czy punkt jest w grafiku. To, że jest opłacony w pakiecie, mówi `bookingRef` + `payment:
 * included` — status `in_package` mieszał jedno z drugim i wyrzucał quady z wyliczeń dnia (A6).
 */
export const PlanStatus = z.enum(['scheduled', 'candidate', 'alternative', 'does_not_fit', 'rejected']);

export const LegMode = z.enum([
  'walk',
  'hike',
  'car',
  'rental_car',
  'taxi',
  'hired_driver',
  'bus',
  'metro',
  'tram',
  'train',
  'ferry',
  'boat',
  'cable_car',
  'flight',
  'bike',
]);

/** Odcinek przesiadkowy: „L5 do Diagonal, przesiadka na L3 do Espanya”. */
export const LegSegment = z.object({
  mode: LegMode,
  line: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  durationMin: z.number().int().nonnegative().optional(),
});

/** Szczegóły przejazdu — wspólne dla punktu `transport` w osi dnia i dla niejawnego `legs`. */
const legDetails = {
  mode: LegMode,
  durationMin: z.number().int().nonnegative().optional(),
  durationMaxMin: z.number().int().nonnegative().optional(),
  distanceKm: z.number().nonnegative().optional(),
  /** „R2 Nord do Passeig de Gràcia, potem L4 do Jaume I”. */
  instructions: z.string().optional(),
  line: z.string().optional(),
  frequencyMin: z.number().int().positive().optional(),
  /** Godziny odjazdów z pierwszego przystanku, przepisane z rozkładu przez użytkownika. */
  departures: z.array(LocalTime).max(30).optional(),
  segments: z.array(LegSegment).optional(),
  /** Karnet albo bilet, który pokrywa przejazd (T-casual). */
  ticketBookingRef: Ref.optional(),
  price: Price.optional(),
  /** Alternatywa przejazdu („jeśli pociąg ucieknie — Aerobus z Pl. Catalunya”). */
  alternative: z
    .object({
      mode: LegMode.optional(),
      line: z.string().optional(),
      durationMin: z.number().int().nonnegative().optional(),
      instructions: z.string().optional(),
    })
    .optional(),
  /** Tam i z powrotem („2–2,5 h w jedną stronę” liczy się dwa razy). */
  roundTrip: z.boolean().optional(),
  /** Ręcznie: to dojazd lub powrót (`true`) albo nie (`false`). Brak = sam lot i długa droga (`isTransit`). */
  transit: z.boolean().optional(),
  links: z.array(Link).default([]),
};

/**
 * Przejazd zapisany jako punkt osi dnia (A4). Ma godzinę i miejsce w kolejności jak każdy punkt,
 * a skąd/dokąd wskazuje miejsca. Kolekcja `legs` zostaje tylko dla przejść niejawnych.
 */
export const ItemLeg = z.object({
  ...legDetails,
  fromPlaceRef: Ref.optional(),
  toPlaceRef: Ref.optional(),
  /** Czas i dystans z trasy (OpenRouteService), a nie z szacunku AI albo dokumentu. */
  routed: z.boolean().optional(),
  /** Własny link do trasy, np. z punktami pośrednimi. Tylko http(s): trafia do `href` i przeglądarki telefonu. */
  routeUrl: HttpUrl.optional(),
  /**
   * Linia trasy z OpenRouteService do mapy: zakodowana polilinia (format Google, precyzja 5,
   * uproszczona — `polyline.ts`). Bez niej mapa łączy miejsca prosto. Nie wypełnia jej AI.
   */
  geometry: z.string().optional(),
});

/** Klucz kolejności w dniu: porównywany jak tekst („0010” < „0020” < „0025”). */
export const SortKey = z.string().regex(/^[0-9a-z]+$/, 'Klucz kolejności: cyfry i małe litery, np. „0010”.');

export const DocItem = z.object({
  ref: Ref,
  /** Brak dnia = punkt w puli. */
  dayRef: Ref.optional(),
  /** Kolejność w dniu — punkty bez godziny nie mają innej (A3). Wymagany przy punkcie z dniem. */
  sortKey: SortKey.optional(),
  /** Obszar puli: „Essaouira”, „Marakesz”. */
  area: z.string().optional(),
  kind: ItemKind,
  planStatus: PlanStatus.default('scheduled'),
  /** „Zamiast X” — punkty, które ten zastępuje („Paradise Valley zamiast plaży i sandboardu”). */
  replacesRefs: z.array(Ref).default([]),
  /** Warianty, w których punkt występuje. Pusto = we wszystkich (A9). */
  variantRefs: z.array(Ref).default([]),
  title: text,
  /** Szczegóły przejazdu — tylko przy `kind: transport`. */
  leg: ItemLeg.optional(),
  /**
   * Blok, do którego punkt należy: „PRACA 14:15–16:00” → ekipy Drewno, Ogień, Kuchnia, Latryna.
   * Podpunkty dzieją się w czasie bloku, równolegle, i nie przesuwają reszty dnia (PoC-5).
   * Rodzic `transport` to co innego: podpunkt jest postojem w trasie i wydłuża przejazd (`route-stops.ts`).
   */
  parentRef: Ref.optional(),
  /** Przejazdy z innych wariantów, na których ten punkt też jest postojem: każdy wariant pamięta swój (`route-stops.ts`). */
  routeParentRefs: z.array(Ref).default([]),
  description: z.string().optional(),
  placeRef: Ref.optional(),
  time: ItemTime.optional(),
  durationMin: z.number().int().nonnegative().optional(),
  /** Górna granica, gdy czas trwania jest przedziałem („3–4 h”). */
  durationMaxMin: z.number().int().nonnegative().optional(),
  /** Postoje i przerwy w trakcie punktu: wydłużają go ponad czas drogi lub trwania i przeżywają przeliczenie trasy. */
  stopsMin: z.number().int().nonnegative().optional(),
  bufferAfterMin: z.number().int().nonnegative().optional(),
  /** Stała godzina, której przesunięcia nie ruszają (mecz, lot, start pakietu). */
  isFixed: z.boolean().optional(),
  priority: z.enum(['must', 'should', 'optional']).optional(),
  /** Kolejność cięcia przy braku czasu: 1 = wylatuje pierwsze. */
  cutRank: z.number().int().positive().optional(),
  price: Price.optional(),
  payment: z.enum(['cash_only', 'card', 'prepaid', 'included', 'free']).optional(),
  /** Rezerwacja (pakiet, bilet) albo grupa porównania kandydatów — wtedy ten, który zostanie wybrany (A7). */
  bookingRef: Ref.optional(),
  weather: z.enum(['outdoor', 'indoor', 'any']).optional(),
  /** Posiłek, który grupa robi sama (chatka, ognisko) — porcje i zakupy. Tylko przy `kind: meal`. */
  selfCooked: z.boolean().optional(),
  activity: z
    .object({
      distanceKm: z.number().nonnegative().optional(),
      ascentM: z.number().int().nonnegative().optional(),
      descentM: z.number().int().nonnegative().optional(),
      difficulty: z.string().optional(),
      trackRef: Ref.optional(),
      waymarking: z.string().optional(),
    })
    .optional(),
  /** Brak = cała grupa. */
  participantRefs: z.array(Ref).optional(),
  links: z.array(Link).default([]),
  notes: z.array(z.string()).default([]),
});

/**
 * Przejście niejawne między dwoma punktami („zejście 40 min do Sagrady” bez osobnego wiersza
 * w planie). Przejazd, który w planie ma własną godzinę, jest punktem `transport` z `leg` (A4).
 */
export const DocLeg = z.object({
  ref: Ref.optional(),
  fromRef: Ref,
  toRef: Ref,
  ...legDetails,
  source: z.enum(['document', 'routing', 'estimate']).default('document'),
});

// ---------------------------------------------------------------------------------------------
// Warianty i ograniczenia

export const DocVariantGroup = z.object({
  ref: Ref,
  scope: z.enum(['item', 'block', 'day', 'trip', 'booking']),
  dayRef: Ref.optional(),
  title: text,
  conditionKind: z.enum(['choice', 'weather', 'closure', 'schedule_slip', 'availability', 'wellbeing']),
  conditionText: z.string().optional(),
  /** Termin decyzji: godzina dnia (`dayRef`) albo konkretna chwila lokalna. */
  decideBy: z.union([ZonedLocal, z.object({ time: LocalTime })]).optional(),
  chosenRef: Ref.optional(),
  /** Uzasadnienie wyboru („Dlaczego wariant A”). */
  rationale: z.string().optional(),
  /** Tabela porównania: nagłówki kolumn i wiersz wartości per wariant. */
  comparison: z
    .object({
      columns: z.array(text).min(1),
      rows: z.array(z.object({ variantRef: Ref, values: z.array(z.string()) })),
    })
    .optional(),
});

export const DocVariant = z.object({
  ref: Ref,
  groupRef: Ref,
  label: text,
  summary: z.string().optional(),
  recommended: z.boolean().optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  /**
   * Punkty, które ten wariant wyrzuca z planu: „jeden zabytek zamiast dwóch”, „Paradise Valley
   * kosztem poranka na wydmach”. Wariant umiał tylko dodawać (A9).
   */
  excludesRefs: z.array(Ref).default([]),
});

export const ConstraintKind = z.enum([
  'arrive_before',
  'depart_before',
  'finish_before_sunset',
  'no_driving_after_dark',
  'latest_start',
  'min_time_at',
  'must_be_open',
  'office_open_at',
  'other',
]);

export const DocConstraint = z.object({
  ref: Ref.optional(),
  kind: ConstraintKind,
  dayRef: Ref.optional(),
  itemRef: Ref.optional(),
  bookingRef: Ref.optional(),
  time: LocalTime.optional(),
  /** Strefa godziny, gdy inna niż strefa dnia („odprawa zamyka się 05:30” we Wrocławiu) (A1). */
  tz: TimeZone.optional(),
  minutes: z.number().int().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------------------------
// Rezerwacje, kontakty, pieniądze

export const BookingKind = z.enum([
  'flight',
  'train',
  'bus',
  'ferry',
  'lodging',
  'car_rental',
  'transfer',
  'driver_hire',
  'activity',
  'package',
  'ticket',
  'transit_pass',
  'insurance',
  'esim',
  'luggage',
  'other',
]);

/**
 * Dodatek do rezerwacji: pakiet ochrony, zniesienie limitu km, fotelik. To nie osobna rezerwacja —
 * kupuje się go razem z najmem u tego samego dostawcy (A7).
 */
export const BookingAddon = z.object({
  title: text,
  kind: z.enum(['insurance', 'km_package', 'equipment', 'driver', 'other']),
  price: Price.optional(),
  recommended: z.boolean().optional(),
  selected: z.boolean().optional(),
  /** Udział własny przy pakiecie ochrony („do 20 000 MAD” vs „zero”). */
  excess: Price.optional(),
  notes: z.array(z.string()).default([]),
});

export const BookingStatus = z.enum([
  'idea',
  'candidate',
  'to_book',
  'booked',
  'paid',
  'cancelled',
  /** Dokument nie mówi, czy kupione — import nie zgaduje (A8). */
  'unknown',
  /** Nie da się zarezerwować: chatka „kto pierwszy, ten lepszy” (A8). */
  'not_required',
]);

export const DocBooking = z.object({
  ref: Ref,
  kind: BookingKind,
  status: BookingStatus,
  /** Grupa porównania kandydatów (`scope = booking`). */
  variantGroupRef: Ref.optional(),
  /** Wariant tej grupy, który reprezentuje tego kandydata w tabeli porównania (A7). */
  variantRef: Ref.optional(),
  recommended: z.boolean().optional(),
  provider: z.string().optional(),
  title: text,
  confirmationCode: z.string().optional(),
  start: BookingTime.optional(),
  end: BookingTime.optional(),
  startPlaceRef: Ref.optional(),
  endPlaceRef: Ref.optional(),
  checkInFrom: LocalTime.optional(),
  checkOutUntil: LocalTime.optional(),
  price: Price.optional(),
  /** Faktycznie zapłacone (po rabacie) — może się różnić od ceny katalogowej. */
  paid: z.object({ amountMinor: MinorAmount, currency: Currency, date: IsoDate.optional() }).optional(),
  paymentMethod: z.enum(['cash', 'card', 'credit_card_only', 'online']).optional(),
  payWhen: z.enum(['prepaid', 'on_site', 'before_arrival']).optional(),
  refundable: z.boolean().optional(),
  freeCancellationUntil: IsoDate.optional(),
  /** Skład zgłoszony u operatora — bywa inny niż faktyczny (dorosły od 13 lat). */
  party: z.object({ adults: z.number().int().nonnegative(), children: z.number().int().nonnegative(), note: z.string().optional() }).optional(),
  includes: z.array(z.string()).default([]),
  addons: z.array(BookingAddon).default([]),
  language: z.string().optional(),
  flight: z
    .object({
      number: z.string().optional(),
      fromAirport: z.string().optional(),
      toAirport: z.string().optional(),
      baggage: z.string().optional(),
    })
    .optional(),
  car: z
    .object({
      carClass: z.string().optional(),
      model: z.string().optional(),
      guaranteedModel: z.boolean().optional(),
      transmission: z.enum(['manual', 'automatic']).optional(),
      seats: z.number().int().positive().optional(),
      luggage: z.string().optional(),
      kmLimit: z.number().int().positive().optional(),
      extraKmPrice: Price.optional(),
      deposit: Price.optional(),
      insurance: z.string().optional(),
      fuelPolicy: z.string().optional(),
      minDriverAge: z.number().int().positive().optional(),
      officeHours: z.string().optional(),
    })
    .optional(),
  lodging: z
    .object({
      rooms: z.number().int().positive().optional(),
      beds: z.string().optional(),
      bathrooms: z.number().int().nonnegative().optional(),
      areaM2: z.number().positive().optional(),
      breakfast: z.string().optional(),
      amenities: z.array(z.string()).default([]),
      distanceNote: z.string().optional(),
    })
    .optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  rating: z.object({ score: z.number().nonnegative(), scale: z.number().positive().default(10), count: z.number().int().nonnegative().optional() }).optional(),
  links: z.array(Link).default([]),
  notes: z.array(z.string()).default([]),
});

export const ContactRole = z.enum(['host', 'operator', 'rental', 'guide', 'emergency', 'venue', 'other']);

export const DocContact = z.object({
  ref: Ref,
  name: text,
  role: ContactRole,
  phone: z.string().optional(),
  email: z.email().optional(),
  bookingRef: Ref.optional(),
  notes: noteText.optional(),
});

export const BudgetCategory = z.enum([
  'flights',
  'lodging',
  'car',
  'fuel',
  'tolls_parking',
  'tickets',
  'activities',
  'food',
  'luggage',
  'insurance',
  'transport',
  'other',
]);

export const DocBudgetLine = z
  .object({
    ref: Ref,
    category: BudgetCategory,
    title: text,
    bookingRef: Ref.optional(),
    itemRef: Ref.optional(),
    status: z.enum(['estimate', 'committed', 'paid']),
    /** Scenariusz oszczędny / wygodny; przy kwocie pewnej obie równe. */
    lowMinor: MinorAmount,
    highMinor: MinorAmount,
    currency: Currency,
    perPerson: z.boolean().default(false),
    /** Kogo dotyczy pozycja; brak albo pusto = wszystkich uczestników (także dodanych później). */
    participantRefs: z.array(Ref).optional(),
    /** Koszt jednego auta (paliwo, winiety): dotyczy jego kierowcy i pasażerów (`vehicleTravelers`), nie `participantRefs`. */
    vehicleRef: Ref.optional(),
    note: z.string().optional(),
  })
  .refine((line) => line.lowMinor <= line.highMinor, { message: 'Dolna kwota większa od górnej.', path: ['highMinor'] });

/** Auto wyjazdu: kto prowadzi, ile ma miejsc (z kierowcą) i kto nim jedzie (`core/vehicles.ts`). */
export const DocVehicle = z.object({
  ref: Ref,
  label: text,
  driverRef: Ref.optional(),
  /** Wszystkie miejsca razem z kierowcą; brak = nie wiadomo. */
  seats: z.number().int().min(1).max(60).optional(),
  passengerRefs: z.array(Ref).default([]),
  notes: noteText.optional(),
});

// ---------------------------------------------------------------------------------------------
// Zadania, pakowanie, notatki, źródła, ślady

export const TaskDue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), date: IsoDate, time: LocalTime.optional() }),
  /** „2 dni przed wyjazdem”. */
  z.object({ kind: z.literal('before_trip'), days: z.number().int().nonnegative() }),
  /** „Dzień wcześniej potwierdzić, że medresa jest otwarta”. */
  z.object({ kind: z.literal('before_item'), itemRef: Ref, days: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('before_booking'), bookingRef: Ref }),
  z.object({ kind: z.literal('on_trip'), dayRef: Ref.optional(), time: LocalTime.optional() }),
]);

export const DocTask = z.object({
  ref: Ref,
  kind: z.enum(['todo', 'question', 'decision']),
  title: text,
  body: z.string().optional(),
  answer: z.string().optional(),
  status: z.enum(['open', 'done', 'dropped']).default('open'),
  due: TaskDue.optional(),
  assigneeRefs: z.array(Ref).default([]),
  bookingRef: Ref.optional(),
  itemRef: Ref.optional(),
  variantGroupRef: Ref.optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
});

export const DocPackingItem = z.object({
  ref: Ref,
  category: text,
  title: text,
  note: z.string().optional(),
  scope: z.enum(['personal', 'shared']),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  /** Osobista: tylko ta osoba. Wspólna: ta osoba bierze całość, póki nie ustalono inaczej (`gearCarriers`). */
  assigneeRef: Ref.optional(),
  /** Waga jednej sztuki (dla „Woda 28 l” — litra), do podziału obciążenia. */
  weightG: z.number().int().positive().optional(),
});

export const DocNote = z.object({
  ref: Ref.optional(),
  scope: z.enum(['trip', 'day', 'item', 'booking', 'variant_group']),
  targetRef: Ref.optional(),
  kind: z.enum(['info', 'tip', 'warning', 'safety', 'rationale', 'slack_audit', 'practical']),
  topic: z
    .enum(['weather', 'documents', 'money', 'health', 'safety', 'culture', 'transport', 'rules', 'packing', 'time', 'other'])
    .optional(),
  title: z.string().optional(),
  body: text,
  /** Dla `slack_audit`: ocena zapasu czasu dnia. */
  slack: z.enum(['large', 'small', 'none', 'negative']).optional(),
});

export const DocSource = z.object({
  ref: Ref,
  title: text,
  url: HttpUrl.optional(),
  checkedAt: IsoDate.optional(),
  note: z.string().optional(),
  /** Elementy, których dotyczy (ceny, godziny, opisy). */
  appliesToRefs: z.array(Ref).default([]),
});

export const DocTrack = z.object({
  ref: Ref,
  name: text,
  distanceKm: z.number().nonnegative().optional(),
  ascentM: z.number().int().nonnegative().optional(),
  descentM: z.number().int().nonnegative().optional(),
  durationMin: z.number().int().nonnegative().optional(),
  durationMaxMin: z.number().int().nonnegative().optional(),
  difficulty: z.string().optional(),
  waymarking: z.string().optional(),
  routeNotes: z.string().optional(),
  url: HttpUrl.optional(),
  /** Geometria z pliku GPX (uproszczona, `core/gpx.ts`): GeoJSON LineString, [lng, lat, wysokość?]. */
  geojson: z
    .object({ type: z.literal('LineString'), coordinates: z.array(z.array(z.number()).min(2).max(3)).min(2) })
    .optional(),
});

// ---------------------------------------------------------------------------------------------
// Dokument i spójność odwołań

export const TripDocumentShape = z.object({
  schemaVersion: z.literal(1),
  trip: DocTrip,
  travelers: z.array(DocTraveler).default([]),
  places: z.array(DocPlace).default([]),
  days: z.array(DocDay).default([]),
  items: z.array(DocItem).default([]),
  legs: z.array(DocLeg).default([]),
  variantGroups: z.array(DocVariantGroup).default([]),
  variants: z.array(DocVariant).default([]),
  constraints: z.array(DocConstraint).default([]),
  bookings: z.array(DocBooking).default([]),
  contacts: z.array(DocContact).default([]),
  budgetLines: z.array(DocBudgetLine).default([]),
  vehicles: z.array(DocVehicle).default([]),
  tasks: z.array(DocTask).default([]),
  packing: z.array(DocPackingItem).default([]),
  notes: z.array(DocNote).default([]),
  sources: z.array(DocSource).default([]),
  tracks: z.array(DocTrack).default([]),
});

type Shape = z.infer<typeof TripDocumentShape>;
type Collection =
  | 'travelers'
  | 'places'
  | 'days'
  | 'items'
  | 'legs'
  | 'variantGroups'
  | 'variants'
  | 'constraints'
  | 'bookings'
  | 'contacts'
  | 'budgetLines'
  | 'vehicles'
  | 'tasks'
  | 'packing'
  | 'notes'
  | 'sources'
  | 'tracks';

const COLLECTIONS: Collection[] = [
  'travelers',
  'places',
  'days',
  'items',
  'legs',
  'variantGroups',
  'variants',
  'constraints',
  'bookings',
  'contacts',
  'budgetLines',
  'vehicles',
  'tasks',
  'packing',
  'notes',
  'sources',
  'tracks',
];

/** Zakres celu notatki → kolekcja, w której musi leżeć `targetRef`. */
const NOTE_TARGET: Record<string, Collection | null> = {
  trip: null,
  day: 'days',
  item: 'items',
  booking: 'bookings',
  variant_group: 'variantGroups',
};

/**
 * Sprawdza, czy każde odwołanie wskazuje istniejący element właściwego rodzaju i czy klucze są
 * unikalne. Zwraca listę problemów jako (ścieżka, komunikat) — pusta lista znaczy „spójny”.
 */
export function checkReferences(doc: Shape): { path: (string | number)[]; message: string }[] {
  const problems: { path: (string | number)[]; message: string }[] = [];
  const owner = new Map<string, Collection>();

  for (const collection of COLLECTIONS) {
    (doc[collection] as { ref?: string }[]).forEach((element, index) => {
      if (element.ref === undefined) return;
      const previous = owner.get(element.ref);
      if (previous !== undefined) {
        problems.push({ path: [collection, index, 'ref'], message: `Klucz „${element.ref}” jest już użyty w ${previous}.` });
      } else {
        owner.set(element.ref, collection);
      }
    });
  }

  const expect = (path: (string | number)[], ref: string | undefined, ...allowed: Collection[]) => {
    if (ref === undefined) return;
    const found = owner.get(ref);
    if (found === undefined) {
      problems.push({ path, message: `Nie ma elementu „${ref}”.` });
    } else if (!allowed.includes(found)) {
      problems.push({ path, message: `„${ref}” to ${found}, a powinno być: ${allowed.join(' / ')}.` });
    }
  };

  const groupScope = new Map(doc.variantGroups.map((g) => [g.ref, g.scope]));

  /** Rezerwacja albo grupa porównania kandydatów — ta druga tylko o zasięgu `booking` (A7). */
  const expectBookingOrGroup = (path: (string | number)[], ref: string | undefined) => {
    if (ref === undefined) return;
    expect(path, ref, 'bookings', 'variantGroups');
    if (owner.get(ref) === 'variantGroups' && groupScope.get(ref) !== 'booking') {
      problems.push({ path, message: `Grupa „${ref}” nie jest porównaniem rezerwacji (scope: booking).` });
    }
  };

  doc.travelers.forEach((t, i) => {
    expect(['travelers', i, 'guardianRef'], t.guardianRef, 'travelers');
    expect(['travelers', i, 'startPlaceRef'], t.startPlaceRef, 'places');
    expect(['travelers', i, 'endPlaceRef'], t.endPlaceRef, 'places');
  });
  doc.days.forEach((d, i) => {
    expect(['days', i, 'baseRef'], d.baseRef, 'places');
    expectBookingOrGroup(['days', i, 'lodgingRef'], d.lodgingRef);
  });

  const sortKeys = new Map<string, string>();
  doc.items.forEach((it, i) => {
    expect(['items', i, 'dayRef'], it.dayRef, 'days');
    it.replacesRefs.forEach((r, j) => expect(['items', i, 'replacesRefs', j], r, 'items'));
    it.variantRefs.forEach((v, j) => expect(['items', i, 'variantRefs', j], v, 'variants'));
    expect(['items', i, 'placeRef'], it.placeRef, 'places');
    expect(['items', i, 'parentRef'], it.parentRef, 'items');
    it.routeParentRefs.forEach((r, j) => expect(['items', i, 'routeParentRefs', j], r, 'items'));
    if (it.parentRef !== undefined && it.parentRef === it.ref) {
      problems.push({ path: ['items', i, 'parentRef'], message: 'Punkt nie może być własnym blokiem.' });
    }
    expectBookingOrGroup(['items', i, 'bookingRef'], it.bookingRef);
    expect(['items', i, 'activity', 'trackRef'], it.activity?.trackRef, 'tracks');
    it.participantRefs?.forEach((p, j) => expect(['items', i, 'participantRefs', j], p, 'travelers'));
    if (it.leg !== undefined) {
      if (it.kind !== 'transport') {
        problems.push({ path: ['items', i, 'leg'], message: 'Szczegóły przejazdu tylko przy punkcie kind: transport.' });
      }
      expect(['items', i, 'leg', 'fromPlaceRef'], it.leg.fromPlaceRef, 'places');
      expect(['items', i, 'leg', 'toPlaceRef'], it.leg.toPlaceRef, 'places');
      expect(['items', i, 'leg', 'ticketBookingRef'], it.leg.ticketBookingRef, 'bookings');
    }
    if (it.dayRef === undefined && it.planStatus === 'scheduled') {
      problems.push({ path: ['items', i, 'planStatus'], message: 'Punkt bez dnia jest w puli — nie może mieć statusu scheduled.' });
    }
    if (it.time?.precision === 'relative' && it.dayRef === undefined) {
      problems.push({ path: ['items', i, 'time'], message: 'Godzina względna wymaga dnia.' });
    }
    // Kolejność w dniu: punkty bez godziny nie mają innej, a pozycja w tablicy JSON nie jest kontraktem (A3).
    if (it.dayRef !== undefined) {
      if (it.sortKey === undefined) {
        problems.push({ path: ['items', i, 'sortKey'], message: 'Punkt z dniem musi mieć sortKey.' });
      } else {
        const key = `${it.dayRef}/${it.sortKey}`;
        const other = sortKeys.get(key);
        if (other !== undefined) {
          problems.push({ path: ['items', i, 'sortKey'], message: `sortKey „${it.sortKey}” w dniu „${it.dayRef}” ma już „${other}”.` });
        } else {
          sortKeys.set(key, it.ref);
        }
      }
    }
  });
  doc.legs.forEach((l, i) => {
    expect(['legs', i, 'fromRef'], l.fromRef, 'items', 'places');
    expect(['legs', i, 'toRef'], l.toRef, 'items', 'places');
    expect(['legs', i, 'ticketBookingRef'], l.ticketBookingRef, 'bookings');
  });
  doc.variantGroups.forEach((g, i) => {
    expect(['variantGroups', i, 'dayRef'], g.dayRef, 'days');
    expect(['variantGroups', i, 'chosenRef'], g.chosenRef, 'variants');
    g.comparison?.rows.forEach((row, j) => {
      expect(['variantGroups', i, 'comparison', 'rows', j, 'variantRef'], row.variantRef, 'variants');
      if (row.values.length !== g.comparison!.columns.length) {
        problems.push({
          path: ['variantGroups', i, 'comparison', 'rows', j, 'values'],
          message: `Wiersz ma ${row.values.length} wartości, a tabela ${g.comparison!.columns.length} kolumn.`,
        });
      }
    });
  });
  const groupOf = new Map(doc.variants.map((v) => [v.ref, v.groupRef]));
  doc.variants.forEach((v, i) => {
    expect(['variants', i, 'groupRef'], v.groupRef, 'variantGroups');
    v.excludesRefs.forEach((r, j) => expect(['variants', i, 'excludesRefs', j], r, 'items'));
  });
  doc.variantGroups.forEach((g, i) => {
    if (g.chosenRef !== undefined && groupOf.get(g.chosenRef) !== undefined && groupOf.get(g.chosenRef) !== g.ref) {
      problems.push({ path: ['variantGroups', i, 'chosenRef'], message: `Wybrany wariant „${g.chosenRef}” należy do innej grupy.` });
    }
  });
  doc.constraints.forEach((c, i) => {
    expect(['constraints', i, 'dayRef'], c.dayRef, 'days');
    expect(['constraints', i, 'itemRef'], c.itemRef, 'items');
    expect(['constraints', i, 'bookingRef'], c.bookingRef, 'bookings');
  });
  doc.bookings.forEach((b, i) => {
    expectBookingOrGroup(['bookings', i, 'variantGroupRef'], b.variantGroupRef);
    expect(['bookings', i, 'variantRef'], b.variantRef, 'variants');
    if (b.variantRef !== undefined && groupOf.has(b.variantRef) && groupOf.get(b.variantRef) !== b.variantGroupRef) {
      problems.push({
        path: ['bookings', i, 'variantRef'],
        message: `Wariant „${b.variantRef}” nie należy do grupy porównania tej rezerwacji („${b.variantGroupRef ?? 'brak'}”).`,
      });
    }
    expect(['bookings', i, 'startPlaceRef'], b.startPlaceRef, 'places');
    expect(['bookings', i, 'endPlaceRef'], b.endPlaceRef, 'places');
    if (b.flight !== undefined && b.kind !== 'flight') {
      problems.push({ path: ['bookings', i, 'flight'], message: 'Szczegóły lotu przy rezerwacji, która nie jest lotem.' });
    }
    if (b.car !== undefined && b.kind !== 'car_rental') {
      problems.push({ path: ['bookings', i, 'car'], message: 'Szczegóły auta przy rezerwacji, która nie jest wynajmem auta.' });
    }
    if (b.lodging !== undefined && b.kind !== 'lodging' && b.kind !== 'package') {
      problems.push({ path: ['bookings', i, 'lodging'], message: 'Szczegóły noclegu przy rezerwacji, która nie jest noclegiem.' });
    }
  });
  doc.contacts.forEach((c, i) => expect(['contacts', i, 'bookingRef'], c.bookingRef, 'bookings'));
  doc.budgetLines.forEach((b, i) => {
    expect(['budgetLines', i, 'bookingRef'], b.bookingRef, 'bookings');
    expect(['budgetLines', i, 'itemRef'], b.itemRef, 'items');
    b.participantRefs?.forEach((p, j) => expect(['budgetLines', i, 'participantRefs', j], p, 'travelers'));
    expect(['budgetLines', i, 'vehicleRef'], b.vehicleRef, 'vehicles');
  });
  doc.vehicles.forEach((v, i) => {
    expect(['vehicles', i, 'driverRef'], v.driverRef, 'travelers');
    v.passengerRefs.forEach((p, j) => expect(['vehicles', i, 'passengerRefs', j], p, 'travelers'));
  });
  doc.tasks.forEach((t, i) => {
    t.assigneeRefs.forEach((a, j) => expect(['tasks', i, 'assigneeRefs', j], a, 'travelers'));
    expect(['tasks', i, 'bookingRef'], t.bookingRef, 'bookings');
    expect(['tasks', i, 'itemRef'], t.itemRef, 'items');
    expect(['tasks', i, 'variantGroupRef'], t.variantGroupRef, 'variantGroups');
    if (t.due?.kind === 'before_item') expect(['tasks', i, 'due', 'itemRef'], t.due.itemRef, 'items');
    if (t.due?.kind === 'before_booking') expect(['tasks', i, 'due', 'bookingRef'], t.due.bookingRef, 'bookings');
    if (t.due?.kind === 'on_trip') expect(['tasks', i, 'due', 'dayRef'], t.due.dayRef, 'days');
  });
  doc.packing.forEach((p, i) => expect(['packing', i, 'assigneeRef'], p.assigneeRef, 'travelers'));
  doc.notes.forEach((n, i) => {
    const target = NOTE_TARGET[n.scope];
    if (target === null || target === undefined) return;
    if (n.targetRef === undefined) {
      problems.push({ path: ['notes', i, 'targetRef'], message: `Notatka o zasięgu „${n.scope}” musi wskazywać element.` });
    } else {
      expect(['notes', i, 'targetRef'], n.targetRef, target);
    }
  });
  doc.sources.forEach((s, i) => {
    s.appliesToRefs.forEach((r, j) => {
      if (!owner.has(r)) problems.push({ path: ['sources', i, 'appliesToRefs', j], message: `Nie ma elementu „${r}”.` });
    });
  });

  return problems;
}

export const TripDocument = TripDocumentShape.superRefine((doc, ctx) => {
  for (const problem of checkReferences(doc)) {
    ctx.addIssue({ code: 'custom', path: problem.path, message: problem.message });
  }
});

export type TripDocument = z.infer<typeof TripDocument>;
export type TripDocumentInput = z.input<typeof TripDocument>;
