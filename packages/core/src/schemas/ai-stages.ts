import { z } from 'zod';

import { IsoDate } from './common.ts';
import { Ref, TripDocumentShape } from './trip-document.ts';

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
