import { z } from 'zod';

import { Currency, IsoDate, MinorAmount } from './common.ts';

/**
 * Cena w planie (SPECYFIKACJA §5). W realnych planach cena prawie nigdy nie jest jedną liczbą:
 * „€95–165”, „od ok. 850 MAD”, „50 MAD dorosły, 10 MAD dziecko poniżej 12 lat”, „ok. 1 € winda”.
 * Ten kształt to unosi, a kwota dla konkretnej grupy jest liczona z wieku uczestników.
 *
 * Pola `jsonb` trzymamy w camelCase (tak jak schematy Zod); kolumny tabel — w snake_case.
 */

export const PriceBasis = z.enum(['per_person', 'per_group', 'per_unit', 'per_night', 'per_day']);
export type PriceBasis = z.infer<typeof PriceBasis>;

/** Próg cenowy: „dziecko 7–13”, „dorosły od 13”. Granice wieku włącznie. */
export const PriceTier = z
  .object({
    label: z.string().min(1),
    minAge: z.number().int().min(0).optional(),
    maxAge: z.number().int().min(0).optional(),
    amountMinor: MinorAmount,
  })
  .refine((tier) => tier.minAge === undefined || tier.maxAge === undefined || tier.minAge <= tier.maxAge, {
    message: 'Dolna granica wieku nie może być większa od górnej.',
  });
export type PriceTier = z.infer<typeof PriceTier>;

export const Price = z
  .object({
    currency: Currency,
    basis: PriceBasis,
    /** Dolna granica. Przy cenie dokładnej równa górnej. */
    minMinor: MinorAmount,
    maxMinor: MinorAmount,
    /** „od ok. 850 MAD” — górna granica nieznana albo umowna. */
    from: z.boolean().default(false),
    /** Szacunek albo rząd wielkości, a nie cena z cennika. */
    approx: z.boolean().default(false),
    /** Progi wiekowe. Gdy są, mają pierwszeństwo przed min/max przy liczeniu kwoty dla grupy. */
    tiers: z.array(PriceTier).optional(),
    note: z.string().optional(),
    checkedAt: IsoDate.optional(),
    sourceId: z.uuid().optional(),
  })
  .refine((price) => price.minMinor <= price.maxMinor, {
    message: 'Dolna granica ceny nie może być większa od górnej.',
    path: ['maxMinor'],
  });
export type Price = z.infer<typeof Price>;
