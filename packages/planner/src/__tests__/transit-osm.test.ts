import { describe, expect, it } from 'vitest';

import { bboxAround, fetchOsmRoutes, overpassQuery, parseOverpass } from '../transit-osm.ts';

const RESPONSE = {
  elements: [
    {
      type: 'relation',
      id: 7,
      tags: { type: 'route', route: 'subway', ref: 'L3', name: 'L3: Trinitat Nova => Zona Universitària' },
      members: [
        { type: 'node', ref: 1, role: 'stop', lat: 41.376, lon: 2.175 },
        { type: 'node', ref: 2, role: 'platform', lat: 41.3761, lon: 2.1751 },
        { type: 'way', ref: 10, role: '', geometry: [{ lat: 41.376, lon: 2.175 }, { lat: 41.38, lon: 2.16 }] },
        { type: 'way', ref: 11, role: 'platform', geometry: [{ lat: 41.38, lon: 2.16 }, { lat: 41.381, lon: 2.161 }] },
        { type: 'node', ref: 3, role: 'stop', lat: 41.385, lon: 2.12 },
      ],
    },
    { type: 'relation', id: 8, tags: { type: 'route', route: 'bus' }, members: [] },
    { type: 'relation', id: 9, tags: { type: 'route', route: 'train', name: 'L1 Liberec - Szklarska Poręba' }, members: [{ type: 'way', ref: 12, role: '', geometry: [{ lat: 50.83, lon: 15.48 }, { lat: 50.82, lon: 15.41 }] }] },
    { type: 'node', id: 1, lat: 41.376, lon: 2.175, tags: { name: 'Drassanes' } },
    { type: 'node', id: 2, lat: 41.3761, lon: 2.1751, tags: { name: 'Drassanes' } },
    { type: 'node', id: 3, lat: 41.385, lon: 2.12, tags: { name: 'Palau Reial' } },
  ],
};

describe('relacje linii z Overpass', () => {
  it('drogi bez peronów, przystanek i peron jako jeden przystanek; relacja bez dróg odpada, bez numeru i przystanków zostaje', () => {
    expect(parseOverpass(RESPONSE)).toEqual([
      { id: 7, ref: 'L3', route: 'subway', ways: [[[2.175, 41.376], [2.16, 41.38]]], stops: [{ name: 'Drassanes', at: [2.175, 41.376] }, { name: 'Palau Reial', at: [2.12, 41.385] }] },
      { id: 9, ref: '', route: 'train', ways: [[[15.48, 50.83], [15.41, 50.82]]], stops: [] },
    ]);
  });

  it('bez numerów: wszystkie relacje torów w prostokącie', () => {
    const query = overpassQuery([], bboxAround([[15.48, 50.83]]), ['train', 'railway']);
    expect(query).toContain('rel[type=route][route~"^(train|railway)$"](');
    expect(query).not.toContain('ref~');
  });

  it('zapytanie: numery po początku, z ucieczką znaków, w prostokącie z zapasem', () => {
    const bbox = bboxAround([[2.17, 41.38], [2.11, 41.39]], 1);
    expect(bbox.south).toBeCloseTo(41.371, 3);
    expect(bbox.north).toBeCloseTo(41.399, 3);
    const query = overpassQuery(['R2 Nord', 'L3', 'C.1'], bbox);
    expect(query).toContain(String.raw`[ref~"^(R2|L3|C\\.1)",i]`);
    expect(query).toContain('node(r.lines);');
  });

  it('identyfikujący User-Agent, a zajęty serwer to czytelny błąd', async () => {
    let headers: unknown;
    const ok = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers;
      return new Response(JSON.stringify(RESPONSE), { status: 200 });
    }) as typeof fetch;
    expect(await fetchOsmRoutes(['L3'], bboxAround([[2.17, 41.38]]), { fetchImpl: ok })).toHaveLength(2);
    expect((headers as Record<string, string>)['User-Agent']).toMatch(/^ExpeditionPlan\//);
    const busy = (async () => new Response('', { status: 429 })) as typeof fetch;
    await expect(fetchOsmRoutes(['L3'], bboxAround([[2.17, 41.38]]), { fetchImpl: busy })).rejects.toThrow('zajęty');
    expect(await fetchOsmRoutes([], bboxAround([[2.17, 41.38]]), { fetchImpl: busy })).toEqual([]);
  });
});
