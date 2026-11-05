import type { AiClient } from '@expeditionplan/ai';
import { GuideContent } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { checkSuggestion, describePlace, findArticle, type GuideLibrary, titleMatch } from '../wiki.ts';

/** Wikipedia w pamięci: odpowiedzi wg parametrów zapytania. */
function fakeWiki(answers: { search?: unknown[]; geo?: unknown[]; extract?: string; images?: unknown[]; pages?: Record<string, unknown> }) {
  const calls: string[] = [];
  const searches: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    calls.push(`${url.hostname}:${params.get('generator') ?? params.get('prop')}`);
    if (params.get('gsrsearch') !== null) searches.push(params.get('gsrsearch')!);
    const pages =
      params.get('generator') === 'search'
        ? answers.search
        : params.get('generator') === 'geosearch'
          ? answers.geo
          : params.get('generator') === 'images'
            ? answers.images
            : params.get('prop')?.includes('pageprops')
              ? [answers.pages?.[`${url.hostname}:${params.get('titles')}`] ?? { title: params.get('titles'), missing: true }]
              : [{ extract: answers.extract ?? '' }];
    // Wyszukiwanie i geosearch tylko w pl.wikipedia; strony z podpowiedzi — na każdym hoście z `pages`.
    const known = url.hostname.startsWith('pl.') || params.get('prop')?.includes('pageprops') || params.get('prop') === 'extracts';
    return new Response(JSON.stringify({ query: { pages: known ? pages : [] } }));
  }) as typeof fetch;
  return { fetchImpl, calls, searches };
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

  it('strona ujednoznaczniająca nie jest artykułem o miejscu', async () => {
    const { fetchImpl } = fakeWiki({
      search: [
        { index: 1, title: 'Kryniczno', fullurl: 'https://pl.wikipedia.org/wiki/Kryniczno', pageprops: { disambiguation: '' } },
        { index: 2, title: 'Kryniczno (powiat trzebnicki)', fullurl: 'https://pl.wikipedia.org/wiki/Kryniczno_(powiat_trzebnicki)', coordinates: [{ lat: 51.21, lon: 17.04 }] },
      ],
    });
    expect((await findArticle('Kryniczno', { lat: 51.20771, lng: 17.0396 }, 'pl', fetchImpl))?.title).toBe('Kryniczno (powiat trzebnicki)');
  });

  it('wskazanie, które to miejsce: szukanie z tym tekstem, pinezka u imienniczki nie przeszkadza, tekst zostaje w opisie', async () => {
    const { fetchImpl, searches } = fakeWiki({
      search: [{ index: 1, title: 'Kryniczno (powiat średzki)', fullurl: 'https://pl.wikipedia.org/wiki/Kryniczno_(powiat_%C5%9Bredzki)', coordinates: [{ lat: 51.03, lon: 16.63 }] }],
      extract: 'Wieś w Polsce. '.repeat(30),
      images: [],
    });
    const prompts: string[] = [];
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async (prompt: string) => {
        prompts.push(prompt);
        return { text: JSON.stringify({ summary: 'Wieś.', facts: [], tips: [] }), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    const pinnedElsewhere = { lat: 51.20771, lng: 17.0396 };
    const content = await describePlace({ name: 'Kryniczno', kind: 'visit', ...pinnedElsewhere, which: 'powiat średzki' }, { client, fetchImpl });
    expect(searches[0]).toBe('Kryniczno powiat średzki');
    expect(content?.article.title).toBe('Kryniczno (powiat średzki)');
    expect(content?.hint).toBe('powiat średzki');
    expect(prompts[0]).toContain('Chodzi dokładnie o: „powiat średzki”');
  });

  it('wskazanie miejsca w sprawdzaniu podpowiedzi: pinezka u imienniczki nie odrzuca artykułu', async () => {
    const { fetchImpl } = fakeWiki({
      pages: { 'pl.wikipedia.org:Kryniczno (powiat średzki)': { title: 'Kryniczno (powiat średzki)', fullurl: 'https://pl.wikipedia.org/wiki/K', coordinates: [{ lat: 51.03, lon: 16.63 }] } },
    });
    const candidate = { site: 'wikipedia', lang: 'pl', title: 'Kryniczno (powiat średzki)' } as const;
    const place = { name: 'Kryniczno', kind: 'visit', lat: 51.20771, lng: 17.0396 };
    expect(await checkSuggestion(candidate, place, fetchImpl)).toBeNull();
    expect((await checkSuggestion(candidate, { ...place, which: 'powiat średzki' }, fetchImpl))?.title).toBe('Kryniczno (powiat średzki)');
  });

  it('bez artykułu — nic: podpowiedź AI bez pokrycia nie daje opisu', async () => {
    const { fetchImpl } = fakeWiki({ search: [], geo: [] });
    let calls = 0;
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async () => {
        calls++;
        // Pierwsze wołanie to podpowiedź tytułów; opis nie może powstać bez artykułu.
        if (calls > 1) throw new Error('AI nie powinno pisać opisu bez artykułu');
        return { text: JSON.stringify({ candidates: [{ site: 'wikipedia', lang: 'pl', title: 'Nie ma takiego hasła' }] }), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    expect(await describePlace({ name: 'Obiad w bocznych uliczkach', kind: 'meal', ...at }, { client, fetchImpl })).toBeNull();
    expect(calls).toBe(1);
  });

  it('podpowiedź AI sprawdza kod: blisko miejsca tak, daleko i ujednoznacznienie nie', async () => {
    const souks = { lat: 31.6295, lng: -7.9881 };
    const { fetchImpl } = fakeWiki({
      pages: {
        'en.wikipedia.org:Medina of Marrakesh': { title: 'Medina of Marrakesh', fullurl: 'https://en.wikipedia.org/wiki/Medina_of_Marrakesh', coordinates: [{ lat: 31.631, lon: -7.987 }] },
        'en.wikipedia.org:Marrakesh': { title: 'Marrakesh', fullurl: 'https://en.wikipedia.org/wiki/Marrakesh', coordinates: [{ lat: 31.66, lon: -8.03 }] },
        'pl.wikipedia.org:Suk': { title: 'Suk', fullurl: 'https://pl.wikipedia.org/wiki/Suk', pageprops: { disambiguation: '' } },
        'pl.wikivoyage.org:Marrakesz': { title: 'Marrakesz', fullurl: 'https://pl.wikivoyage.org/wiki/Marrakesz', coordinates: [{ lat: 31.63, lon: -7.99 }] },
      },
    });
    const place = { name: 'Suki Marakeszu', kind: 'visit', ...souks };
    expect(await checkSuggestion({ site: 'wikipedia', lang: 'en', title: 'Medina of Marrakesh' }, place, fetchImpl)).toEqual({ title: 'Medina of Marrakesh', url: 'https://en.wikipedia.org/wiki/Medina_of_Marrakesh' });
    // Centrum miasta ok. 6 km dalej — za daleko jak na „to miejsce”.
    expect(await checkSuggestion({ site: 'wikipedia', lang: 'en', title: 'Marrakesh' }, place, fetchImpl)).toBeNull();
    expect(await checkSuggestion({ site: 'wikipedia', lang: 'pl', title: 'Suk' }, place, fetchImpl)).toBeNull();
    expect(await checkSuggestion({ site: 'wikipedia', lang: 'pl', title: 'Nie ma' }, place, fetchImpl)).toBeNull();
    // Bez współrzędnych miejsca: okolica bazy dnia, promień 25 km.
    expect(await checkSuggestion({ site: 'wikivoyage', lang: 'pl', title: 'Marrakesz' }, { name: 'Suki', kind: 'visit', near: souks }, fetchImpl)).toEqual({
      title: 'Marrakesz',
      url: 'https://pl.wikivoyage.org/wiki/Marrakesz',
    });
  });

  it('wskazówka organizatora: od razu podpowiedzi AI, artykuł bez współrzędnych albo w regionie, wskazówka w promptach i w opisie', async () => {
    const parking = { lat: 31.63, lng: -7.99 };
    const { fetchImpl, calls } = fakeWiki({
      extract: 'Autostrada A7 — płatna autostrada w Maroku z Casablanki do Agadiru, bramki, opłaty gotówką i kartą. '.repeat(5),
      pages: {
        'en.wikipedia.org:A7 motorway (Morocco)': { title: 'A7 motorway (Morocco)', fullurl: 'https://en.wikipedia.org/wiki/A7_motorway_(Morocco)' },
        'pl.wikipedia.org:Tanger': { title: 'Tanger', fullurl: 'https://pl.wikipedia.org/wiki/Tanger', coordinates: [{ lat: 35.77, lon: -5.8 }] },
      },
    });
    const hint = 'opłaty na A7: bramki, czym płacić';
    const place = { name: 'Autostradą A7 na północ', kind: 'transport', ...parking, hint };
    // Ponad 300 km od miejsca — nawet ze wskazówką to już nie ten region.
    expect(await checkSuggestion({ site: 'wikipedia', lang: 'pl', title: 'Tanger' }, place, fetchImpl)).toBeNull();

    const prompts: string[] = [];
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async (request) => {
        prompts.push(JSON.stringify(request));
        const text = prompts.length === 1 ? { candidates: [{ site: 'wikipedia', lang: 'en', title: 'A7 motorway (Morocco)' }] } : { summary: 'Płatna autostrada.', facts: [], tips: ['Bramki przyjmują gotówkę.'] };
        return { text: JSON.stringify(text), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    const guide = await describePlace(place, { client, fetchImpl });
    expect(calls.filter((call) => call.endsWith('search'))).toEqual([]);
    expect(prompts[0]).toContain(hint);
    expect(prompts[1]).toContain('przede wszystkim');
    expect(guide).toMatchObject({ hint, article: { title: 'A7 motorway (Morocco)', site: 'wikipedia', lang: 'en' } });
  });

  it('artykuł o innej nazwie niż miejsce omija bibliotekę: opis pisany pod to miejsce nie pasowałby innym', async () => {
    const { fetchImpl } = fakeWiki({
      search: [],
      geo: [],
      extract: 'Sagrada Família — bazylika w Barcelonie, wieża Narodzenia. '.repeat(10),
      pages: { 'pl.wikipedia.org:Sagrada Família': { title: 'Sagrada Família', fullurl: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia', coordinates: [{ lat: 41.4036, lon: 2.1744 }] } },
    });
    let asked = 0;
    const client: AiClient = {
      defaultProvider: 'GEMINI',
      ask: async () => {
        asked++;
        const text = asked === 1 ? { candidates: [{ site: 'wikipedia', lang: 'pl', title: 'Sagrada Família' }] } : { summary: 'Wieża bazyliki.', facts: [], tips: [] };
        return { text: JSON.stringify(text), provider: 'GEMINI', model: 'test' };
      },
      listModels: async () => [],
    };
    const used: string[] = [];
    const library: GuideLibrary = { find: async () => (used.push('find'), null), save: async () => void used.push('save') };
    const guide = await describePlace({ name: 'Wieża Narodzenia', kind: 'visit', lat: 41.4036, lng: 2.1744 }, { client, fetchImpl, library });
    expect(guide?.article.title).toBe('Sagrada Família');
    expect(used).toEqual([]);
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
    expect(guide!.article).toEqual({ title: 'Sagrada Família', url: 'https://pl.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia', lang: 'pl', site: 'wikipedia' });

    // Biblioteka: gotowy opis bez AI, nowy zapisany, a odświeżenie i wskazówka idą własną drogą.
    let aiCalls = 0;
    const counting: AiClient = { ...client, ask: async (request) => (aiCalls++, client.ask(request)) };
    const saved: GuideContent[] = [];
    const looked: string[] = [];
    const library = (ready: GuideContent | null): GuideLibrary => ({
      find: async (article) => (looked.push(`${article.site}:${article.lang}:${article.title}`), ready),
      save: async (content) => void saved.push(content),
    });
    const sagrada = { name: 'Sagrada Família', kind: 'visit', ...at };

    expect(await describePlace(sagrada, { client: counting, fetchImpl, library: library(guide) })).toBe(guide);
    expect(aiCalls).toBe(0);
    expect(looked).toEqual(['wikipedia:pl:Sagrada Família']);
    expect(saved).toEqual([]);

    await describePlace(sagrada, { client: counting, fetchImpl, library: library(null) });
    expect(aiCalls).toBe(1);
    expect(saved).toHaveLength(1);

    looked.length = 0;
    await describePlace(sagrada, { client: counting, fetchImpl, library: library(guide), fresh: true });
    expect(aiCalls).toBe(2);
    expect(looked).toEqual([]);
    expect(saved).toHaveLength(2);

    await describePlace({ ...sagrada, which: 'kościół w Barcelonie' }, { client: counting, fetchImpl, library: library(guide) });
    expect(looked).toEqual([]);
    expect(saved).toHaveLength(2);

    // Awaria biblioteki: opis powstaje zwykłą drogą.
    await describePlace(sagrada, { client: counting, fetchImpl, library: { find: async () => { throw new Error('brak tabeli'); }, save: async () => { throw new Error('brak tabeli'); } } });
    expect(aiCalls).toBe(4);
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
