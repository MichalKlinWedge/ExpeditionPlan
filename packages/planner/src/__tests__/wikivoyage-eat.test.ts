import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Eatery, type PlaceMemoryRow, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { eateriesForMeal } from '../meal-eateries.ts';
import { parseListings, plainWikitext, type WikivoyageListing, wikivoyageListings, withTips } from '../wikivoyage-eat.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

const ARTICLE = `==Eat==
{{eatpricerange|Up to €10|€10 - €25|€25 and up}}

===Budget===
====Around the Cathedral====
* {{eat
| name=Conesa Entrepans | alt= | url=http://www.conesaentrepans.com/ | email=
| address=Carrer de la Llibreteria, 1| lat=41.383057 | long=2.177068 | directions=in a corner of the [[Plaça Sant Jaume|square]]
| hours= | price=€5
| lastedit=2022-05-01
| content=Cheap and '''very''' good sandwiches. Always with a lot of people.
}}
===Mid-range===
* {{eat | name=Restaurant Macrobiòtic Zen | address=carr. de Muntaner, 12 | lat=41.384516 | long=2.162645 | directions={{rint|barcelona|metro}}{{station|Universitat|l1}} | content=Vegan restaurant. }}
===Splurge===
* {{listing | type=eat | name=Bez współrzędnych | content=Fine. }}
==Drink==
* {{drink | name=Bar Marsella | lat=41.3786 | long=2.1716 | content=Absinthe since 1820. }}
* {{see | name=Sagrada Família | lat=41.4036 | long=2.1744 }}
`;

describe('polecenia z Wikivoyage', () => {
  it('wpisy eat/drink z przedziałem cen z nagłówka, bez znaczników wiki', () => {
    const listings = parseListings(ARTICLE, 'Barcelona/Ciutat Vella');
    expect(listings.map((each) => [each.name, each.kind, each.tip.tier])).toEqual([
      ['Conesa Entrepans', 'eat', 'budget'],
      ['Restaurant Macrobiòtic Zen', 'eat', 'mid'],
      ['Bez współrzędnych', 'eat', 'splurge'],
      ['Bar Marsella', 'drink', undefined],
    ]);
    expect(listings[0]).toMatchObject({
      lat: 41.383057,
      lng: 2.177068,
      url: 'http://www.conesaentrepans.com/',
      tip: { article: 'Barcelona/Ciutat Vella', url: 'https://en.wikivoyage.org/wiki/Barcelona/Ciutat_Vella', price: '€5', year: 2022, text: 'Cheap and very good sandwiches. Always with a lot of people.' },
    });
    expect(listings[2]!.lat).toBeUndefined();
    expect(plainWikitext("a {{rint|x}}[[Foo|bar]] ''b'' <br/>[http://x.pl strona]")).toBe('a bar b strona');
  });

  it('dopasowanie: ta sama nazwa blisko albo zawarta nazwa; reszta ze współrzędnymi jako nowe knajpy', () => {
    const listings = parseListings(ARTICLE, 'Barcelona/Ciutat Vella');
    const found: Eatery[] = [
      { name: 'Conesa', lat: 41.38306, lng: 2.17707, kind: 'fast_food' }, // „Conesa” ⊂ „Conesa Entrepans”, < 100 m
      { name: 'Bez Wspolrzednych', lat: 41.39, lng: 2.17, kind: 'restaurant' }, // ta sama nazwa, wpis bez współrzędnych
      { name: 'Restaurant Macrobiotic Zen', lat: 41.4, lng: 2.2, kind: 'restaurant' }, // ta sama nazwa, ale 3 km dalej
    ];
    const { eateries, sources } = withTips(found, listings, ['restaurant'], false);
    expect(eateries.map((each) => [each.name, each.tip?.tier])).toEqual([
      ['Conesa', 'budget'],
      ['Bez Wspolrzednych', 'splurge'],
      ['Restaurant Macrobiotic Zen', undefined],
      ['Restaurant Macrobiòtic Zen', 'mid'],
    ]);
    expect(sources).toEqual([{ title: 'Barcelona/Ciutat Vella', url: 'https://en.wikivoyage.org/wiki/Barcelona/Ciutat_Vella' }]);
    // Bar tylko przy rodzaju „pub”/„kawiarnia”; z filtrem diety nowych knajp z przewodnika nie dokładamy.
    expect(withTips([], listings, ['pub'], false).eateries.map((each) => each.name)).toEqual(['Bar Marsella']);
    expect(withTips([], listings, ['restaurant'], true).eateries).toEqual([]);
  });

  it('artykuły w pobliżu, tekst w pamięci podręcznej; wpisy spoza obszaru odpadają', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: URL) => {
      calls.push(url.searchParams.get('list') ?? url.searchParams.get('prop') ?? '');
      if (url.searchParams.get('list') === 'geosearch') return Response.json({ query: { geosearch: [{ title: 'Barcelona/Ciutat Vella' }] } });
      return Response.json({ query: { pages: [{ title: 'Barcelona/Ciutat Vella', revisions: [{ slots: { main: { content: ARTICLE } } }] }] } });
    }) as unknown as typeof fetch;
    const area = { lat: 41.383, lng: 2.177, radiusM: 500 };
    const first = await wikivoyageListings(area, fetchImpl, 1_000);
    expect(first.map((each) => each.name)).toEqual(['Conesa Entrepans', 'Bez współrzędnych', 'Bar Marsella']); // Zen 1,2 km dalej odpada
    await wikivoyageListings(area, fetchImpl, 2_000);
    expect(calls).toEqual(['geosearch', 'revisions', 'geosearch']);
  });

  it('posiłek: polecenie i nasze oceny trafiają do wyników, kolejność według nich', async () => {
    const center = { lat: 31.62583, lng: -7.98892 };
    const tipListing: WikivoyageListing = { name: 'Café Clock', kind: 'eat', lat: center.lat + 0.002, lng: center.lng, tip: { source: 'wikivoyage', article: 'Marrakech', url: 'https://en.wikivoyage.org/wiki/Marrakech', tier: 'mid' } };
    const memory: PlaceMemoryRow = { id: 'm1', user_id: 'u1', author_name: 'Ania', name: 'Nomad', lat: center.lat + 0.001, lng: center.lng, verdict: 'worth', note: 'taras', updated_at: '2026-01-01T00:00:00Z' };
    const keys: string[][] = [];
    const answer = await eateriesForMeal(maroko, 'd1-kolacja', { kinds: ['restaurant'], radiusM: 1000 }, {
      search: async () => [
        { name: 'Blisko', lat: center.lat + 0.0002, lng: center.lng, kind: 'restaurant' },
        { name: 'Nomad', lat: center.lat + 0.001, lng: center.lng, kind: 'restaurant' },
        { name: 'Café Clock', lat: center.lat + 0.002, lng: center.lng, kind: 'restaurant' },
      ],
      tips: async () => [tipListing],
      memories: async (asked) => (keys.push(asked), [memory]),
    });
    if ('error' in answer) throw new Error(answer.error);
    expect(keys).toEqual([['blisko', 'nomad', 'cafe clock']]);
    expect(answer.results.map((each) => each.name)).toEqual(['Nomad', 'Café Clock', 'Blisko']);
    expect(answer.results[0]!.memory).toEqual({ worth: 1, notWorth: 0, notes: ['Ania: taras'] });
    expect(answer.results[1]!.summary).toBe('restauracja · polecane w Wikivoyage (średnio) · 220 m');
    expect(answer.tipSources).toEqual([{ title: 'Marrakech', url: 'https://en.wikivoyage.org/wiki/Marrakech' }]);
    // Wikivoyage albo oceny niedostępne — wyniki i tak są.
    const broken = await eateriesForMeal(maroko, 'd1-kolacja', { kinds: [], radiusM: 1000 }, {
      search: async () => [{ name: 'Blisko', lat: center.lat, lng: center.lng, kind: 'restaurant' }],
      tips: async () => Promise.reject(new Error('503')),
      memories: async () => Promise.reject(new Error('RLS')),
    });
    expect('results' in broken && broken.results.map((each) => each.name)).toEqual(['Blisko']);
  });

  it('posiłek między punktami: szukamy wokół drogi, a odległość to odległość od trasy', async () => {
    const near = { ...maroko, places: maroko.places.map((place) => (place.ref === 'p-agafay' ? { ...place, lat: 31.632, lng: -7.986 } : place)) };
    const calls: { lat: number; lng: number; radiusM: number }[] = [];
    const answer = await eateriesForMeal(near, 'd2-lunch', { kinds: [], radiusM: 200 }, {
      search: async (query) => (calls.push(query), [
        { name: 'Na trasie', lat: 31.629, lng: -7.9875, kind: 'restaurant' },
        { name: 'Z boku', lat: 31.629, lng: -7.995, kind: 'restaurant' },
      ]),
    });
    if ('error' in answer) throw new Error(answer.error);
    expect(answer.route).toEqual({ from: 'Dżami al-Fna', to: near.places.find((place) => place.ref === 'p-agafay')!.name });
    expect(calls[0]!.radiusM).toBeGreaterThan(500);
    expect(answer.results.map((each) => [each.name, each.routeM])).toEqual([['Na trasie', 7]]);
    expect(answer.results[0]!.summary).toContain('10 m od trasy');
  });
});
