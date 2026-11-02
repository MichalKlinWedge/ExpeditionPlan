import type { AiClient } from '@expeditionplan/ai';
import { GuideContent } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { describePlace, findArticle, titleMatch } from '../wiki.ts';

/** Wikipedia w pamięci: odpowiedzi wg parametrów zapytania. */
function fakeWiki(answers: { search?: unknown[]; geo?: unknown[]; extract?: string; images?: unknown[] }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    calls.push(`${url.hostname}:${params.get('generator') ?? params.get('prop')}`);
    const pages =
      params.get('generator') === 'search'
        ? answers.search
        : params.get('generator') === 'geosearch'
          ? answers.geo
          : params.get('generator') === 'images'
            ? answers.images
            : [{ extract: answers.extract ?? '' }];
    return new Response(JSON.stringify({ query: { pages: url.hostname.startsWith('pl.') ? pages : [] } }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const at = { lat: 41.4036, lng: 2.1744 };

describe('przewodnik z Wikipedii', () => {
  it('dopasowanie tytułu bez polskich znaków i wielkości liter', () => {
    expect(titleMatch('Sagrada Família', 'Sagrada Familia')).toBe(1);
    expect(titleMatch('Bunkry del Carmel', 'Bunkers del Carmel')).toBeGreaterThanOrEqual(0.5);
    expect(titleMatch('Obiad', 'Barcelona')).toBe(0);
  });

  it('hasło z wyszukiwania tylko blisko miejsca; daleka imienniczka odpada', async () => {
    const { fetchImpl } = fakeWiki({
      search: [
        { index: 1, title: 'Sagrada Família (film)', fullurl: 'https://pl.wikipedia.org/wiki/film', coordinates: [{ lat: 52.2, lon: 21.0 }] },
        { index: 2, title: 'Sagrada Família', fullurl: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia', coordinates: [{ lat: 41.4036, lon: 2.1744 }] },
      ],
    });
    expect(await findArticle('Sagrada Família', at, 'pl', fetchImpl)).toEqual({ title: 'Sagrada Família', url: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia' });
  });

  it('bez artykułu — nic (bez zgadywania przez AI)', async () => {
    const { fetchImpl } = fakeWiki({ search: [], geo: [] });
    const client: AiClient = { defaultProvider: 'GEMINI', ask: async () => Promise.reject(new Error('AI nie powinno być wołane')), listModels: async () => [] };
    expect(await describePlace({ name: 'Obiad w bocznych uliczkach', kind: 'meal', ...at }, { client, fetchImpl })).toBeNull();
  });

  it('opis AI + zdjęcia z licencją; pliki bez licencji, mapy i ikony odpadają', async () => {
    const { fetchImpl } = fakeWiki({
      search: [{ index: 1, title: 'Sagrada Família', fullurl: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia', coordinates: [{ lat: 41.4036, lon: 2.1744 }] }],
      extract: 'Sagrada Família — bazylika w Barcelonie projektu Antoniego Gaudíego. '.repeat(10),
      images: [
        { title: 'Plik:Sagrada Familia 01.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a.jpg', thumburl: 'https://upload.wikimedia.org/a-960.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg', mime: 'image/jpeg', width: 4000, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Jan Kowalski</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] },
        { title: 'Plik:Mapa Barcelony.png', imageinfo: [{ url: 'https://upload.wikimedia.org/m.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:M.png', mime: 'image/png', width: 2000, extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
        { title: 'Plik:Bez licencji.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/b.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:B.jpg', mime: 'image/jpeg', width: 3000, extmetadata: {} }] },
      ],
    });
    let prompt = '';
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async (request) => {
        prompt = JSON.stringify(request);
        return { text: JSON.stringify({ summary: 'Bazylika Gaudíego.', facts: ['Budowa trwa od 1882 roku.'], tips: [] }), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    const guide = await describePlace({ name: 'Sagrada Família', kind: 'visit', ...at }, { client, fetchImpl });
    expect(GuideContent.parse(guide)).toBeTruthy();
    expect(prompt).toContain('WYŁĄCZNIE z tekstu artykułu');
    expect(guide!.article).toEqual({ title: 'Sagrada Família', url: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia', lang: 'pl' });
    expect(guide!.images).toEqual([
      {
        url: 'https://upload.wikimedia.org/a.jpg',
        thumbUrl: 'https://upload.wikimedia.org/a-960.jpg',
        title: 'Sagrada Familia 01',
        author: 'Jan Kowalski',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
      },
    ]);
  });
});
