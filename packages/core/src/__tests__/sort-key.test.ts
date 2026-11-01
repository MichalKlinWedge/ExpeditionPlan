import { describe, expect, it } from 'vitest';

import { SortKey } from '../schemas/trip-document.ts';
import { keyBetween, NoRoomError, renumber } from '../sort-key.ts';

const valid = (key: string) => SortKey.safeParse(key).success;

describe('klucz kolejności', () => {
  it('między kluczami z planów wzorcowych', () => {
    const key = keyBetween('0010', '0020');
    expect('0010' < key && key < '0020').toBe(true);
    expect(valid(key)).toBe(true);
  });

  it('sąsiednie klucze i klucz będący prefiksem', () => {
    for (const [a, b] of [
      ['0010', '0011'],
      ['001', '0011'],
      ['a', 'a1'],
      ['0019z', '002'],
    ] as const) {
      const key = keyBetween(a, b);
      expect(a < key && key < b, `${a} < ${key} < ${b}`).toBe(true);
    }
  });

  it('na początek i na koniec listy', () => {
    expect(keyBetween(undefined, '0010') < '0010').toBe(true);
    expect(keyBetween('0010') > '0010').toBe(true);
    expect(keyBetween('zzzz') > 'zzzz').toBe(true);
    expect(valid(keyBetween())).toBe(true);
  });

  it('sto wstawień w to samo miejsce zostaje uporządkowane', () => {
    let low = '0010';
    const high = '0020';
    for (let i = 0; i < 100; i++) {
      const key = keyBetween(low, high);
      expect(low < key && key < high).toBe(true);
      low = key;
    }
  });

  it('zła kolejność argumentów to błąd', () => {
    expect(() => keyBetween('0020', '0010')).toThrow();
  });

  it('bez miejsca (różnica tylko w końcowych zerach) — błąd NoRoomError, wtedy przenumerowanie', () => {
    expect(() => keyBetween('001', '0010')).toThrow(NoRoomError);
    expect(renumber(3)).toEqual(['0010', '0020', '0030']);
  });

  it('klucze z generatora nigdy nie kończą się zerem', () => {
    const keys = [keyBetween(), keyBetween('0010'), keyBetween('0010', '0020'), keyBetween(undefined, '0010'), keyBetween('0019z', '002')];
    for (const key of keys) expect(key.endsWith('0'), key).toBe(false);
  });
});
