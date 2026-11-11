import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AiClient } from '@expeditionplan/ai';
import { applyExtraPicks, corridorQueryLines, dayCorridor, dayLodging, extraCandidates, scheduleDay, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { dayExtrasPrompt, dayExtrasQuery, fetchDayAttractions, pickDayExtras } from '../day-extras.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
/** Dzień z przejazdem autem i miejscami na mapie. */
const day = maroko.days.find((each) => {
  const corridor = dayCorridor(maroko, scheduleDay(maroko, each.ref).items.map((item) => item.ref), dayLodging(maroko, each.ref)?.placeRef);
  return corridor.paths.some((path) => path.mode === 'car') && corridor.spots.length > 1;
})!;
const refs = scheduleDay(maroko, day.ref).items.map((item) => item.ref);
const corridor = dayCorridor(maroko, refs, dayLodging(maroko, day.ref)?.placeRef);

describe('po drodze i w pobliżu — OSM i AI', () => {
  it('zapytanie: pasy 700 m i 2 km po liniach korytarza, w prostokącie dnia, z limitem wyników', () => {
    const query = dayExtrasQuery(corridorQueryLines(corridor));
    expect(query).toMatch(/^\[out:json\]\[timeout:60\]\[maxsize:\d+\]\[bbox:[\d.,-]+\];/);
    expect(query).toContain('(around:700,');
    expect(query).toContain('(around:2000,');
    expect(query).toContain('out center tags qt 600;');
  });

  it('zapytanie: miasta po drodze długiego przejazdu, tylko trasa, podane miasto po nazwie', () => {
    const lines = { near: [[[20, 50], [20.01, 50]]] as [number, number][][], car: [[[20, 50], [21, 50]]] as [number, number][][], long: [[[20, 50], [21, 50]]] as [number, number][][] };
    const day = dayExtrasQuery(lines);
    expect(day).toContain('node[place=city](around:12000,');
    expect(day).toContain('(around.towns:3000);');
    expect(day).toContain('.towns out tags qt 60;');
    const route = dayExtrasQuery(lines, { scope: 'route' });
    expect(route).not.toContain('(around:700,');
    expect(route).toContain('(around:2000,');
    const city = dayExtrasQuery(lines, { scope: 'city', city: 'Bratysława' });
    expect(city).toContain('[~"^name(:pl|:en)?$"~"^Bratysława$",i]');
    expect(city).not.toContain('(around:2000,');
    expect(dayExtrasQuery(lines, { scope: 'city', city: 'St. "X"' })).toContain('^St\\\\. \\\\"X\\\\"$');
  });

  it('Overpass: element z obrysem daje środek; przeciążenie to polski błąd', async () => {
    const reply = { elements: [{ type: 'way', id: 7, center: { lat: 31.1, lon: -7.9 }, tags: { name: 'Kasba', historic: 'castle' } }] };
    let body = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify(reply));
    }) as typeof fetch;
    expect(await fetchDayAttractions(corridor, { fetchImpl })).toEqual([{ id: 'way/7', lat: 31.1, lng: -7.9, tags: { name: 'Kasba', historic: 'castle' } }]);
    expect(decodeURIComponent(body)).toContain('around:');
    const busy = (async () => new Response('', { status: 429 })) as typeof fetch;
    await expect(fetchDayAttractions(corridor, { fetchImpl: busy })).rejects.toThrow(/zajęty/);
  });

  it('AI dostaje plan dnia z godzinami i kandydatów; wybiera tylko z listy', async () => {
    const at = corridor.spots[0]!;
    const candidates = extraCandidates(maroko, corridor, [{ id: 'node/1', lat: at.lat + 0.002, lng: at.lng, tags: { name: 'Punkt widokowy X', tourism: 'viewpoint' } }]);
    const viewpoint = candidates.find((each) => each.id === 'node/1')!;
    expect(viewpoint).toBeDefined();
    const prompt = dayExtrasPrompt(maroko, day.ref, {}, candidates);
    expect(prompt).toContain('"id": "node/1"');
    expect(prompt).toContain(`"ref": "${refs[0]}"`);
    let seen = '';
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async (text) => {
        seen = text;
        return { text: JSON.stringify({ picks: [{ id: 'node/1', title: 'Punkt widokowy X', why: 'Widok na dolinę.', stayMin: 10, fit: 'stop', swapRef: null, weather: 'outdoor' }] }), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    const picks = await pickDayExtras(maroko, day.ref, {}, candidates, { client });
    expect(seen).toContain('Wybieraj tylko z listy');
    const next = applyExtraPicks(maroko, day.ref, candidates, picks, '2026-11-11')!;
    expect(next.extras!.items).toEqual([expect.objectContaining({ id: 'node/1', stayMin: 10, fit: 'stop', weather: 'outdoor' })]);
    expect(TripDocument.safeParse({ ...maroko, days: maroko.days.map((each) => (each.ref === day.ref ? next : each)) }).success).toBe(true);
  });
});
