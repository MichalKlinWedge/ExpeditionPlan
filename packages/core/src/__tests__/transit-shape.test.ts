import { describe, expect, it } from 'vitest';

import { decodePolyline, type LngLat } from '../polyline.ts';
import { applyTransitShape, chainWays, type OsmRoute, sameLine, sameStop, segmentLine, transitRefs, transitShape, transitShapeRequest } from '../transit-shape.ts';

// Linia na wschód wzdłuż równika: przystanki A (0,0) – B (0,01) – C (0,02) – D (0,03); drogi zapisane w różnych kierunkach.
const east: OsmRoute = {
  id: 1,
  ref: 'L3',
  route: 'subway',
  ways: [
    [[0, 0], [0.005, 0], [0.01, 0]],
    [[0.02, 0], [0.015, 0], [0.01, 0]],
    [[0.02, 0], [0.03, 0]],
  ],
  stops: [
    { name: 'Estació de Drassanes', at: [0, 0.0005] },
    { name: 'Paral·lel', at: [0.01, 0.0005] },
    { name: 'Espanya', at: [0.02, 0.0005] },
    { name: 'Palau Reial (L3)', at: [0.03, 0.0005] },
  ],
};
const west: OsmRoute = { ...east, id: 2, ways: [...east.ways].reverse().map((way) => [...way].reverse()), stops: [...east.stops].reverse() };

describe('linia komunikacji z OpenStreetMap', () => {
  it('nazwy przystanków i numery linii mimo dopisków', () => {
    expect(sameStop('Drassanes', 'Estació de Drassanes')).toBe(true);
    expect(sameStop('Palau Reial', 'Palau Reial (L3)')).toBe(true);
    expect(sameStop('Sants', 'Sants Estació')).toBe(true);
    expect(sameStop('Espanya', 'Paral·lel')).toBe(false);
    expect(sameLine('R2 Nord', 'R2N')).toBe(true);
    expect(sameLine('l3', 'L3')).toBe(true);
    expect(sameLine('L1', 'L10')).toBe(false);
  });

  it('drogi pod prąd składają się w jedną linię', () => {
    expect(chainWays(east.ways)).toEqual([[0, 0], [0.005, 0], [0.01, 0], [0.015, 0], [0.02, 0], [0.03, 0]]);
  });

  it('kawałek między przystankami, z relacji jadącej we właściwą stronę', () => {
    const line = segmentLine([west, east], { mode: 'metro', line: 'L3', from: 'Paral·lel', to: 'Palau Reial' }) as LngLat[];
    expect(line[0]).toEqual([0.01, 0.0005]);
    expect(line.at(-1)).toEqual([0.03, 0.0005]);
    expect(line.slice(1, -1)).toEqual([[0.01, 0], [0.015, 0], [0.02, 0], [0.03, 0]]);
  });

  it('inny środek, inna linia albo nieznany przystanek — brak, z powodem', () => {
    expect(segmentLine([east], { mode: 'bus', line: 'L3', from: 'Paral·lel', to: 'Espanya' })).toBe('line');
    expect(segmentLine([east], { mode: 'metro', line: 'L5', from: 'Paral·lel', to: 'Espanya' })).toBe('line');
    expect(segmentLine([east], { mode: 'metro', line: 'L3', from: 'Paral·lel', to: 'Sagrada Família' })).toBe('stops');
  });

  it('bez „skąd” wsiada na przystanku najbliżej poprzedniego punktu', () => {
    const line = segmentLine([east], { mode: 'metro', line: 'L3', to: 'Espanya' }, [0.0101, 0.001]) as LngLat[];
    expect(line[0]).toEqual([0.01, 0.0005]);
  });

  it('przetłumaczona nazwa przystanku: najbliższy przystanek przy znanym miejscu', () => {
    const line = segmentLine([east], { mode: 'metro', line: 'L3', from: 'Stacja Drassanes', to: 'Pałac Królewski' }, [0.0003, 0.0008], [0.0302, 0.001]) as LngLat[];
    expect(line[0]).toEqual([0, 0.0005]);
    expect(line.at(-1)).toEqual([0.03, 0.0005]);
    expect(segmentLine([east], { mode: 'metro', line: 'L3', from: 'Stacja Drassanes', to: 'Pałac Królewski' }, [0.0003, 0.0008], [0.05, 0.001])).toBe('stops');
  });

  it('cały przejazd: start, linia z OSM, koniec; bez trafienia — null', () => {
    const start: LngLat = [-0.002, 0.001];
    const end: LngLat = [0.031, 0.002];
    const segments = [
      { mode: 'walk' as const, to: 'Drassanes' },
      { mode: 'metro' as const, line: 'L3', from: 'Drassanes', to: 'Palau Reial' },
      { mode: 'bus' as const, line: 'H12', from: 'Palau Reial', to: 'Gornal' },
    ];
    const { shape: found, misses } = transitShape(segments, start, end, [east]);
    const shape = found!;
    expect(misses).toEqual([{ line: 'H12', why: 'line' }]);
    expect(shape).toMatchObject({ matched: 1, total: 2 });
    const points = decodePolyline(shape.geometry);
    expect(points[0]).toEqual(start);
    expect(points.at(-1)).toEqual(end);
    expect(transitShape(segments.slice(2), start, end, [east]).shape).toBeNull();
    expect(transitRefs(segments)).toEqual(['L3', 'H12']);
  });
});

describe('linia w przejeździe z planu', () => {
  const doc = {
    places: [
      { ref: 'a', name: 'Nocleg', lat: 0.001, lng: -0.002, provider: 'user', links: [] },
      { ref: 'b', name: 'Stadion', lat: 0.002, lng: 0.031, provider: 'user', links: [] },
    ],
    items: [
      { ref: 'm', kind: 'transport', title: 'Metro', variantRefs: [], notes: [], links: [], leg: { mode: 'metro', fromPlaceRef: 'a', toPlaceRef: 'b', links: [], segments: [{ mode: 'metro', line: 'L3', from: 'Drassanes', to: 'Palau Reial' }] } },
      { ref: 'c', kind: 'transport', title: 'Auto', variantRefs: [], notes: [], links: [], leg: { mode: 'car', fromPlaceRef: 'a', toPlaceRef: 'b', links: [] } },
    ],
    days: [],
    tracks: [],
  } as unknown as Parameters<typeof applyTransitShape>[0];

  it('prośba o linie z końcami przejazdu; nie dla auta', () => {
    expect(transitShapeRequest(doc, doc.items[0]!)).toEqual({ refs: ['L3'], start: [-0.002, 0.001], end: [0.031, 0.002] });
    expect(transitShapeRequest(doc, doc.items[1]!)).toBeNull();
  });

  it('zapis linii, a bez trafienia w OSM stara linia znika', () => {
    const drawn = applyTransitShape(doc, 'm', [east])!;
    expect(drawn.shape?.matched).toBe(1);
    expect(drawn.item.leg?.geometry).toBe(drawn.shape?.geometry);
    const missed = applyTransitShape(drawn.doc, 'm', [])!;
    expect(missed.shape).toBeNull();
    expect(missed.item.leg?.geometry).toBeUndefined();
  });
});
