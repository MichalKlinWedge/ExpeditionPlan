import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyLegEnds, checkLegEnds, titleEnds } from '../leg-ends-check.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const gruzja = fixture('gruzja');

let counter = 0;
const newId = () => `0000-${counter++}`;

/** Gruzja bez wskazanych końców przejazdów. */
function without(doc: TripDocument, changes: Record<string, { from?: true; to?: true }>): TripDocument {
  return {
    ...doc,
    items: doc.items.map((item) => {
      const change = changes[item.ref];
      if (change === undefined || item.leg === undefined) return item;
      const { fromPlaceRef, toPlaceRef, ...leg } = item.leg;
      const { placeRef, ...rest } = item;
      return {
        ...(change.to ? rest : { ...rest, ...(placeRef !== undefined ? { placeRef } : {}) }),
        leg: { ...leg, ...(change.from ? {} : fromPlaceRef !== undefined ? { fromPlaceRef } : {}), ...(change.to ? {} : toPlaceRef !== undefined ? { toPlaceRef } : {}) },
      };
    }),
  };
}

describe('titleEnds', () => {
  it('strzałka, „z … do …”, samo „do”', () => {
    expect(titleEnds('Zugdidi → Mestia')).toEqual({ from: 'Zugdidi', to: 'Mestia' });
    expect(titleEnds('Wylot Wrocław 15:40 → Kutaisi 21:10')).toEqual({ from: 'Wylot Wrocław', to: 'Kutaisi' });
    expect(titleEnds('Przejazd z Kutaisi do Mestii')).toEqual({ from: 'Kutaisi', to: 'Mestii' });
    expect(titleEnds('Dojazd do Mazeri (wodospad Uszba)')).toEqual({ to: 'Mazeri' });
    expect(titleEnds('Kolacja')).toEqual({});
  });
});

describe('checkLegEnds', () => {
  it('plan z kompletem końców nie ma braków', () => {
    const check = checkLegEnds(gruzja, newId);
    expect(check.gaps).toEqual([]);
    expect(check.checked).toBeGreaterThan(10);
  });

  it('z tytułu punktu, z odmianą nazwy', () => {
    const doc = without(gruzja, { 'd2-dojazd-mestia': { from: true, to: true } });
    const check = checkLegEnds(doc, newId);
    expect(check.gaps).toEqual([{ itemRef: 'd2-dojazd-mestia', title: 'Zugdidi → Mestia', dayRef: 'd2', missing: ['from', 'to'] }]);
    expect(check.proposals.map((each) => [each.end, each.place.ref, each.source])).toEqual([
      ['from', 'zugdidi', 'title'],
      ['to', 'mestia', 'title'],
    ]);
  });

  it('start pierwszego przejazdu dnia = nocleg z poprzedniej nocy', () => {
    const doc = without(gruzja, { 'd4-dojazd-uszguli': { from: true } });
    const [proposal] = checkLegEnds(doc, newId).proposals;
    expect(proposal).toMatchObject({ end: 'from', source: 'lodging', place: { ref: 'mestia' } });
  });

  it('cel = miejsce, w którym zaczyna się następny punkt', () => {
    const base = without(gruzja, { 'd12-jaskinia-kutaisi': { to: true } });
    const doc = { ...base, items: base.items.map((item) => (item.ref === 'd12-jaskinia-kutaisi' ? { ...item, title: 'Przejazd' } : item)) };
    const [proposal] = checkLegEnds(doc, newId).proposals;
    expect(proposal).toMatchObject({ end: 'to', source: 'next', place: { ref: 'katedra-bagrati' } });
  });

  it('ze śladu: koniec przy istniejącym miejscu i nowe miejsce z nazwy trasy', () => {
    const base = without(gruzja, { 'd5-dojscie-koruldi': { from: true, to: true } });
    const doc: TripDocument = {
      ...base,
      tracks: [...base.tracks, { ref: 'slad', name: 'Trasa z Parkingu Pod Krzyżem do Jezior Koruldi', geojson: { type: 'LineString', coordinates: [[42.69, 43.05], [42.70308, 43.08769]] } }],
      items: base.items.map((item) => (item.ref === 'd5-dojscie-koruldi' ? { ...item, activity: { ...item.activity, trackRef: 'slad' } } : item)),
    };
    const check = checkLegEnds(doc, newId);
    const [from, to] = check.proposals;
    expect(from).toMatchObject({ end: 'from', source: 'track', created: true, place: { name: 'Parkingu Pod Krzyżem', lat: 43.05, lng: 42.69 } });
    expect(to).toMatchObject({ end: 'to', source: 'track', created: false, place: { ref: 'jeziora-koruldi' } });

    const edit = applyLegEnds(doc, check.proposals);
    expect(() => TripDocument.parse(edit.doc)).not.toThrow();
    expect(edit.created.map((place) => place.name)).toEqual(['Parkingu Pod Krzyżem']);
    const item = edit.doc.items.find((each) => each.ref === 'd5-dojscie-koruldi')!;
    expect(item.leg).toMatchObject({ fromPlaceRef: from!.place.ref, toPlaceRef: 'jeziora-koruldi' });
    expect(item.placeRef).toBe('jeziora-koruldi');
    expect(edit.changed.map((each) => each.ref)).toEqual(['d5-dojscie-koruldi']);
  });

  it('klucz propozycji nie zależy od nowego id', () => {
    const doc = without(gruzja, { 'd2-dojazd-mestia': { from: true } });
    expect(checkLegEnds(doc, () => 'a').proposals.map((each) => each.key)).toEqual(checkLegEnds(doc, () => 'b').proposals.map((each) => each.key));
  });
});
