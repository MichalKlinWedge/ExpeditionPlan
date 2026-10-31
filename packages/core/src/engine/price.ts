import type { Price } from '../schemas/price.ts';

/**
 * Kwota dla konkretnej grupy (SPECYFIKACJA §5, `Price`). Kasa Pałacu Bahia liczy dorosłego od
 * 14 lat, medresa — od 13, operator quadów — od 16; ta sama piątka płaci w każdym miejscu inaczej.
 */

export type PriceTraveler = { ref: string; age?: number | undefined };

export type GroupPrice = {
  currency: string;
  minMinor: number;
  maxMinor: number;
  /** Uczestnicy bez wieku przy cenie z progami — policzeni według najwyższego progu. */
  unknownAgeRefs: string[];
  approx: boolean;
};

/** Próg dla wieku; bez wieku albo bez pasującego progu — najdroższy (bezpieczny szacunek). */
function tierAmount(price: Price, age: number | undefined): { amount: number; known: boolean } {
  const tiers = price.tiers ?? [];
  const highest = Math.max(...tiers.map((tier) => tier.amountMinor));
  if (age === undefined) return { amount: highest, known: false };
  const match = tiers.find(
    (tier) => (tier.minAge === undefined || age >= tier.minAge) && (tier.maxAge === undefined || age <= tier.maxAge),
  );
  return match === undefined ? { amount: highest, known: false } : { amount: match.amountMinor, known: true };
}

export function priceForGroup(price: Price, travelers: PriceTraveler[]): GroupPrice {
  const result: GroupPrice = {
    currency: price.currency,
    minMinor: price.minMinor,
    maxMinor: price.maxMinor,
    unknownAgeRefs: [],
    approx: price.approx || price.from,
  };

  if (price.basis !== 'per_person') return result;

  if (price.tiers !== undefined && price.tiers.length > 0) {
    let total = 0;
    for (const traveler of travelers) {
      const { amount, known } = tierAmount(price, traveler.age);
      total += amount;
      if (!known) result.unknownAgeRefs.push(traveler.ref);
    }
    result.minMinor = total;
    result.maxMinor = total;
    return result;
  }

  result.minMinor = price.minMinor * travelers.length;
  result.maxMinor = price.maxMinor * travelers.length;
  return result;
}
