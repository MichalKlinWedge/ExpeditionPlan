/**
 * Klucz kolejności między dwoma innymi (fractional indexing, SPECYFIKACJA §5 `sort_key`):
 * przeciągnięcie punktu zmienia jeden wiersz, a nie numerację całego dnia. Alfabet jak w
 * `SortKey` dokumentu (cyfry i małe litery), porównanie jak tekst — „0010” < „0015” < „002”.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

const digit = (key: string, index: number) => (index < key.length ? DIGITS.indexOf(key[index]!) : 0);

export class NoRoomError extends Error {
  constructor(before: string, after: string) {
    super(`Między „${before}” a „${after}” nie ma miejsca na klucz.`);
    this.name = 'NoRoomError';
  }
}

/**
 * Świeże klucze dla całej listy („0010”, „0020”…), gdy między dwoma nie ma już miejsca.
 * `prefix` (np. znacznik czasu) sprawia, że nowe klucze nie zderzą się ze starymi, gdy wiersze
 * zapisuje się po kolei przy unikalnym indeksie (dzień, klucz).
 */
export function renumber(count: number, prefix = ''): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String((index + 1) * 10).padStart(4, '0')}`);
}

/**
 * Klucz ściśle między `before` a `after` (brak = początek / koniec listy). Nie kończy się zerem,
 * więc zawsze da się wstawić coś przed nim.
 */
export function keyBetween(before?: string, after?: string): string {
  if (before !== undefined && after !== undefined && before >= after) {
    throw new Error(`Klucz „${before}” nie jest przed „${after}”.`);
  }
  if (after === undefined) {
    // Na koniec: zwiększ pierwszą cyfrę, która nie jest maksymalna, i utnij resztę.
    const start = before ?? '';
    for (let i = 0; i < start.length; i++) {
      if (digit(start, i) < BASE - 1) return start.slice(0, i) + DIGITS[digit(start, i) + 1];
    }
    return `${start}${DIGITS[BASE / 2]}`;
  }
  const low = before ?? '';
  let prefix = '';
  for (let i = 0; ; i++) {
    // `after` wyczerpany przy równym prefiksie: `before` to `after` z samymi zerami na końcu
    // („001” i „0010”) — między nimi nie ma klucza; trzeba przenumerować listę (`renumber`).
    if (i >= after.length) throw new NoRoomError(before ?? '', after);
    const lowDigit = digit(low, i);
    const highDigit = digit(after, i);
    if (highDigit - lowDigit > 1) return prefix + DIGITS[Math.floor((lowDigit + highDigit) / 2)];
    if (highDigit - lowDigit === 1) {
      // Sąsiednie cyfry: zostań przy dolnej i szukaj miejsca w dalszej części `before`.
      prefix += DIGITS[lowDigit];
      const rest = low.slice(i + 1);
      for (let j = 0; j < rest.length; j++) {
        if (digit(rest, j) < BASE - 1) return prefix + rest.slice(0, j) + DIGITS[digit(rest, j) + 1];
      }
      return prefix + rest + DIGITS[BASE / 2];
    }
    prefix += DIGITS[lowDigit];
  }
}
