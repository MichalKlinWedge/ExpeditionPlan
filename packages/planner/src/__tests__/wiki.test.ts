import type { AiClient } from '@expeditionplan/ai';
import { GuideContent } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { articleImages, checkSuggestion, commonsImages, coreName, describeFromPage, describePlace, findArticle, type GuideLibrary, titleMatch, wikiArticleOf, wikidataArticles } from '../wiki.ts';

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

describe('inne źródła opisu', () => {
  const near = { lat: 42.9, lng: 43.0 };
  const wikidata = (search: unknown[], entities: Record<string, unknown>) =>
    (async (input: URL | string) => {
      const params = new URL(String(input)).searchParams;
      return new Response(JSON.stringify(params.get('action') === 'wbsearchentities' ? { search } : { entities }));
    }) as typeof fetch;
  const coords = (latitude: number, longitude: number) => ({ P625: [{ mainsnak: { datavalue: { value: { latitude, longitude } } } }] });

  it('hasło bez współrzędnych z obcymi słowami w tytule nie jest artykułem o miejscu', async () => {
    const search = (pages: unknown[]) => fakeWiki({ search: pages, geo: [] }).fetchImpl;
    const page = (title: string) => ({ index: 1, title, fullurl: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title)}` });
    expect(await findArticle('El Born', near, 'pl', search([page('Cupra Born')]))).toBeNull();
    expect(await findArticle('Paradise Valley', near, 'pl', search([page('Paradise Valley (album)')]))).toBeNull();
    expect(await findArticle('Sasin', near, 'pl', search([page('Sasin')]), 'Sasin', { coordsOnly: true })).toBeNull();
    expect((await findArticle('Muzeum Swanetii', near, 'pl', search([page('Muzeum Swanetii')])))?.title).toBe('Muzeum Swanetii');
  });

  it('AI dostaje prawdziwe artykuły przy pinezce i tylko wtedy, gdy nazwa nic nie dała', async () => {
    const prompts: string[] = [];
    const fetchImpl = (async (input: URL | string) => {
      const url = new URL(String(input));
      const nearby = url.hostname === 'en.wikipedia.org' && url.searchParams.get('list') === 'geosearch';
      return new Response(JSON.stringify({ query: nearby ? { geosearch: [{ title: 'Shkhara' }] } : { pages: [] } }));
    }) as typeof fetch;
    const client = {
      ask: async (prompt: string) => {
        prompts.push(prompt);
        return { text: JSON.stringify({ candidates: [] }) };
      },
    } as unknown as AiClient;
    expect(await describePlace({ name: 'Lodowiec Szchara', kind: 'visit', ...near }, { client, fetchImpl })).toBeNull();
    expect(prompts[0]).toContain('en: Shkhara');
    prompts.length = 0;
    await describePlace({ name: 'Lodowiec Szchara', kind: 'visit', near }, { client, fetchImpl });
    expect(prompts[0]).not.toContain('Shkhara');
  });

  it('przeciążony model przy podpowiedziach to błąd, a nie „nie znalazłem”', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ query: { pages: [] } }))) as typeof fetch;
    const overloaded = {
      ask: async () => {
        throw new Error('Model jest przeciążony');
      },
    } as unknown as AiClient;
    await expect(describePlace({ name: 'Lodowiec Szchara', kind: 'visit', ...near }, { client: overloaded, fetchImpl })).rejects.toThrow('przeciążony');
    const nonsense = { ask: async () => ({ text: 'to nie JSON' }) } as unknown as AiClient;
    expect(await describePlace({ name: 'Lodowiec Szchara', kind: 'visit', ...near }, { client: nonsense, fetchImpl })).toBeNull();
  });

  it('nazwa bez dopisków z planu', () => {
    expect(coreName('Dinara (1831 m n.p.m.)')).toBe('Dinara');
    expect(coreName('MNAC — schody i tarasy')).toBe('MNAC');
    expect(coreName('Arenas de Barcelona (dawna arena byków) — dach')).toBe('Arenas de Barcelona');
    expect(coreName('Bielsko-Biała')).toBe('Bielsko-Biała');
    expect(coreName('(bez nazwy)')).toBe('(bez nazwy)');
  });

  it('Wikidane: artykuły w dowolnym języku, Wikipedia przed Wikivoyage, bez wiki botów i innych projektów', async () => {
    const articles = await wikidataArticles(
      'Uszguli',
      near,
      wikidata([{ id: 'Q1', label: 'Ushguli', match: { text: 'Uszguli' } }], {
        Q1: {
          claims: coords(42.91, 43.01),
          sitelinks: {
            kawiki: { title: 'უშგული', url: 'https://ka.wikipedia.org/wiki/A' },
            enwikivoyage: { title: 'Ushguli', url: 'https://en.wikivoyage.org/wiki/Ushguli' },
            frwiki: { title: 'Ouchgouli', url: 'https://fr.wikipedia.org/wiki/Ouchgouli' },
            cebwiki: { title: 'Ushguli', url: 'https://ceb.wikipedia.org/wiki/Ushguli' },
            commonswiki: { title: 'Category:Ushguli', url: 'https://commons.wikimedia.org/wiki/Category:Ushguli' },
            enwikiquote: { title: 'Ushguli', url: 'https://en.wikiquote.org/wiki/Ushguli' },
          },
        },
      }),
    );
    expect(articles.map((each) => `${each.site}:${each.lang}`)).toEqual(['wikipedia:fr', 'wikipedia:ka', 'wikivoyage:en']);
  });

  it('Wikidane: po angielsku szuka polskiej nazwy w zapisie angielskim', async () => {
    const searched: (string | null)[] = [];
    const fetchImpl = (async (input: URL | string) => {
      const params = new URL(String(input)).searchParams;
      searched.push(params.get('search'));
      return new Response(JSON.stringify({ search: [] }));
    }) as typeof fetch;
    await wikidataArticles('Uszguli', near, fetchImpl);
    expect(searched).toEqual(['Uszguli', 'Ushguli']);
  });

  it('Wikidane: daleka imienniczka, hasło bez współrzędnych i inna nazwa odpadają', async () => {
    const link = { sitelinks: { enwiki: { title: 'X', url: 'https://en.wikipedia.org/wiki/X' } } };
    const far = wikidata([{ id: 'Q1', label: 'Uszguli' }], { Q1: { claims: coords(10, 10), ...link } });
    expect(await wikidataArticles('Uszguli', near, far)).toEqual([]);
    const noCoords = wikidata([{ id: 'Q1', label: 'Uszguli' }], { Q1: { claims: {}, ...link } });
    expect(await wikidataArticles('Uszguli', near, noCoords)).toEqual([]);
    const other = wikidata([{ id: 'Q1', label: 'Tbilisi' }], { Q1: { claims: coords(42.9, 43), ...link } });
    expect(await wikidataArticles('Uszguli', near, other)).toEqual([]);
  });

  it('opis z miejsca bez artykułu pod polską nazwą powstaje z artykułu znalezionego przez Wikidane', async () => {
    const fetchImpl = (async (input: URL | string) => {
      const url = new URL(String(input));
      const params = url.searchParams;
      if (url.hostname === 'www.wikidata.org') {
        return new Response(JSON.stringify(params.get('action') === 'wbsearchentities' ? { search: [{ id: 'Q1', label: 'Uszguli' }] } : { entities: { Q1: { claims: coords(42.9, 43), sitelinks: { frwiki: { title: 'Ouchgouli', url: 'https://fr.wikipedia.org/wiki/Ouchgouli' } } } } }));
      }
      if (url.hostname === 'fr.wikipedia.org' && params.get('prop') === 'extracts') return new Response(JSON.stringify({ query: { pages: [{ extract: 'Tekst. '.repeat(100) }] } }));
      return new Response(JSON.stringify({ query: { pages: [] } }));
    }) as typeof fetch;
    const client = { ask: async () => ({ text: JSON.stringify({ summary: 'Opis.', facts: [], tips: [] }) }) } as unknown as AiClient;
    const guide = await describePlace({ name: 'Uszguli', kind: 'visit', ...near }, { client, fetchImpl });
    expect(guide?.article).toEqual({ title: 'Ouchgouli', url: 'https://fr.wikipedia.org/wiki/Ouchgouli', lang: 'fr', site: 'wikipedia' });
  });

  it('adres artykułu: tylko Wikipedia i Wikivoyage, z tytułem i językiem', () => {
    expect(wikiArticleOf('https://hr.wikipedia.org/wiki/Dinara_(planina)?x=1')).toEqual({ lang: 'hr', site: 'wikipedia', title: 'Dinara (planina)' });
    expect(wikiArticleOf('https://en.m.wikivoyage.org/wiki/Svaneti')).toEqual({ lang: 'en', site: 'wikivoyage', title: 'Svaneti' });
    expect(wikiArticleOf('https://en.wikipedia.org.example.com/wiki/A')).toBeNull();
    expect(wikiArticleOf('https://example.com/wiki/A')).toBeNull();
  });

  it('strona wskazana przez użytkownika: źródło „web”, bez zdjęć, a za krótki tekst nie daje opisu', async () => {
    const client = { ask: async () => ({ text: JSON.stringify({ summary: 'Opis.', facts: [], tips: [] }) }) } as unknown as AiClient;
    const noFetch = (async () => {
      throw new Error('bez pobierania');
    }) as typeof fetch;
    const place = { name: 'Chatka', kind: 'visit' };
    const guide = await describeFromPage(place, { url: 'https://www.parknarodowy.pl/chatka', text: 'Tekst o chatce. '.repeat(30) }, { client, fetchImpl: noFetch });
    expect(guide).toMatchObject({ images: [], article: { title: 'parknarodowy.pl', url: 'https://www.parknarodowy.pl/chatka', site: 'web' } });
    expect(GuideContent.safeParse(guide).success).toBe(true);
    expect(await describeFromPage(place, { url: 'https://www.parknarodowy.pl/chatka', text: 'Mało.' }, { client, fetchImpl: noFetch })).toBeNull();
  });
});

describe('zdjęcia do wyboru', () => {
  const file = (name: string, index: number, license: string | undefined = 'CC BY-SA 4.0') => ({
    title: `File:${name}.jpg`,
    index,
    imageinfo: [{ url: `https://upload.wikimedia.org/${name}.jpg`, thumburl: `https://upload.wikimedia.org/thumb/${name}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`, mime: 'image/jpeg', width: 2000, extmetadata: license ? { LicenseShortName: { value: license } } : {} }],
  });

  it('Commons: szuka bitmap wśród plików, w kolejności trafności, tylko z licencją i bez map', async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (input: URL | string) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify({ query: { pages: [file('Drugie', 2), file('Bez_licencji', 3, ''), file('Mapa_miasta', 4), file('Pierwsze', 1)] } }));
    }) as typeof fetch;
    const images = await commonsImages('Sagrada Família', 24, fetchImpl);
    expect(images.map((image) => image.title)).toEqual(['Pierwsze', 'Drugie']);
    expect(urls[0]!.hostname).toBe('commons.wikimedia.org');
    expect(urls[0]!.searchParams.get('gsrsearch')).toBe('Sagrada Família filetype:bitmap');
    expect(urls[0]!.searchParams.get('gsrnamespace')).toBe('6');
  });

  it('artykuł: limit decyduje, ile zdjęć wraca', async () => {
    const { fetchImpl } = fakeWiki({ images: [file('A', 1), file('B', 2), file('C', 3)] });
    expect(await articleImages('Sagrada Família', 'pl', 2, fetchImpl)).toHaveLength(2);
  });
});

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
