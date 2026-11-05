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

  it('najważniejsze punkty pochodzą z listy, najwyżej dwa na dzień, bez powtórek i w parzystej liczbie', () => {
    const doc = fixture('gruzja');
    expect(tripOverview(doc).highlights).toEqual([]);

    const points = tripOverview(doc).days.flatMap((day) => day.points.map((title) => ({ dayNo: day.no, ref: doc.items.find((item) => item.title === title)!.ref })));
    const every = new Map(points.map((point) => [point.ref, [`opis-${point.ref}`]]));
    const { highlights } = tripOverview(doc, { guided: every });
    expect(highlights).toHaveLength(12);
    for (const { dayNo } of highlights) expect(highlights.filter((each) => each.dayNo === dayNo).length).toBeLessThanOrEqual(2);
    expect(new Set(highlights.map((each) => each.dayNo)).size).toBe(new Set(points.map((point) => point.dayNo)).size);
    const days = highlights.map((each) => each.dayNo);
    expect(days).toEqual([...days].sort((a, b) => a - b));

    const [first, second, third, fourth] = points;
    // Wspólny którykolwiek klucz (artykuł, zdjęcie) to powtórka.
    const same = tripOverview(doc, { guided: new Map([[first!.ref, ['artykuł', 'zdjęcie 1']], [second!.ref, ['artykuł 2', 'zdjęcie 1']], [third!.ref, ['artykuł', 'zdjęcie 3']], [fourth!.ref, ['artykuł 4', 'zdjęcie 4']]]) }).highlights;
    expect(same.map((each) => each.ref)).toEqual([first!.ref, fourth!.ref]);
  });

  it('ten sam tytuł punktu nie powtarza się, nawet z innym opisem', () => {
    const doc = fixture('gruzja');
    const refs = tripOverview(doc).days.flatMap((day) => day.points.map((title) => doc.items.find((item) => item.title === title)!.ref));
    const [first, second, third] = refs;
    const title = doc.items.find((item) => item.ref === first)!.title;
    const renamed = { ...doc, items: doc.items.map((item) => (item.ref === second ? { ...item, title: ` ${title.toUpperCase()} ` } : item)) };
    const { highlights } = tripOverview(renamed, { guided: new Map([first!, second!, third!].map((ref) => [ref, [ref]])) });
    expect(highlights.map((each) => each.ref)).toEqual([first!, third!]);
  });

  it('nieparzysta liczba punktów traci ten z najniższą oceną', () => {
    const doc = fixture('gruzja');
    const perDay = tripOverview(doc).days.filter((day) => day.points.length > 0).map((day) => doc.items.find((item) => item.title === day.points[0])!.ref);
    const [first, second, third] = perDay;
    const guided = (refs: string[]) => new Map(refs.map((ref) => [ref, [ref]]));
    expect(tripOverview(doc, { guided: guided([first!]) }).highlights).toEqual([]);
    expect(tripOverview(doc, { guided: guided([first!, second!, third!]) }).highlights.map((each) => each.ref)).toEqual([first!, second!]);
    const marked = { ...doc, items: doc.items.map((item) => (item.ref === third ? { ...item, priority: 'must' as const } : item.ref === first ? { ...item, priority: 'optional' as const } : item)) };
    expect(tripOverview(marked, { guided: guided([first!, second!, third!]) }).highlights.map((each) => each.ref)).toEqual([second!, third!]);
  });

  it('w ramach dnia najpierw punkt oznaczony „koniecznie”', () => {
    const doc = fixture('gruzja');
    const day = tripOverview(doc).days.find((each) => each.points.length >= 3)!;
    const refs = day.points.map((title) => doc.items.find((item) => item.title === title)!.ref);
    const last = refs.at(-1)!;
    const marked = { ...doc, items: doc.items.map((item) => (item.ref === last ? { ...item, priority: 'must' as const } : item)) };
    const { highlights } = tripOverview(marked, { guided: new Map(refs.map((ref) => [ref, [ref]])) });
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

describe('kilometry pieszo przy wariantach', () => {
  /** Dwie trasy do wyboru: polecana krótsza i dłuższa z większym przewyższeniem. */
  function withRoutes(chosen?: string) {
    const base = fixture('dinara');
    const group = { ref: 'g-trasa', scope: 'day' as const, dayRef: base.days[0]!.ref, title: 'Którą trasą?', conditionKind: 'choice' as const, ...(chosen ? { chosenRef: chosen } : {}) };
    const variant = (ref: string, recommended?: boolean) => ({ ref, groupRef: group.ref, label: ref, ...(recommended ? { recommended } : {}), pros: [], cons: [], excludesRefs: [] });
    const template = base.items.find((item) => item.dayRef === base.days[0]!.ref && item.kind !== 'transport')!;
    const hike = (ref: string, variantRef: string, distanceKm: number, ascentM: number) => ({ ...template, ref, title: ref, kind: 'activity' as const, sortKey: ref.length === 8 ? 'zz1' : 'zz2', leg: undefined, parentRef: undefined, bookingRef: undefined, variantRefs: [variantRef], activity: { distanceKm, ascentM } });
    return TripDocument.parse({ ...base, variantGroups: [...base.variantGroups, group], variants: [...base.variants, variant('krotka', true), variant('dluga')], items: [...base.items, hike('t-krotka', 'krotka', 10, 100), hike('t-dluga', 'dluga', 25, 900)] });
  }

  it('nierozstrzygnięty wybór: najdłuższy wariant obok liczb z polecanego', () => {
    const plain = tripOverview(fixture('dinara'));
    const overview = tripOverview(withRoutes());
    expect(overview.stats.footKm).toBeCloseTo(tripOverview(fixture('dinara')).stats.footKm + 10, 1);
    expect(overview.footMax?.km).toBeCloseTo(overview.stats.footKm + 15, 1);
    expect(overview.footMax?.ascentM).toBe(overview.stats.ascentM + 800);
    expect(overview.stats.planned).toBe(plain.stats.planned + 1);
  });

  it('rozstrzygnięty wybór albo wskazany z zewnątrz zostaje przy swoim', () => {
    const decided = tripOverview(withRoutes('krotka'));
    expect(decided.footMax).toEqual(tripOverview(fixture('dinara')).footMax);
    const pointed = tripOverview(withRoutes(), { activeVariants: { 'g-trasa': 'krotka' } });
    expect(pointed.footMax).toEqual(tripOverview(fixture('dinara')).footMax);
  });

  it('bez różnicy między wariantami nie ma osobnej liczby', () => {
    const base = fixture('maroko');
    const noLonger = { ...base, variantGroups: [], variants: [], items: base.items.filter((item) => item.variantRefs.length === 0) };
    expect(tripOverview(noLonger).footMax).toBeUndefined();
  });
});
