import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AiClient } from '@expeditionplan/ai';
import { type PracticalInfo, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { checkSource, mergePractical, practicalContext, practicalInfo, practicalPrompt } from '../practical.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

const draft: PracticalInfo = {
  notes: [{ topic: 'money', kind: 'practical', title: 'Dirhamy', body: 'Dirhama nie kupisz w Polsce.', sourceIndexes: [0, 1] }],
  contacts: [{ name: 'Policja (Maroko)', role: 'emergency', phone: '19' }],
  packing: [
    { category: 'pustynia', title: 'Czołówka', scope: 'personal' },
    { category: 'dokumenty', title: maroko.packing[0]!.title, scope: 'shared' },
  ],
  tasks: [{ kind: 'todo', title: 'Kupić eSIM', daysBefore: 3, priority: 'normal' }],
  sources: [
    { title: 'Polak za granicą — Maroko', url: 'https://www.gov.pl/web/dyplomacja/maroko' },
    { title: 'Martwa strona', url: 'https://example.invalid/nie-ma' },
  ],
};

const fakeFetch = (async (url: string) => (url.includes('invalid') ? Promise.reject(new Error('ENOTFOUND')) : new Response('', { status: 200 }))) as unknown as typeof fetch;

describe('etap 5 — informacje praktyczne', () => {
  it('kontekst dla AI: daty, skład, tryby transportu i to, co plan już ma', () => {
    const context = practicalContext(maroko, null);
    expect(context.dates.start).toBe(maroko.trip.startDate);
    expect(context.travelers.length).toBe(maroko.travelers.length);
    expect(context.transportModes).toContain('rental_car');
    expect(context.alreadyInPlan.packing.length).toBe(maroko.packing.length);
    // Maroko od 20.09.2026 na UTC+0 — fakt z kodu, nie z pamięci modelu.
    expect(context.facts).toMatchObject({ utcOffset: '+0:00', differenceFromHomeMin: -60 });
    expect(context.facts.sun.length).toBeGreaterThan(0);
  });

  it('potrzeba organizatora trafia do promptu, przycięta; pusta nic nie dodaje', () => {
    expect(practicalPrompt(maroko, null, '  jedziemy z 2-latkiem  ')).toContain('Czego szczególnie potrzebuje organizator');
    expect(practicalPrompt(maroko, null, '  jedziemy z 2-latkiem  ')).toContain('\njedziemy z 2-latkiem\n');
    expect(practicalPrompt(maroko, null, 'x'.repeat(900))).not.toContain('x'.repeat(501));
    expect(practicalPrompt(maroko, null, '   ')).toBe(practicalPrompt(maroko, null));
  });

  it('martwe źródła wypadają, indeksy w notatkach się przeliczają', async () => {
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async () => ({ text: JSON.stringify(draft), provider: 'GEMINI', model: 'test' }),
      listModels: async () => [],
    };
    const result = await practicalInfo(maroko, null, { client, fetchImpl: fakeFetch });
    expect(result.sources.map((source) => source.ok)).toEqual([true, false]);
    expect(result.info.sources.map((source) => source.title)).toEqual(['Polak za granicą — Maroko']);
    expect(result.info.notes[0]!.sourceIndexes).toEqual([0]);
  });

  it('HEAD niedozwolony → GET; 404 = martwe', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init.method!);
      return new Response('', { status: init.method === 'HEAD' ? 405 : 200 });
    }) as unknown as typeof fetch;
    expect(await checkSource('https://a.example', fetchImpl)).toMatchObject({ ok: true, status: 200 });
    expect(calls).toEqual(['HEAD', 'GET']);
    expect((await checkSource('https://b.example', (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).ok).toBe(false);
  });

  it('do planu tylko wybrane; duplikat pakowania pominięty; termin względem wyjazdu; dokument poprawny', () => {
    let n = 0;
    const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    const { doc, created } = mergePractical(maroko, draft, { notes: [0], contacts: [0], packing: [0, 1], tasks: [0], sources: [0] }, id, '2026-11-01');
    expect(created.map((entry) => entry.collection)).toEqual(['sources', 'notes', 'contacts', 'packing', 'tasks']);
    expect(doc.packing.length).toBe(maroko.packing.length + 1);
    expect(doc.tasks.at(-1)).toMatchObject({ title: 'Kupić eSIM', due: { kind: 'before_trip', days: 3 }, status: 'open' });
    expect(doc.notes.at(-1)!.body).toContain('Źródła: Polak za granicą — Maroko');
    expect(() => TripDocument.parse(doc)).not.toThrow();
  });
});
