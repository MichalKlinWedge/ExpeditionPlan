import type { TrackLine } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { fetchTrackPois, trackPoiQuery } from '../track-osm.ts';

const line: TrackLine = {
  type: 'LineString',
  coordinates: Array.from({ length: 50 }, (_, i) => [19.95, 49.25 - i * 0.0009, 1000 + i * 10] as [number, number, number]),
};

describe('woda, schroniska i zejścia z Overpass', () => {
  it('zapytanie: pas wokół linii (lat,lon), środki obrysów', () => {
    const query = trackPoiQuery([
      [19.95, 49.25],
      [19.95, 49.21],
    ]);
    expect(query).toContain('node[natural=spring](around:300,49.25000,19.95000,49.21000,19.95000);');
    expect(query).toMatch(/\[bbox:49\.18\d+,19\.9\d+,49\.27\d+,19\.98\d+\]/);
    expect(query).toContain('out center tags qt;');
  });

  it('jedno zapytanie POST z User-Agent; obrys schroniska liczy się środkiem', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init!);
      return new Response(
        JSON.stringify({
          elements: [
            { type: 'node', id: 1, lat: 49.241, lon: 19.951, tags: { natural: 'spring' } },
            { type: 'way', id: 2, center: { lat: 49.23, lon: 19.952 }, tags: { tourism: 'alpine_hut', name: 'Hala' } },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const pois = await fetchTrackPois(line, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect((calls[0]!.headers as Record<string, string>)['User-Agent']).toMatch(/^ExpeditionPlan\//);
    expect(pois.map((poi) => [poi.osmId, poi.kind])).toEqual([
      ['node/1', 'water'],
      ['way/2', 'shelter'],
    ]);
  });

  it('przeciążony serwer: polski komunikat', async () => {
    const fetchImpl = (async () => new Response('', { status: 429 })) as typeof fetch;
    await expect(fetchTrackPois(line, { fetchImpl })).rejects.toThrow(/zajęty/);
  });
});

describe('Overpass nie zdążył', () => {
  it('uwaga o przekroczonym czasie to błąd, a nie pusta lista', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 2 after 46 seconds.' }), { status: 200 })) as typeof fetch;
    await expect(fetchTrackPois(line, { fetchImpl })).rejects.toThrow(/nie zdążył/);
  });
});
