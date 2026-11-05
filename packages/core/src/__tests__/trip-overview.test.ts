import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { tripOverview, withoutAmounts } from '../trip-overview.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('zdania bez kwot', () => {
  it('wypada całe zdanie z kwotą, skrót „ok.” nie kończy zdania', () => {
    expect(withoutAmounts('Loty: 3 775 zł (755 zł od osoby). Jazda: 710 km. Całość: ok. 11 400 zł, z czego dużo już zapłacone. Cztery noce.')).toBe('Jazda: 710 km. Cztery noce.');
  });

  it('różne zapisy kwot', () => {
    for (const text of ['Bilet 25 EUR.', 'Bilet €25.', 'Bilet 1,5 tys. zł.', 'Nocleg 300 dirhamów.', 'Wstęp 100 MAD']) expect(withoutAmounts(text)).toBe('');
    expect(withoutAmounts('Bilet 40 XYZ.', ['XYZ'])).toBe('');
  });

  it('liczby bez waluty i tekst bez kwot zostają nietknięte', () => {
    const text = 'Szczyt 1831 m n.p.m., 12 km i 5 osób.\nNocka w chatce.';
    expect(withoutAmounts(text)).toBe(text);
  });
});

describe('opis wyprawy', () => {
  it('kwoty z podsumowania i uwag znikają przy ukrytych cenach, przy widocznych zostają', () => {
    const doc = fixture('maroko');
    expect(doc.trip.summary).toContain('zł');
    const hidden = tripOverview(doc, { hide: { costs: true } });
    expect(hidden.summary).toContain('710 km');
    expect(hidden.summary).not.toMatch(/\d\s?zł/);
    expect(JSON.stringify(hidden.notes)).not.toMatch(/\d\s?zł/);
    expect(tripOverview(doc, { hide: { costs: false } }).summary).toBe(doc.trip.summary);
  });

  it('przy ukrytych imionach nie ma imion, celu, podsumowania ani ostrzeżeń, a liczba osób zostaje', () => {
    const doc = fixture('chatka');
    const open = tripOverview(doc, { hide: { names: false } });
    expect(open.goal).toBeDefined();
    expect(open.notes.length).toBeGreaterThan(0);
    expect(open.names).toHaveLength(doc.travelers.length);
    const hidden = tripOverview(doc, { hide: { names: true } });
    expect(hidden.goal).toBeUndefined();
    expect(hidden.summary).toBeUndefined();
    expect(hidden.notes).toEqual([]);
    expect(hidden.names).toEqual([]);
    expect(hidden.people).toBe(doc.travelers.length);
  });

  it('każdy dzień jest na liście, a noce z noclegów sumują się z pobytami', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const overview = tripOverview(doc);
      expect(overview.days.map((day) => day.no)).toEqual(doc.days.map((_, index) => index + 1));
      expect(overview.stays.reduce((sum, stay) => sum + stay.nights, 0)).toBe(overview.nights);
      expect(overview.highlights.length).toBeLessThanOrEqual(8);
      expect(new Set(overview.highlights.map((each) => each.title)).size).toBe(overview.highlights.length);
    }
  });

  it('pobyt tej samej nocy łączy się w jeden i ma datę wymeldowania', () => {
    const { stays, route } = tripOverview(fixture('gruzja'));
    expect(stays.length).toBeGreaterThan(1);
    expect(stays.length).toBeLessThan(fixture('gruzja').days.length);
    for (const stay of stays) expect(Date.parse(stay.to) - Date.parse(stay.from)).toBe(stay.nights * 86_400_000);
    expect(route.length).toBeGreaterThan(1);
    expect(route.every((each, index) => each !== route[index - 1])).toBe(true);
  });

  it('wśród najważniejszych najpierw „koniecznie” i punkty z opisem, potem w kolejności wyjazdu', () => {
    const doc = fixture('gruzja');
    const plain = tripOverview(doc).highlights;
    const last = tripOverview(doc).days.flatMap((day) => day.points).at(-1)!;
    const lastRef = doc.items.find((item) => item.title === last)!.ref;
    const withGuide = tripOverview(doc, { guided: [lastRef] }).highlights;
    expect(withGuide.map((each) => each.title)).toContain(last);
    expect(withGuide.at(-1)!.title).toBe(last);
    expect(plain).toHaveLength(8);
    const orders = withGuide.map((each) => each.dayNo);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('przy równych ocenach najważniejsze punkty pochodzą z różnych dni', () => {
    const { highlights, days } = tripOverview(fixture('gruzja'));
    const withSights = days.filter((day) => day.points.length > 0).length;
    expect(new Set(highlights.map((each) => each.dayNo)).size).toBe(Math.min(withSights, highlights.length));
  });

  it('kandydat na rezerwację bez wybranego wariantu nie wchodzi do przejazdów', () => {
    const doc = fixture('maroko');
    const overview = tripOverview(doc);
    const candidates = doc.bookings.filter((booking) => booking.variantGroupRef !== undefined && booking.variantRef === undefined).map((booking) => booking.ref);
    expect(overview.transport.some((each) => candidates.includes(each.ref))).toBe(false);
  });
});
