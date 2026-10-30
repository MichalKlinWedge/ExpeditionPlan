/** Polska odmiana rzeczownika po liczbie: 1 sekunda, 2 sekundy, 5 sekund, 22 sekundy. */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count);
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (abs === 1) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/** Liczba razem z odmienionym rzeczownikiem, np. „60 sekund”. */
export const pluralWith = (count: number, one: string, few: string, many: string): string =>
  `${count} ${plural(count, one, few, many)}`;
