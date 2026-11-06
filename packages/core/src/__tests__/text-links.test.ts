import { describe, expect, it } from 'vitest';

import { linkLabel, splitLinks } from '../text-links.ts';

describe('linki w tekście', () => {
  const airbnb = 'https://www.airbnb.pl/rooms/1755327897849431659?adults=4&check_in=2026-12-05&check_out=2026-12-07';

  it('adres pokazuje się jako sama nazwa strony, a link prowadzi pod pełny adres', () => {
    expect(splitLinks(`5 gru → 7 gru 11:00 · ${airbnb} · 540 zł`)).toEqual([{ text: '5 gru → 7 gru 11:00 · ' }, { url: airbnb, label: 'airbnb.pl' }, { text: ' · 540 zł' }]);
  });

  it('tekst bez adresu zostaje w całości', () => {
    expect(splitLinks('Wizz Air W6 1812 · BCN T2')).toEqual([{ text: 'Wizz Air W6 1812 · BCN T2' }]);
    expect(splitLinks('')).toEqual([]);
  });

  it('kilka adresów i interpunkcja po adresie', () => {
    expect(splitLinks('https://a.pl/x, zob. (http://b.pl).')).toEqual([{ url: 'https://a.pl/x', label: 'a.pl' }, { text: ', zob. (' }, { url: 'http://b.pl', label: 'b.pl' }, { text: ').' }]);
  });

  it('tylko http i https', () => {
    expect(linkLabel('javascript:alert(1)')).toBeNull();
    expect(linkLabel('nie adres')).toBeNull();
    expect(splitLinks('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });
});
