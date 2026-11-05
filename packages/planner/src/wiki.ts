import { type AiClient, type AiUsage, AiValidationError, askStructured } from '@expeditionplan/ai';
import { type GuideContent, GuideDraft, type GuideImage } from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Przewodnik po miejscu z Wikipedii albo Wikivoyage (SPECYFIKACJA M8): artykuł znaleziony po nazwie
 * i współrzędnych, a gdy to nie wystarcza — tytuły podpowiedziane przez AI, sprawdzone przez kod
 * (artykuł istnieje, nie jest ujednoznacznieniem, leży przy miejscu). Zdjęcia z Commons z licencją
 * i autorem, streszczenie przez AI wyłącznie z tekstu artykułu.
 * Gdy wyszukiwanie po nazwie nie trafia, Wikidane prowadzą do artykułu w dowolnym języku, a na końcu zostaje strona wskazana przez użytkownika.
 * Wikimedia API: identyfikujący User-Agent, zapytania po kolei (bez równoległych serii).
 * Tekst artykułu: CC BY-SA 4.0 — opis pochodny ma tę licencję i link do artykułu.
 */

const UA = 'ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)';
const MAX_TEXT = 12_000;

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

export type WikiSite = 'wikipedia' | 'wikivoyage';
export type WikiArticle = { title: string; url: string; lang: string; site: WikiSite; text: string };
type Fetch = typeof fetch;

async function queryHost(host: string, params: Record<string, string>, fetchImpl: Fetch): Promise<Record<string, unknown>> {
  const url = new URL(`https://${host}/w/api.php`);
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value);
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${host}: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

const api = (lang: string, params: Record<string, string>, fetchImpl: Fetch, site: WikiSite = 'wikipedia') => queryHost(`${lang}.${site}.org`, params, fetchImpl);

type Page = { title: string; fullurl?: string; coordinates?: { lat: number; lon: number }[]; missing?: boolean; pageprops?: { disambiguation?: string } };

/** Nazwa bez dopisków z planu: „Dinara (1831 m n.p.m.)”, „MNAC — schody i tarasy”. */
export function coreName(name: string): string {
  const core = name.replace(/\s*\([^)]*\)/g, ' ').split(/\s+[—–-]\s+/)[0]!.replace(/\s+/g, ' ').trim();
  return core === '' ? name : core;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

/** Odległość edycyjna ≤ 1 (literówka, inna transkrypcja: „Fna” / „Fana”). */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const tail = (x: string, skip: number) => x.slice(i + skip);
  return tail(a, 1) === tail(b, 1) || tail(a, 1) === tail(b, 0) || tail(a, 0) === tail(b, 1);
}

/** Ile słów nazwy jest w tytule (0–1), z tolerancją jednej litery. */
export function titleMatch(name: string, title: string): number {
  const wanted = words(name);
  if (wanted.length === 0) return 0;
  const have = words(title);
  return wanted.filter((word) => have.some((each) => nearlySame(word, each))).length / wanted.length;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * Artykuł o miejscu: wyszukiwanie po nazwie (przy współrzędnych — tylko hasła w promieniu 15 km
 * albo bez współrzędnych, ale z pasującym tytułem), a gdy nic — najbliższe hasło w promieniu 1 km
 * z większością słów nazwy w tytule („Twierdza Szybenik” nie dostanie artykułu o mieście). Strona ujednoznaczniająca
 * nigdy nie jest artykułem o miejscu. `query` zastępuje nazwę w wyszukiwaniu, tytuł dalej porównuje się z nazwą. `null` = nie ma pewnego dopasowania.
 * Hasło bez współrzędnych musi też nie mieć w tytule słów spoza nazwy („El Born” to nie „Cupra Born”), a gdy miejsce ma pinezkę, liczy się cały tytuł z dopiskiem („Paradise Valley (album)”).
 * `coordsOnly`: tylko hasła ze współrzędnymi przy miejscu, dla nazwy skróconej przez `coreName` („Sasin (Kohlberg)” to nie „Jacek Sasin”).
 */
export async function findArticle(name: string, at: { lat: number; lng: number } | null, lang: string, fetchImpl: Fetch = fetch, query = name, { site = 'wikipedia', coordsOnly = false }: { site?: WikiSite; coordsOnly?: boolean } = {}): Promise<{ title: string; url: string } | null> {
  const found = await api(lang, { generator: 'search', gsrsearch: query, gsrlimit: '6', prop: 'coordinates|info|pageprops', inprop: 'url', ppprop: 'disambiguation' }, fetchImpl, site);
  const pages = (((found.query as { pages?: Page[] } | undefined)?.pages ?? []) as (Page & { index?: number })[]).filter((page) => page.pageprops?.disambiguation === undefined).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const near = pages.find((page) => {
    const where = page.coordinates?.[0];
    if (at !== null && where !== undefined) return km(at, where) <= 15 && titleMatch(name, page.title) >= 0.6;
    if (coordsOnly) return false;
    return titleMatch(name, page.title) >= 0.75 && titleMatch(at === null ? coreName(page.title) : page.title, name) >= 0.75;
  });
  if (near?.fullurl) return { title: near.title, url: near.fullurl };
  if (at === null) return null;
  const geo = await api(lang, { generator: 'geosearch', ggscoord: `${at.lat}|${at.lng}`, ggsradius: '1000', ggslimit: '10', prop: 'info', inprop: 'url' }, fetchImpl, site);
  const close = ((geo.query as { pages?: Page[] } | undefined)?.pages ?? []).filter((page) => titleMatch(name, page.title) >= 0.6).sort((a, b) => titleMatch(name, b.title) - titleMatch(name, a.title))[0];
  return close?.fullurl ? { title: close.title, url: close.fullurl } : null;
}

/** Wikipedie pisane głównie przez boty: artykuły z baz, bez treści do opisu. */
const BOT_WIKIS = new Set(['ceb', 'war', 'arz']);
const WIKI_ORDER = ['pl', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt'];
const wikiRank = (lang: string) => (WIKI_ORDER.includes(lang) ? WIKI_ORDER.indexOf(lang) : WIKI_ORDER.length);

type WikidataEntity = { claims?: { P625?: { mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } } }[] }; sitelinks?: Record<string, { title: string; url?: string }> };

/**
 * Artykuły o miejscu przez Wikidane: hasło znajduje się po nazwie albo aliasie w każdej transkrypcji („Uszguli” / „Ushguli”), a jego linki
 * prowadzą do artykułów w dowolnym języku. Obiekt musi mieć współrzędne (film ani osoba ich nie mają), a przy znanym miejscu leżeć do 15 km od niego.
 * Kolejność: Wikipedie od najbardziej znanych języków, potem Wikivoyage.
 */
export async function wikidataArticles(name: string, at: { lat: number; lng: number } | null, fetchImpl: Fetch = fetch): Promise<{ site: WikiSite; lang: string; title: string; url: string }[]> {
  const scores = new Map<string, number>();
  // Polskie „Uszguli” to w innych językach „Ushguli”.
  const english = name.replace(/sz/gi, 'sh').replace(/cz/gi, 'ch').replace(/ż/gi, 'zh');
  for (const [search, language] of [[name, 'pl'], [english, 'en']] as const) {
    const data = await queryHost('www.wikidata.org', { action: 'wbsearchentities', search, language, uselang: language, type: 'item', limit: '7' }, fetchImpl);
    for (const hit of (data.search ?? []) as { id: string; label?: string; match?: { text?: string } }[]) {
      const score = Math.max(titleMatch(name, hit.label ?? ''), titleMatch(name, hit.match?.text ?? ''));
      if (score >= (at === null ? 0.75 : 0.6) && !scores.has(hit.id)) scores.set(hit.id, score);
    }
  }
  if (scores.size === 0) return [];
  const data = await queryHost('www.wikidata.org', { action: 'wbgetentities', ids: [...scores.keys()].join('|'), props: 'claims|sitelinks/urls' }, fetchImpl);
  const entities = (data.entities ?? {}) as Record<string, WikidataEntity>;
  const articles: { site: WikiSite; lang: string; title: string; url: string }[] = [];
  for (const id of scores.keys()) {
    const entity = entities[id];
    const where = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (where?.latitude === undefined || where.longitude === undefined) continue;
    if (at !== null && km(at, { lat: where.latitude, lon: where.longitude }) > 15) continue;
    for (const [key, link] of Object.entries(entity?.sitelinks ?? {})) {
      const parts = /^([a-z]{2,3})wiki(voyage)?$/.exec(key);
      if (parts === null || link.url === undefined || BOT_WIKIS.has(parts[1]!)) continue;
      articles.push({ site: parts[2] ? 'wikivoyage' : 'wikipedia', lang: parts[1]!, title: link.title, url: link.url });
    }
    if (articles.length > 0) break;
  }
  return articles.sort((a, b) => Number(a.site === 'wikivoyage') - Number(b.site === 'wikivoyage') || wikiRank(a.lang) - wikiRank(b.lang));
}

export async function articleText(title: string, lang: string, fetchImpl: Fetch = fetch, site: WikiSite = 'wikipedia'): Promise<string> {
  const data = await api(lang, { prop: 'extracts', explaintext: '1', exsectionformat: 'plain', titles: title, redirects: '1' }, fetchImpl, site);
  const page = ((data.query as { pages?: { extract?: string }[] } | undefined)?.pages ?? [])[0];
  return (page?.extract ?? '').slice(0, MAX_TEXT);
}

const SKIP_IMAGE = /flag|logo|icon|ikona|herb|coat_of_arms|locator|location|map|mapa|plan|diagram|signature|podpis|commons-logo|wiki/i;
const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

type ImagePage = { title: string; index?: number; imageinfo?: { url: string; thumburl?: string; descriptionurl: string; mime: string; width: number; extmetadata?: Record<string, { value: string } | undefined> }[] };

const IMAGE_INFO = { prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName' };

/** Zdjęcia z artykułu (pliki Commons): JPEG/PNG, bez flag, map i herbów, z licencją i autorem. */
export async function articleImages(title: string, lang: string, limit = 4, fetchImpl: Fetch = fetch, site: WikiSite = 'wikipedia'): Promise<GuideImage[]> {
  const data = await api(lang, { generator: 'images', titles: title, gimlimit: '40', redirects: '1', ...IMAGE_INFO }, fetchImpl, site);
  return imagesFrom((data.query as { pages?: ImagePage[] } | undefined)?.pages ?? [], limit);
}

/** Wyszukiwanie zdjęć w Wikimedia Commons, w kolejności trafności: wybór zdjęcia do opisu, z tymi samymi warunkami co zdjęcia z artykułu. */
export async function commonsImages(query: string, limit = 24, fetchImpl: Fetch = fetch): Promise<GuideImage[]> {
  const data = await queryHost('commons.wikimedia.org', { generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '40', ...IMAGE_INFO }, fetchImpl);
  const pages = (data.query as { pages?: ImagePage[] } | undefined)?.pages ?? [];
  return imagesFrom([...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)), limit);
}

function imagesFrom(found: ImagePage[], limit: number): GuideImage[] {
  const pages = found.filter((page) => !SKIP_IMAGE.test(page.title));
  const images: GuideImage[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (info === undefined || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 500) continue;
    const meta = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value;
    // Bez licencji w metadanych nie pokazujemy (nie wiadomo, jak podpisać).
    const name = stripHtml(meta.ObjectName?.value ?? page.title.replace(/^(File|Plik):/, '').replace(/\.[a-z]+$/i, ''));
    if (!license || images.some((each) => each.url === info.url || each.title === name)) continue;
    images.push({
      url: info.url,
      thumbUrl: info.thumburl ?? info.url,
      title: name,
      author: meta.Artist?.value ? stripHtml(meta.Artist.value).slice(0, 120) : undefined,
      license,
      licenseUrl: meta.LicenseUrl?.value?.startsWith('http') ? meta.LicenseUrl.value : undefined,
      sourceUrl: info.descriptionurl,
    });
    if (images.length >= limit) break;
  }
  return images;
}

export function guidePrompt(place: { name: string; kind: string; hint?: string; which?: string }, article: Omit<WikiArticle, 'site'> & { site: WikiSite | 'web' }): string {
  return [
    `Przygotuj krótki przewodnik po miejscu „${place.name}” (${place.kind}) dla rodziny zwiedzającej je podczas wyjazdu.`,
    ...(place.which ? [`Chodzi dokładnie o: „${place.which}”. Gdy artykuł wspomina inne miejsca o tej nazwie, pisz tylko o tym.`] : []),
    ...(place.hint
      ? [
          '',
          `Organizator chce się z opisu dowiedzieć przede wszystkim: „${place.hint}”. Skup się na tym w summary, facts i tips; resztę skróć.`,
          'Ceny, opłaty i sposób płatności podawaj tylko wtedy, gdy są w artykule (z jego zastrzeżeniami, np. „w 2020 r.”) — wbrew zasadzie 5. Czego artykuł nie mówi — pomiń, nie zgaduj.',
        ]
      : []),
    '',
    'Zasady:',
    '1. Korzystaj WYŁĄCZNIE z tekstu artykułu poniżej. Nie dodawaj faktów, dat ani liczb spoza niego. Gdy artykuł czegoś nie mówi — pomiń to.',
    '2. `summary`: 2–3 zdania, czym jest to miejsce i dlaczego warto je zobaczyć.',
    '3. `facts`: 3–8 ciekawostek, każda jednym zdaniem — zaskakujące, konkretne, takie, które chce się opowiedzieć na miejscu (także dzieciom).',
    '4. `history`: najważniejsze w historii miejsca, do 5 zdań; pomiń, gdy artykuł jej nie ma.',
    '5. `tips`: tylko wskazówki wynikające z artykułu (np. co obejrzeć w środku); bez godzin otwarcia i cen.',
    '6. Po polsku, prostym językiem, bez wstępów typu „Artykuł mówi”.',
    ...(article.site === 'web' ? ['7. To tekst z cudzej strony: pisz własnymi słowami, bez cytatów. Pomiń reklamy, oferty i wszystko, co nie dotyczy tego miejsca.'] : []),
    '',
    'JSON Schema odpowiedzi:',
    schemaOf(GuideDraft),
    '',
    article.site === 'web' ? `Tekst ze strony ${article.url}:` : `Artykuł „${article.title}” (${article.lang}.${article.site}.org):`,
    article.text,
  ].join('\n');
}

/** Co wiadomo o punkcie poza nazwą miejsca — dla podpowiedzi tytułów. */
export type PlaceQuery = {
  name: string;
  kind: string;
  lat?: number;
  lng?: number;
  /** Baza dnia — okolica dla miejsc bez współrzędnych. */
  near?: { lat: number; lng: number };
  context?: { itemTitle?: string; description?: string; area?: string; trip?: string };
  /** Wskazówka organizatora: o czym ma być opis („opłaty i bramki na A7”) — ma pierwszeństwo przed nazwą miejsca. */
  hint?: string;
  /** Które dokładnie miejsce, gdy wiele nosi tę nazwę („wieś w powiecie trzebnickim”); ma pierwszeństwo przed pinezką, która może stać u imienniczki. */
  which?: string;
};

const Suggestions = z.object({
  candidates: z
    // Język trafia do adresu API, więc tylko kod języka.
    .array(z.object({ site: z.enum(['wikipedia', 'wikivoyage']), lang: z.string().regex(/^[a-z]{2,3}$/), title: z.string().min(1) }))
    .max(6)
    .describe('istniejące artykuły, od najlepszego; pusto, gdy nie znasz żadnego'),
});

/** Artykuły do 1 km od pinezki, w polskiej i angielskiej Wikipedii. Dalej w mieście to już inne atrakcje. */
async function nearbyArticles(at: { lat: number; lng: number }, fetchImpl: Fetch): Promise<{ lang: string; title: string }[]> {
  const found: { lang: string; title: string }[] = [];
  for (const lang of ['pl', 'en']) {
    const data = await api(lang, { list: 'geosearch', gscoord: `${at.lat}|${at.lng}`, gsradius: '1000', gslimit: '10' }, fetchImpl).catch(() => null);
    for (const each of ((data?.query as { geosearch?: { title: string }[] } | undefined)?.geosearch ?? [])) found.push({ lang, title: each.title });
  }
  return found;
}

export function suggestPrompt(place: PlaceQuery, nearby: { lang: string; title: string }[] = []): string {
  return [
    ...(place.hint
      ? [
          `Podaj tytuły ISTNIEJĄCYCH artykułów w Wikipedii albo Wikivoyage (polskich, angielskich albo w języku kraju, w którym leży miejsce), które najlepiej odpowiadają na to, czego chce organizator: „${place.hint}” — w kontekście punktu planu poniżej.`,
          'Wskazówka ma pierwszeństwo przed nazwą miejsca (np. dla przejazdu autostradą — artykuł o tej autostradzie albo o jeździe autem w tym kraju, nie o parkingu na końcu). Może to być artykuł o drodze, regionie czy kraju, jeśli to on odpowiada na wskazówkę.',
        ]
      : [
          'Podaj tytuły ISTNIEJĄCYCH artykułów w Wikipedii albo Wikivoyage (polskich, angielskich albo w języku kraju, w którym leży miejsce), które opisują to miejsce.',
          'Gdy samo miejsce nie ma artykułu, podaj artykuł o obiekcie, którego naprawdę jest częścią (np. medyna dla suków, park narodowy dla szlaku w nim) — ale nie o sąsiednim obiekcie, całym mieście ani kraju. Lepsza pusta lista niż opis czegoś innego.',
          ...(place.which ? [`Tę nazwę może nosić wiele miejsc. Organizator wskazał, o które chodzi: „${place.which}”. Podaj artykuły tylko o tym jednym.`] : []),
        ]),
    'Tytuł dokładnie tak, jak w Wikipedii/Wikivoyage. Nie zgaduj: kod sprawdzi, czy artykuł istnieje i leży przy miejscu, a zły tytuł tylko kosztuje. Gdy nie znasz żadnego — pusta lista.',
    '',
    ...(nearby.length > 0 ? ['', 'Artykuły w Wikipedii leżące do 1 km od tego miejsca. Podaj taki tylko wtedy, gdy opisuje właśnie to miejsce, choćby pod inną nazwą albo w innym języku (site: wikipedia). Sąsiedni park, muzeum czy inna atrakcja to nie to miejsce; wtedy pomiń listę:', nearby.map((each) => `${each.lang}: ${each.title}`).join('\n')] : []),
    '',
    'JSON Schema odpowiedzi (każdy kandydat to obiekt z `site`, `lang` = kod języka, np. pl, en, hr, `title`):',
    schemaOf(Suggestions),
    '',
    'Miejsce:',
    JSON.stringify({ ...(place.hint ? { wskazowka: place.hint } : {}), ...(place.which ? { ktore_dokladnie: place.which } : {}), miejsce: place.name, rodzaj: place.kind, punkt: place.context?.itemTitle, opis: place.context?.description?.slice(0, 400), okolica: place.context?.area, wyjazd: place.context?.trip }),
  ].join('\n');
}

/**
 * Sprawdzenie podpowiedzi: artykuł istnieje, nie jest ujednoznacznieniem i ma współrzędne w promieniu
 * od miejsca (3 km) albo od bazy dnia (25 km). Bez punktu odniesienia — tylko przy pasującym tytule.
 * Ze wskazówką organizatora temat wskazał człowiek, a źródło widać przy opisie: wystarczy artykuł bez
 * współrzędnych (droga, „jazda autem w Maroku”) albo w promieniu 300 km (ten sam region). Tak samo po wskazaniu,
 * które to miejsce: pinezka może stać u imienniczki.
 */
export async function checkSuggestion(
  candidate: { site: WikiSite; lang: string; title: string },
  place: PlaceQuery,
  fetchImpl: Fetch = fetch,
): Promise<{ title: string; url: string } | null> {
  const data = await api(candidate.lang, { titles: candidate.title, redirects: '1', prop: 'coordinates|info|pageprops', inprop: 'url', ppprop: 'disambiguation' }, fetchImpl, candidate.site);
  const page = ((data.query as { pages?: Page[] } | undefined)?.pages ?? [])[0];
  if (page === undefined || page.missing || page.pageprops?.disambiguation !== undefined || !page.fullurl) return null;
  const where = page.coordinates?.[0];
  const exact = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : null;
  const origin = exact ?? place.near ?? null;
  if (place.hint || place.which) return where === undefined || origin === null || km(origin, where) <= 300 ? { title: page.title, url: page.fullurl } : null;
  if (origin === null) return titleMatch(place.name, page.title) >= 0.75 ? { title: page.title, url: page.fullurl } : null;
  if (where === undefined || km(origin, where) > (exact ? 3 : 25)) return null;
  return { title: page.title, url: page.fullurl };
}

/** Wspólna biblioteka opisów: gotowy przewodnik po artykule, żeby ten sam artykuł nie szedł do AI w każdym wyjeździe. */
export type GuideLibrary = {
  find: (article: { site: WikiSite; lang: string; title: string }) => Promise<GuideContent | null>;
  save: (content: GuideContent) => Promise<void>;
};

/** Od tej zgodności nazwy z tytułem artykuł opisuje to miejsce, a nie obiekt, którego jest częścią. */
const LIBRARY_MATCH = 0.75;

export type GuideDeps = {
  client: AiClient;
  timeoutMs?: number;
  onUsage?: (usage: AiUsage) => void;
  fetchImpl?: Fetch;
  library?: GuideLibrary;
  /** Odświeżenie: nowy opis z AI zamiast gotowego z biblioteki. */
  fresh?: boolean;
};

/**
 * Przewodnik po miejscu: artykuł w polskiej Wikipedii, potem w angielskiej (po nazwie, a potem po nazwie bez dopisków z planu), potem przez
 * Wikidane w dowolnym języku, potem Wikivoyage; gdy żaden nie pasuje — tytuły podpowiedziane przez AI, każdy sprawdzony przez `checkSuggestion`.
 * Ze wskazówką organizatora (`hint`) od razu podpowiedzi AI — nazwa miejsca może prowadzić gdzie indziej.
 * Ze wskazaniem miejsca (`which`) wyszukiwanie po nazwie i tym tekście, bez pinezki; zostaje ono w `hint` opisu do odświeżenia.
 * Opis zawsze po polsku. `null` = brak artykułu, którego dopasowanie jest pewne.
 * Biblioteka (`deps.library`) działa tylko bez wskazówek i tylko gdy artykuł nosi nazwę miejsca: opis pisany pod
 * „suk w medynie” z artykułu o medynie nie pasowałby innemu miejscu z tym artykułem. Jej błąd nie psuje opisu.
 */
export async function describePlace(place: PlaceQuery, deps: GuideDeps): Promise<GuideContent | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ai = { system: SYSTEM, timeoutMs: deps.timeoutMs ?? 60_000, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}) };
  const at = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : (place.near ?? null);
  const exact = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : null;
  const core = coreName(place.name);
  const shortened = core !== place.name;
  const withText = async (found: { title: string; url: string }, lang: string, site: WikiSite): Promise<WikiArticle | null> => {
    const text = await articleText(found.title, lang, fetchImpl, site);
    return text.length < 300 ? null : { title: found.title, url: found.url, lang, site, text };
  };
  let article: WikiArticle | null = null;
  for (const lang of place.hint ? [] : ['pl', 'en']) {
    const found = await findArticle(place.name, place.which ? null : at, lang, fetchImpl, place.which ? `${place.name} ${place.which}` : place.name);
    if (found !== null) article = await withText(found, lang, 'wikipedia');
    if (article === null && shortened && at !== null && !place.which) {
      const short = await findArticle(core, at, lang, fetchImpl, core, { coordsOnly: true });
      if (short !== null) article = await withText(short, lang, 'wikipedia');
    }
    if (article !== null) break;
  }
  // Wikidane nie znają doprecyzowania `which`, a bez punktu odniesienia nie da się sprawdzić, czy to to miejsce. Ich błąd to brak kandydatów, nie błąd opisu.
  if (article === null && !place.hint && !place.which && at !== null) {
    for (const candidate of (await wikidataArticles(core, at, fetchImpl).catch(() => [])).slice(0, 5)) {
      article = await withText(candidate, candidate.lang, candidate.site).catch(() => null);
      if (article !== null) break;
    }
  }
  for (const lang of article !== null || place.hint ? [] : ['pl', 'en']) {
    const found = await findArticle(core, place.which ? null : at, lang, fetchImpl, place.which ? `${core} ${place.which}` : core, { site: 'wikivoyage', coordsOnly: shortened && !place.which && at !== null }).catch(() => null);
    if (found !== null) article = await withText(found, lang, 'wikivoyage').catch(() => null);
    if (article !== null) break;
  }
  if (article === null) {
    // Prawdziwe artykuły przy pinezce: nazwa z planu bywa tłumaczeniem, a model wskazuje wtedy tytuł z listy, zamiast zgadywać z pamięci.
    const nearby = exact === null || place.hint || place.which ? [] : await nearbyArticles(exact, fetchImpl);
    // Zła odpowiedź modelu = brak kandydatów, a przeciążony model to błąd do pokazania: „nie znalazłem” byłoby nieprawdą.
    const suggested = await askStructured(deps.client, Suggestions, suggestPrompt(place, nearby), { ...ai, maxTokens: 600, label: `artykuły ${place.name}` }).catch((e: unknown) => {
      if (e instanceof AiValidationError) return null;
      throw e;
    });
    for (const candidate of suggested?.data.candidates ?? []) {
      const found = await checkSuggestion(candidate, place, fetchImpl).catch(() => null);
      if (found === null) continue;
      article = await withText(found, candidate.lang, candidate.site);
      if (article !== null) break;
    }
  }
  if (article === null) return null;
  const library = !place.hint && !place.which && titleMatch(place.name, article.title) >= LIBRARY_MATCH ? deps.library : undefined;
  if (library !== undefined && !deps.fresh) {
    const ready = await library.find({ site: article.site, lang: article.lang, title: article.title }).catch(() => null);
    if (ready !== null) return ready;
  }
  const answer = await askStructured(deps.client, GuideDraft, guidePrompt(place, article), { ...ai, maxTokens: 3000, label: `przewodnik ${place.name}` });
  const images = await articleImages(article.title, article.lang, 4, fetchImpl, article.site).catch(() => []);
  const content: GuideContent = { ...answer.data, images, article: { title: article.title, url: article.url, lang: article.lang, site: article.site }, ...(place.hint || place.which ? { hint: place.hint ?? place.which } : {}) };
  await library?.save(content).catch(() => undefined);
  return content;
}

/** Artykuł Wikipedii albo Wikivoyage po adresie strony; inny adres = `null`. */
export function wikiArticleOf(address: string): { site: WikiSite; lang: string; title: string } | null {
  const parts = /^https?:\/\/([a-z]{2,3})(?:\.m)?\.(wikipedia|wikivoyage)\.org\/wiki\/([^?#]+)/.exec(address);
  if (parts === null) return null;
  try {
    return { lang: parts[1]!, site: parts[2] as WikiSite, title: decodeURIComponent(parts[3]!).replace(/_/g, ' ') };
  } catch {
    return null;
  }
}

/**
 * Przewodnik ze źródła wskazanego przez użytkownika, gdy automat nic nie znalazł. Link do Wikipedii albo Wikivoyage to zwykły artykuł (ze zdjęciami i licencją),
 * a inna strona to `text` pobrany albo wklejony: własne streszczenie z linkiem do niej, bez zdjęć (te wybiera się z Commons). Sam tekst nie jest zapisywany. `null` = za mało treści.
 */
export async function describeFromPage(place: PlaceQuery, source: { url: string; text?: string }, deps: Pick<GuideDeps, 'client' | 'timeoutMs' | 'onUsage' | 'fetchImpl'>): Promise<GuideContent | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ai = { system: SYSTEM, timeoutMs: deps.timeoutMs ?? 60_000, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}) };
  const wiki = source.text ? null : wikiArticleOf(source.url);
  const article = wiki === null ? { title: new URL(source.url).hostname.replace(/^www\./, ''), url: source.url, lang: 'pl', site: 'web' as const, text: (source.text ?? '').slice(0, MAX_TEXT) } : { ...wiki, url: source.url, text: await articleText(wiki.title, wiki.lang, fetchImpl, wiki.site) };
  if (article.text.trim().length < 200) return null;
  const answer = await askStructured(deps.client, GuideDraft, guidePrompt(place, article), { ...ai, maxTokens: 3000, label: `przewodnik ${place.name}` });
  const images = article.site === 'web' ? [] : await articleImages(article.title, article.lang, 4, fetchImpl, article.site).catch(() => []);
  return { ...answer.data, images, article: { title: article.title, url: article.url, lang: article.lang, site: article.site } };
}
