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

  it('osoby, które się wahają, są policzone osobno od pewnych', () => {
    const doc = fixture('chatka');
    expect(tripOverview(doc)).toMatchObject({ people: doc.travelers.length, tentative: 0 });
    expect(tripOverview(doc, { tentative: 2 })).toMatchObject({ people: doc.travelers.length - 2, tentative: 2 });
    expect(tripOverview(doc, { tentative: doc.travelers.length + 5 })).toMatchObject({ people: 0, tentative: doc.travelers.length });
  });

  it('każdy dzień jest na liście, a noce z noclegów sumują się z pobytami', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const overview = tripOverview(doc);
      expect(overview.days.map((day) => day.no)).toEqual(doc.days.map((_, index) => index + 1));
      expect(overview.stays.reduce((sum, stay) => sum + stay.nights, 0)).toBe(overview.nights);
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

  it('najważniejsze punkty mają opis, najwyżej dwa na dzień i bez powtórzeń tego samego opisu', () => {
    const doc = fixture('gruzja');
    expect(tripOverview(doc).highlights).toEqual([]);

    const points = tripOverview(doc).days.flatMap((day) => day.points.map((title) => ({ dayNo: day.no, ref: doc.items.find((item) => item.title === title)!.ref })));
    const every = new Map(points.map((point) => [point.ref, `opis-${point.ref}`]));
    const { highlights } = tripOverview(doc, { guided: every });
    expect(highlights).toHaveLength(12);
    for (const { dayNo } of highlights) expect(highlights.filter((each) => each.dayNo === dayNo).length).toBeLessThanOrEqual(2);
    expect(new Set(highlights.map((each) => each.dayNo)).size).toBe(new Set(points.map((point) => point.dayNo)).size);
    const days = highlights.map((each) => each.dayNo);
    expect(days).toEqual([...days].sort((a, b) => a - b));

    const [first, second] = points;
    const same = tripOverview(doc, { guided: new Map([[first!.ref, 'ten sam'], [second!.ref, 'ten sam']]) }).highlights;
    expect(same.map((each) => each.ref)).toEqual([first!.ref]);
  });

  it('w ramach dnia najpierw punkt oznaczony „koniecznie”', () => {
    const doc = fixture('gruzja');
    const day = tripOverview(doc).days.find((each) => each.points.length >= 3)!;
    const refs = day.points.map((title) => doc.items.find((item) => item.title === title)!.ref);
    const last = refs.at(-1)!;
    const marked = { ...doc, items: doc.items.map((item) => (item.ref === last ? { ...item, priority: 'must' as const } : item)) };
    const { highlights } = tripOverview(marked, { guided: new Map(refs.map((ref) => [ref, ref])) });
    expect(highlights.map((each) => each.ref)).toContain(last);
    expect(highlights).toHaveLength(2);
  });

  it('kandydat na rezerwację bez wybranego wariantu nie wchodzi do przejazdów', () => {
    const doc = fixture('maroko');
    const overview = tripOverview(doc);
    const candidates = doc.bookings.filter((booking) => booking.variantGroupRef !== undefined && booking.variantRef === undefined).map((booking) => booking.ref);
    expect(overview.transport.some((each) => candidates.includes(each.ref))).toBe(false);
  });
});
