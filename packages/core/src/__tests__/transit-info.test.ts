import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { legRouteLink, transitRouteUrl } from '../item-route.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyTransitDraft, segmentsLabel, TransitDraft, transitDetails, transitDraftRows, transitLines } from '../transit-info.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const METRO = 'd1-metro-espanya';

const draft = (patch: Partial<TransitDraft> = {}): TransitDraft =>
  TransitDraft.parse({
    isRoute: true,
    segments: [
      { mode: 'walk', line: null, from: null, to: 'Sagrada Família', durationMin: 3 },
      { mode: 'bus', line: 'H10', from: 'Sagrada Família', to: 'Pl. Espanya', durationMin: 20 },
    ],
    durationMin: 30,
    frequencyMin: 8,
    departures: ['10:05', '10:13'],
    instructions: 'Autobus H10 z przystanku przy Marina.',
    alternative: 'Metro L5 i L3, ok. 25 min.',
    ...patch,
  });

describe('link do trasy komunikacją', () => {
  const places = [
    { ref: 'a', name: 'Sagrada Família', lat: 41.4036, lng: 2.1744, provider: 'user' as const, links: [] },
    { ref: 'b', name: 'Espanya', provider: 'unknown' as const, links: [] },
  ];
  const doc = { places, tracks: [], items: [], days: [] } as unknown as TripDocument;
  const item = (mode: string, leg: object) => ({ kind: 'transport', variantRefs: [], leg: { mode, links: [], ...leg } }) as unknown as TripDocument['items'][number];

  it('Mapy Google w trybie komunikacji, koniec bez współrzędnych nazwą', () => {
    expect(transitRouteUrl(doc, item('metro', { fromPlaceRef: 'a', toPlaceRef: 'b' }))).toBe('https://www.google.com/maps/dir/?api=1&origin=41.4036%2C2.1744&destination=Espanya&travelmode=transit');
    expect(legRouteLink(doc, item('bus', { fromPlaceRef: 'a', toPlaceRef: 'b' }))?.label).toBe('Trasa komunikacją w Mapach Google');
  });

  it('nie dla auta, bez celu ani do tego samego miejsca', () => {
    expect(transitRouteUrl(doc, item('car', { fromPlaceRef: 'a', toPlaceRef: 'b' }))).toBeNull();
    expect(transitRouteUrl(doc, item('bus', {}))).toBeNull();
    expect(transitRouteUrl(doc, item('bus', { fromPlaceRef: 'a', toPlaceRef: 'a' }))).toBeNull();
  });

  it('w planie bez „skąd”: start z poprzedniego punktu dnia', () => {
    const plan = fixture('barcelona');
    const metro = plan.items.find((each) => each.ref === METRO)!;
    const { fromPlaceRef: _from, ...leg } = metro.leg!;
    const without = { ...metro, leg };
    expect(transitRouteUrl({ ...plan, items: plan.items.map((each) => (each.ref === METRO ? without : each)) }, without)).toMatch(/origin=41\.\d+%2C2\.\d+&destination=.+&travelmode=transit$/);
  });
});

describe('szczegóły przejazdu komunikacją', () => {
  it('odcinki, przesiadka i linie z planu', () => {
    const metro = fixture('barcelona').items.find((each) => each.ref === METRO)!;
    expect(transitLines(metro)).toBe('L5 → L3');
    expect(transitDetails(metro)[0]).toBe('metro L5 Sagrada Família → Diagonal, przesiadka: metro L3 Diagonal → Espanya');
    expect(transitDetails(metro)).toContain('Metro L5 do Diagonal, przesiadka na L3 do Espanya (ok. 25 min).');
  });

  it('dojście pieszo przed pierwszą linią to nie przesiadka', () => {
    expect(segmentsLabel(draft().segments as never)).toBe('pieszo do Sagrada Família (3 min), autobus H10 Sagrada Família → Pl. Espanya (20 min)');
  });

  it('nic dla przejazdu autem', () => {
    const car = { kind: 'transport', leg: { mode: 'car', line: 'x', links: [] } } as unknown as TripDocument['items'][number];
    expect(transitDetails(car)).toEqual([]);
    expect(transitLines(car)).toBeNull();
  });
});

describe('szkic z wklejonej trasy', () => {
  const plan = fixture('barcelona');
  const metro = plan.items.find((each) => each.ref === METRO)!;

  it('podgląd: inne wartości z planu jako „teraz”, zmiana środka widoczna', () => {
    const rows = transitDraftRows(metro, draft());
    expect(rows.map((row) => row.key)).toEqual(['segments', 'durationMin', 'frequencyMin', 'departures', 'instructions', 'alternative']);
    expect(rows[0]!.value).toContain('(środek w planie zmieni się na: autobus)');
    expect(rows[0]!.current).toContain('metro L5');
    expect(rows.find((row) => row.key === 'durationMin')).toMatchObject({ value: '30 min', current: '25 min' });
  });

  it('pola bez wartości i takie same jak w planie nie trafiają na listę', () => {
    const same = draft({ segments: [], durationMin: 25, frequencyMin: null, departures: [], alternative: null, instructions: metro.leg!.instructions! });
    expect(transitDraftRows(metro, same)).toEqual([]);
  });

  it('zapis zaznaczonych: odcinki ustawiają linię i środek, czas idzie do leg jako „z podanej trasy”', () => {
    const edit = applyTransitDraft(plan, METRO, draft(), ['segments', 'durationMin', 'departures'])!;
    expect(edit.item.leg).toMatchObject({ mode: 'bus', line: 'H10', durationMin: 30, routed: false, departures: ['10:05', '10:13'], instructions: metro.leg!.instructions });
    expect(edit.item.leg!.frequencyMin).toBe(metro.leg!.frequencyMin);
    expect(edit.item.leg!.segments).toHaveLength(2);
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });

  it('czas wpisany ręcznie w punkt zmienia się w punkcie', () => {
    const manual = { ...plan, items: plan.items.map((each) => (each.ref === METRO ? { ...each, durationMin: 40 } : each)) };
    const edit = applyTransitDraft(manual, METRO, draft(), ['durationMin'])!;
    expect(edit.item.durationMin).toBe(30);
    expect(edit.item.leg!.durationMin).toBe(metro.leg!.durationMin);
  });

  it('nie dla punktu, który nie jedzie komunikacją', () => {
    const other = plan.items.find((each) => each.kind !== 'transport')!;
    expect(applyTransitDraft(plan, other.ref, draft(), ['segments'])).toBeNull();
  });
});

describe('opis odcinków', () => {
  it('przejście na tej samej stacji bez „A → A”', () => {
    expect(segmentsLabel([{ mode: 'metro', line: 'L5', to: 'Diagonal' }, { mode: 'walk', from: 'Diagonal', to: 'Diagonal', durationMin: 4 }])).toBe('metro L5 do Diagonal, pieszo na Diagonal (4 min)');
  });
});
