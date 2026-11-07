import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { routeNameEnds, setTrackEnds, trackEndsNote } from '../track-ends.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const IDS = { fromId: 'nowy-start', toId: 'nowy-koniec' };
const KUTUBIJJA = { ref: 'kutubijja', name: 'Meczet Kutubijja', lat: 31.6237, lng: -7.9937, provider: 'user' as const, links: [] };
const CTM = { ref: 'ctm', name: 'CTM', lat: 31.62, lng: -7.99, provider: 'user' as const, links: [] };
const LINE = [[-7.9937, 31.6237], [-7.992, 31.622], [-7.99, 31.62]];

/** Plan z przejściem pieszym bez końców i podanymi miejscami. */
function walk(places: TripDocument['places'], leg: object = {}, placeRef?: string) {
  const doc = fixture('barcelona');
  const item = doc.items.find((each) => each.leg !== undefined && each.dayRef !== undefined)!;
  const { placeRef: _place, ...rest } = item;
  const next = { ...rest, ...(placeRef !== undefined ? { placeRef } : {}), leg: { mode: 'walk' as const, links: [], ...leg } };
  return { doc: { ...doc, places: [...doc.places, ...places], items: doc.items.map((each) => (each.ref === item.ref ? next : each)) } as TripDocument, ref: item.ref };
}

describe('nazwa eksportu z mapy.com', () => {
  it('rozdziela start i koniec', () => {
    expect(routeNameEnds('Trasa z Kutubijja do CTM')).toEqual({ from: 'Kutubijja', to: 'CTM' });
    expect(routeNameEnds("Trasa z Carrer d'Escudellers 1-3 do Muzeum Picassa w Barcelonie")).toEqual({ from: "Carrer d'Escudellers 1-3", to: 'Muzeum Picassa w Barcelonie' });
    expect(routeNameEnds('Route from Old Town to Castle')).toEqual({ from: 'Old Town', to: 'Castle' });
  });

  it('inna nazwa pliku nic nie daje', () => {
    expect(routeNameEnds('Wycieczka na Dinarę')).toEqual({});
    expect(routeNameEnds(null)).toEqual({});
  });

  it('„do” w nazwie miejsca: wygrywa podział na znane miejsca', () => {
    const places = [{ ref: 'a', name: 'Droga do Lasu', provider: 'unknown', links: [] }, { ref: 'b', name: 'Chatka', provider: 'unknown', links: [] }] as TripDocument['places'];
    expect(routeNameEnds('Trasa z Droga do Lasu do Chatka', places)).toEqual({ from: 'Droga do Lasu', to: 'Chatka' });
  });
});

describe('końce przejścia z pliku GPX', () => {
  it('nazwa z pliku trafia w miejsca planu, także przy innym zapisie', () => {
    const { doc, ref } = walk([KUTUBIJJA, CTM]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Kutubijja do CTM', coordinates: LINE })!;
    const item = edit.doc.items.find((each) => each.ref === ref)!;
    expect(item.leg).toMatchObject({ fromPlaceRef: 'kutubijja', toPlaceRef: 'ctm' });
    expect(item.placeRef).toBe('ctm');
    expect(edit.places).toEqual([]);
    expect(trackEndsNote(edit)).toBe('Start: Meczet Kutubijja. Koniec: CTM.');
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });

  it('nieznana nazwa: nowe miejsce ze współrzędnymi końca śladu', () => {
    const { doc, ref } = walk([]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Kutubijja do CTM', coordinates: LINE })!;
    expect(edit.places.map(({ place, created }) => [place.ref, place.name, place.lat, place.lng, place.provider, created])).toEqual([
      ['id-nowy-start', 'Kutubijja', 31.6237, -7.9937, 'user', true],
      ['id-nowy-koniec', 'CTM', 31.62, -7.99, 'user', true],
    ]);
    expect(trackEndsNote(edit)).toBe('Start: Kutubijja (nowe miejsce). Koniec: CTM (nowe miejsce).');
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });

  it('ta sama nazwa daleko od śladu to inne miejsce', () => {
    const elsewhere = { ...CTM, ref: 'daleko', lat: 33.59, lng: -7.61 };
    const { doc, ref } = walk([elsewhere]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Kutubijja do CTM', coordinates: LINE })!;
    expect(edit.to).toEqual({ name: 'CTM', created: true });
    expect(edit.doc.items.find((each) => each.ref === ref)!.leg!.toPlaceRef).toBe('id-nowy-koniec');
  });

  it('miejsce bez współrzędnych o tej samej nazwie dostaje je ze śladu', () => {
    const { doc, ref } = walk([{ ref: 'ctm', name: 'ctm', provider: 'unknown', links: [] } as TripDocument['places'][number]]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Kutubijja do CTM', coordinates: LINE })!;
    expect(edit.places).toContainEqual({ place: expect.objectContaining({ ref: 'ctm', lat: 31.62, lng: -7.99, provider: 'user' }), created: false });
    expect(edit.doc.places.filter((place) => place.ref === 'ctm')).toHaveLength(1);
  });

  it('plik bez nazwy: tylko miejsce tuż obok, reszta do wskazania', () => {
    const { doc, ref } = walk([{ ...KUTUBIJJA, lat: 31.6238 }]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'moja trasa', coordinates: LINE })!;
    expect(edit.from).toEqual({ name: 'Meczet Kutubijja', created: false });
    expect(edit.missing).toEqual(['to']);
    expect(trackEndsNote(edit)).toContain('Nie rozpoznano końca śladu: wskaż „Dokąd”');
  });

  it('pętla bez nazwy: oba końce w tym samym miejscu', () => {
    const { doc, ref } = walk([KUTUBIJJA]);
    const edit = setTrackEnds(doc, ref, IDS, { name: null, coordinates: [LINE[0]!, LINE[1]!, LINE[0]!] })!;
    expect(edit.doc.items.find((each) => each.ref === ref)!.leg).toMatchObject({ fromPlaceRef: 'kutubijja', toPlaceRef: 'kutubijja' });
  });

  it('pętla z nazwą nowego miejsca nie robi dwóch takich samych', () => {
    const { doc, ref } = walk([]);
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Bazy do Bazy', coordinates: [LINE[0]!, LINE[1]!, LINE[0]!] })!;
    expect(edit.places).toHaveLength(1);
    expect(edit.doc.items.find((each) => each.ref === ref)!.leg).toMatchObject({ fromPlaceRef: 'id-nowy-start', toPlaceRef: 'id-nowy-start' });
  });

  it('ustawiony koniec zostaje, a daleki dostaje ostrzeżenie', () => {
    const { doc, ref } = walk([KUTUBIJJA, { ...CTM, lat: 31.65 }], { fromPlaceRef: 'kutubijja' }, 'ctm');
    const edit = setTrackEnds(doc, ref, IDS, { name: 'Trasa z Innego do Dalszego', coordinates: LINE })!;
    const item = edit.doc.items.find((each) => each.ref === ref)!;
    expect(item.leg!.fromPlaceRef).toBe('kutubijja');
    expect(item.placeRef).toBe('ctm');
    expect(edit.places).toEqual([]);
    expect(edit.far.map((each) => [each.end, each.name])).toEqual([['to', 'CTM']]);
    expect(trackEndsNote(edit)).toMatch(/^Uwaga: „CTM” leży 3,\d km od końca śladu\.$/);
  });

  it('punkt bez odcinka nie ma końców', () => {
    const doc = fixture('barcelona');
    const item = doc.items.find((each) => each.leg === undefined)!;
    expect(setTrackEnds(doc, item.ref, IDS, { name: 'Trasa z A do B', coordinates: LINE })).toBeNull();
  });
});
