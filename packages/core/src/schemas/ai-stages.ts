import { z } from 'zod';

import { HttpUrl, IsoDate } from './common.ts';
import { PriceBasis } from './price.ts';
import { ContactRole, ItemKind, LegMode, Ref, TripDocumentShape } from './trip-document.ts';

/**
 * Wyniki etapów łańcucha AI (SPECYFIKACJA §4). Etap 1 to warianty szkieletu wyjazdu, etap 2 —
 * dni z punktami w kształcie `TripDocument`, żeby ugruntowanie i silnik harmonogramu działały
 * na tym samym typie co plany wzorcowe.
 */

const text = z.string().min(1);
const minutes = z.number().int().nonnegative();

export const SkeletonDay = z.object({
  date: IsoDate,
  /** Gdzie śpimy po tym dniu albo z czego wychodzimy (nazwa z listy `bases`). */
  base: text,
  title: text,
  /** Jazda autem/busem w tym dniu łącznie — do porównania wariantów i limitu z briefu. */
  drivingMin: minutes.optional(),
  drivingKm: z.number().nonnegative().optional(),
  summary: z.string().optional(),
});

export const SkeletonVariant = z.object({
  ref: Ref,
  label: text,
  summary: text,
  recommended: z.boolean().default(false),
  days: z.array(SkeletonDay).min(1),
  metrics: z.object({
    totalDrivingKm: z.number().nonnegative().optional(),
    longestDrivingMin: minutes.optional(),
    lodgingChanges: z.number().int().nonnegative(),
  }),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  /** Czego w tym wariancie nie da się zrobić — uczciwie, zamiast udawać, że się mieści. */
  cannotFit: z.array(z.string()).default([]),
});

export const TripSkeleton = z
  .object({
    variants: z.array(SkeletonVariant).min(2).max(3),
    rationale: text,
    /** Ryzyka całego wyjazdu (zmrok, limity, święta, kolejki) — do porównania z planami ręcznymi. */
    risks: z.array(z.string()).default([]),
    /** Bazy noclegowe z nazwą do geokodowania — z nich liczą się fakty dnia (słońce). */
    bases: z.array(z.object({ name: text, searchName: text })).min(1),
  })
  .superRefine((skeleton, ctx) => {
    if (skeleton.variants.filter((variant) => variant.recommended).length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Dokładnie jeden wariant ma `recommended: true`.' });
    }
    const bases = new Set(skeleton.bases.map((base) => base.name));
    skeleton.variants.forEach((variant, v) =>
      variant.days.forEach((day, d) => {
        if (!bases.has(day.base)) {
          ctx.addIssue({ code: 'custom', path: ['variants', v, 'days', d, 'base'], message: `Baza „${day.base}” nie ma wpisu w \`bases\`.` });
        }
      }),
    );
  });

export type TripSkeleton = z.infer<typeof TripSkeleton>;
export type SkeletonVariant = z.infer<typeof SkeletonVariant>;

/** Etap 2: część dokumentu, którą pisze AI. Wyjazd i uczestników składa kod z briefu. */
export const StagePlan = TripDocumentShape.pick({
  places: true,
  days: true,
  items: true,
  variantGroups: true,
  variants: true,
  constraints: true,
  notes: true,
});

export type StagePlan = z.infer<typeof StagePlan>;

/**
 * Etap 5: informacje praktyczne (SPECYFIKACJA §4) — szkic do akceptacji, nie zmiana planu.
 * Notatki tematyczne, kontakty alarmowe, lista pakowania pod warunki i skład grupy, zadania
 * z terminem względem wyjazdu i źródła. Kod sprawdza, czy adresy źródeł odpowiadają, i dopiero
 * wybrane przez człowieka elementy trafiają do planu (nowe klucze nadaje kod).
 */
export const PracticalInfo = z.object({
  notes: z
    .array(
      z.object({
        topic: z.enum(['weather', 'documents', 'money', 'health', 'safety', 'culture', 'transport', 'rules', 'packing', 'time', 'other']),
        kind: z.enum(['practical', 'tip', 'warning', 'safety']),
        title: text,
        body: text,
        /** Indeksy w `sources`, na których notatka się opiera. */
        sourceIndexes: z.array(z.number().int().nonnegative()).default([]),
      }),
    )
    .max(20),
  contacts: z
    .array(
      z.object({
        name: text,
        role: ContactRole,
        phone: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .max(12),
  packing: z
    .array(
      z.object({
        category: text,
        title: text,
        scope: z.enum(['personal', 'shared']),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .max(80),
  tasks: z
    .array(
      z.object({
        kind: z.enum(['todo', 'question', 'decision']),
        title: text,
        body: z.string().optional(),
        priority: z.enum(['high', 'normal', 'low']).optional(),
        /** Ile dni przed wyjazdem (0 = dzień wyjazdu); brak = bez terminu. */
        daysBefore: z.number().int().nonnegative().max(365).optional(),
      }),
    )
    .max(30),
  sources: z
    .array(
      z.object({
        title: text,
        url: z.url(),
        note: z.string().optional(),
      }),
    )
    .max(20),
});

export type PracticalInfo = z.infer<typeof PracticalInfo>;

/**
 * Etap 4: logistyka — kandydaci do porównania (SPECYFIKACJA §4): noclegi per baza, auto, transfery,
 * karnety. AI nie zna dostępności ani dzisiejszych cen, więc kandydat to RODZAJ oferty w obszarze
 * („riad w medynie, pokój rodzinny”) z widełkami ceny jako szacunek, warunkami do sprawdzenia,
 * plusami i minusami — bez wymyślonych nazw obiektów. Kod dokłada linki wyszukiwania (W1: bez
 * rezerwacji) i zapisuje wybrane grupy jako grupę porównania z tabelą, jak w planach wzorcowych.
 */
export const LogisticsCandidates = z.object({
  groups: z
    .array(
      z.object({
        kind: z.enum(['lodging', 'car_rental', 'transfer', 'activity', 'transit_pass', 'package', 'esim', 'insurance', 'other']),
        title: text,
        /** Gdzie szukać: miejscowość / dzielnica / lotnisko — trafia do linku wyszukiwania. */
        area: text,
        start: IsoDate.optional(),
        end: IsoDate.optional(),
        /** Warunki brzegowe wyboru („pokój dla 5 osób, parking, śniadanie”). */
        mustHave: z.string().optional(),
        /** Nagłówki tabeli porównania (2–5), np. „Cena za noc”, „Odwołanie”, „Dojście do medyny”. */
        columns: z.array(text).min(1).max(5),
        candidates: z
          .array(
            z.object({
              label: text,
              summary: z.string().optional(),
              priceMinMinor: z.number().int().nonnegative(),
              priceMaxMinor: z.number().int().nonnegative(),
              currency: z.string().regex(/^[A-Z]{3}$/),
              priceBasis: PriceBasis,
              refundable: z.boolean().optional(),
              conditions: z.array(z.string()).default([]),
              includes: z.array(z.string()).default([]),
              pros: z.array(z.string()).default([]),
              cons: z.array(z.string()).default([]),
              /** Wartości kolumn tabeli porównania, w kolejności `columns`. */
              values: z.array(z.string()),
              recommended: z.boolean().default(false),
              /** Fraza do wyszukiwarki ofert („riad medyna Marrakesz pokój rodzinny”). */
              searchQuery: text,
              /** Auto: dzienny/łączny limit km, jeśli typowy dla tej oferty. */
              kmLimit: z.number().int().positive().optional(),
            }),
          )
          .min(2)
          .max(4),
      }),
    )
    .max(8),
  /** Uwagi ogólne (np. „noclegi w grudniu warto rezerwować teraz”). */
  advice: z.array(z.string()).default([]),
});

export type LogisticsCandidates = z.infer<typeof LogisticsCandidates>;

/**
 * Etap 3: dostrajanie (czat) — łatka zamiast całego planu (SPECYFIKACJA §4). Punkty wskazuje się
 * kluczami z planu (`itemRef`, `dayRef`); nowe miejsca po nazwie, współrzędne dokłada kod.
 * Usunięty punkt domyślnie wraca do puli, a nie znika.
 */
const PatchItem = z.object({
  title: text,
  kind: ItemKind,
  durationMin: minutes.optional(),
  /** Godzina „nie wcześniej niż” (HH:MM); bez niej punkt idzie po poprzednim. */
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  precision: z.enum(['exact', 'approx']).optional(),
  /** Nazwa miejsca po polsku; istniejące miejsce planu o tej nazwie zostanie użyte ponownie. */
  place: z.string().optional(),
  /** Nazwa do wyszukania w OpenStreetMap (lokalna albo angielska). */
  searchName: z.string().optional(),
  description: z.string().optional(),
  /** Tylko przy `kind: transport`: środek, czas i dystans przejazdu, skąd/dokąd po nazwie miejsca. */
  leg: z
    .object({
      mode: LegMode,
      durationMin: minutes.optional(),
      distanceKm: z.number().nonnegative().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
});

export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('remove_item'), itemRef: Ref, toPool: z.boolean().default(true), reason: z.string().optional() }),
  z.object({ op: z.literal('move_item'), itemRef: Ref, toDayRef: Ref, afterItemRef: Ref.optional() }),
  z.object({ op: z.literal('add_item'), dayRef: Ref, afterItemRef: Ref.optional(), item: PatchItem }),
  z.object({ op: z.literal('replace_item'), itemRef: Ref, with: PatchItem }),
  z.object({
    op: z.literal('set_field'),
    itemRef: Ref,
    field: z.enum(['title', 'durationMin', 'start', 'description']),
    value: z.union([z.string(), z.number()]),
  }),
  /**
   * Przejazd (`kind: transport`): środek, czas, dystans, skąd/dokąd (nazwy miejsc planu albo nowe).
   * Czasu z trasy (`routed`) się nie nadpisuje szacunkiem — kod odrzuci taką zmianę czasu.
   */
  z.object({
    op: z.literal('set_leg'),
    itemRef: Ref,
    mode: LegMode.optional(),
    durationMin: minutes.optional(),
    distanceKm: z.number().nonnegative().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    reason: z.string().optional(),
  }),
  /**
   * Miejsce na mapie: nazwa do wyszukania w OpenStreetMap, gdy miejsca nie ma na mapie albo pinezka
   * jest podejrzanie daleko. Współrzędne dokłada kod (Geoapify) przy zastosowaniu — AI ich nie podaje.
   */
  z.object({ op: z.literal('set_place'), placeRef: Ref, searchName: text, reason: z.string().optional() }),
  /**
   * Link przy punkcie (rezerwacja, strona obiektu, bilety, mapa) — tylko adres podany przez człowieka albo
   * obecny w planie. Jedyna operacja dozwolona także na punkcie zmienionym ręcznie: niczego nie nadpisuje.
   */
  z.object({ op: z.literal('add_link'), itemRef: Ref, url: HttpUrl, label: z.string().optional() }),
  /**
   * Plan B dla dnia (pogoda, zamknięcie, samopoczucie): obecny plan dnia zostaje wariantem A,
   * wariant B zastępuje wskazane punkty nowymi. Nic nie znika z planu — decyzję podejmuje się na miejscu.
   */
  z.object({
    op: z.literal('add_variant'),
    dayRef: Ref,
    /** Nazwa decyzji: „Plan na deszcz”, „Jeśli wąwóz zamknięty”. */
    title: text,
    conditionKind: z.enum(['weather', 'closure', 'wellbeing', 'schedule_slip', 'choice']),
    /** Kiedy wybrać B: „pada od rana”, „wiatr powyżej 40 km/h”. */
    conditionText: z.string().optional(),
    /** Nazwa obecnego planu dnia (A) i nowego wariantu (B). */
    mainLabel: text,
    label: text,
    /** Punkty dnia, które B zastępuje (w A zostają). Pusto = B tylko dokłada punkty na końcu dnia. */
    replacesItemRefs: z.array(Ref).max(8).default([]),
    /** Punkty tylko w B, w kolejności — trafiają w miejsce pierwszego zastępowanego. */
    items: z.array(PatchItem).min(1).max(6),
  }),
]);

export const PlanPatch = z.object({
  ops: z.array(PatchOp).max(15),
  /** Krótka odpowiedź dla człowieka: co zmieniono i dlaczego (albo czego się nie da). */
  message: text,
});

export type PatchOp = z.infer<typeof PatchOp>;
export type PlanPatch = z.infer<typeof PlanPatch>;

/** Obszar propozycji z przeglądu planu (`REVIEW_CATEGORY` w labels). */
export const ReviewCategory = z.enum(['schedule', 'routes', 'map', 'descriptions', 'meals', 'variants', 'other']);
export type ReviewCategory = z.infer<typeof ReviewCategory>;

/**
 * Przegląd planu z AI: niezależne propozycje, każda z własną łatką. Człowiek stosuje albo odrzuca
 * każdą osobno (porównanie z planem), więc żadna nie może zależeć od innej.
 */
export const PlanReview = z.object({
  /** Dwa–trzy zdania o planie: co jest dobre, co najbardziej wymaga poprawy. */
  summary: text,
  suggestions: z
    .array(
      z.object({
        category: ReviewCategory,
        /** Krótko, co zmienić: „Dzień 3: obiad przed wąwozem, nie po”. */
        title: text,
        /** Dlaczego — z faktów planu (ostrzeżenie silnika, odległość, brak opisu). */
        why: text,
        ops: z.array(PatchOp).min(1).max(8),
      }),
    )
    .max(14),
});
export type PlanReview = z.infer<typeof PlanReview>;

/** Przegląd zapisany w `ai_runs.output` (stage `review`): propozycje z numerami i co już z nimi zrobiono. */
export const StoredReview = z.object({
  review: PlanReview.extend({ suggestions: z.array(PlanReview.shape.suggestions.element.extend({ id: z.string() })) }),
  applied: z.array(z.string()).default([]),
  dismissed: z.array(z.string()).default([]),
});
export type StoredReview = z.infer<typeof StoredReview>;

/** Waga uwagi z kontroli wyjazdu (`AUDIT_SEVERITY` w labels). */
export const AuditSeverity = z.enum(['error', 'warning', 'tip']);
/** Rodzaj uwagi: niespójność, błąd w planie, zagrożenie na miejscu, brak (`AUDIT_CATEGORY` w labels). */
export const AuditCategory = z.enum(['consistency', 'mistake', 'risk', 'missing']);

/**
 * Kontrola całego wyjazdu z AI (strona dostrajania): spójność, błędy i zagrożenia jako lista uwag do
 * przeczytania — bez łatek, plan zmienia człowiek. Klucze wskazują dzień, punkty i rezerwację.
 */
export const TripAudit = z.object({
  /** Dwa–trzy zdania: ogólna ocena i co najpilniejsze. */
  summary: text,
  findings: z
    .array(
      z.object({
        severity: AuditSeverity,
        category: AuditCategory,
        /** Krótko: „Dzień 2: wylot o 07:15, a zwrot auta o 07:30”. */
        title: text,
        /** Co dokładnie się nie zgadza albo czym grozi — z faktów planu. */
        detail: text,
        /** Co zrobić (opcjonalnie). */
        suggestion: z.string().optional(),
        dayRef: Ref.optional(),
        itemRefs: z.array(Ref).max(6).default([]),
        bookingRef: Ref.optional(),
      }),
    )
    .max(25),
});
export type TripAudit = z.infer<typeof TripAudit>;
export type AuditFinding = TripAudit['findings'][number];

/** Kontrola zapisana w `ai_runs.output` (stage `audit`): uwagi z numerami i te, które człowiek odrzucił. */
export const StoredAudit = z.object({
  audit: TripAudit.extend({ findings: z.array(TripAudit.shape.findings.element.extend({ id: z.string() })) }),
  dismissed: z.array(z.string()).default([]),
});
export type StoredAudit = z.infer<typeof StoredAudit>;
