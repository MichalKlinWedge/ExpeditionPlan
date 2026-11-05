import { z } from 'zod';

import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Przewodnik po punkcie planu (SPECYFIKACJA M8, tabela `audio_guides`): krótki opis, ciekawostki,
 * historia i zdjęcia — z artykułu Wikipedii (ugruntowanie), streszczone przez AI. Tekst pochodny
 * artykułu (Wikipedia albo Wikivoyage) = CC BY-SA 4.0 z linkiem do źródła; każde zdjęcie z Commons ma własną licencję i autora.
 * Źródło `web` to strona wskazana przez użytkownika: własne streszczenie z linkiem, bez tej licencji i bez zdjęć z tej strony.
 * Jeden przewodnik na miejsce (`place_id`), a gdy punkt nie ma miejsca — na punkt (`item_id`).
 * Opis ze wskazówką („opłaty i bramki na A7”) jest zawsze na punkt — dotyczy tego punktu, nie miejsca.
 * Doprecyzowanie ze strony „Miejsca” („wieś w powiecie trzebnickim”) zostaje przy miejscu.
 */

export const GuideImage = z.object({
  url: z.url(),
  thumbUrl: z.url(),
  title: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  licenseUrl: z.url().optional(),
  /** Strona pliku w Commons — tam pełna atrybucja. */
  sourceUrl: z.url(),
});

/** Część od AI — tylko z tekstu artykułu. */
export const GuideDraft = z.object({
  summary: z.string().min(1).describe('2–3 zdania: czym jest to miejsce i dlaczego warto'),
  facts: z.array(z.string()).max(8).describe('ciekawostki z artykułu, po jednym zdaniu'),
  history: z.string().optional().describe('krótka historia miejsca (do 5 zdań)'),
  tips: z.array(z.string()).max(4).default([]).describe('praktyczne wskazówki wynikające z artykułu'),
});

export const GuideContent = GuideDraft.extend({
  images: z.array(GuideImage).default([]),
  /** Artykuł, z którego powstał opis. */
  article: z.object({ title: z.string(), url: z.url(), lang: z.string(), site: z.enum(['wikipedia', 'wikivoyage', 'web']).default('wikipedia') }),
  /** Wskazówka organizatora dla AI, z którą powstał opis (do ponownego użycia przy odświeżeniu); w opisie miejsca: które dokładnie to miejsce. */
  hint: z.string().optional(),
  /** Tekst poprawiony ręcznie: nowa wersja z AI by to zastąpiła, więc pytamy przed nią. */
  edited: z.boolean().optional(),
  /** Zdjęcia zmienione ręcznie: tak samo, nowa wersja z AI by je zastąpiła. */
  imagesEdited: z.boolean().optional(),
});

export type GuideImage = z.infer<typeof GuideImage>;
export type GuideDraft = z.infer<typeof GuideDraft>;
export type GuideContent = z.infer<typeof GuideContent>;

export const GUIDE_LICENSE = 'CC BY-SA 4.0';

/** „z Wikipedii” / „z Wikivoyage” — podpis źródła przewodnika. */
export const GUIDE_SITE: Record<'wikipedia' | 'wikivoyage' | 'web', string> = { wikipedia: 'Wikipedii', wikivoyage: 'Wikivoyage', web: 'strony' };

/** Wiersz `audio_guides` tak, jak przychodzi z `pull_changes`. */
export type GuideRow = { id: string; item_id: string | null; place_id: string | null; audience: string; lang: string; title: string; content: unknown; deleted_at?: string | null };

/** Wiersz przewodnika punktu: własny opis punktu (bez miejsca, np. ze wskazówką), potem opis miejsca, potem dowolny opis z punktu. */
export function guideRowFor(rows: readonly GuideRow[], itemId: string | undefined, placeId: string | undefined, audience = 'adult'): GuideRow | undefined {
  const alive = rows.filter((row) => !row.deleted_at && row.audience === audience);
  return (
    (itemId !== undefined ? alive.find((each) => each.item_id === itemId && each.place_id === null) : undefined) ??
    (placeId !== undefined ? alive.find((each) => each.place_id === placeId) : undefined) ??
    (itemId !== undefined ? alive.find((each) => each.item_id === itemId) : undefined)
  );
}

/** Przewodnik punktu (kolejność jak `guideRowFor`); treść, która nie przechodzi walidacji, jest pomijana. */
export function guideFor(rows: readonly GuideRow[], itemId: string | undefined, placeId: string | undefined, audience = 'adult'): (GuideContent & { title: string }) | null {
  const row = guideRowFor(rows, itemId, placeId, audience);
  if (row === undefined) return null;
  const parsed = GuideContent.safeParse(row.content);
  return parsed.success ? { ...parsed.data, title: row.title } : null;
}

export type PlaceGuide = { content: GuideContent; rowId: string; title: string; fromItem?: { ref: string; title: string } };

/**
 * Opis do pokazania przy miejscu: opis tego miejsca, a bez niego własny opis punktu, który do niego prowadzi
 * (np. ze wskazówką dla AI). Punkt liczy się tylko po celu: przejazd stąd opisuje inne miejsce.
 */
export function placeGuide(
  items: readonly { ref: string; title: string; kind: string; placeRef?: string | undefined; leg?: { toPlaceRef?: string | undefined } | undefined }[],
  rows: readonly GuideRow[],
  ids: Record<string, string>,
  placeRef: string,
  audience = 'adult',
): PlaceGuide | null {
  const alive = rows.filter((row) => !row.deleted_at && row.audience === audience);
  const parse = (row: GuideRow, fromItem?: PlaceGuide['fromItem']): PlaceGuide | null => {
    const parsed = GuideContent.safeParse(row.content);
    return parsed.success ? { content: parsed.data, rowId: row.id, title: row.title, ...(fromItem ? { fromItem } : {}) } : null;
  };
  const own = alive.find((row) => row.place_id === ids[placeRef]);
  if (own !== undefined) return parse(own);
  for (const item of items) {
    if ((item.leg?.toPlaceRef ?? item.placeRef) !== placeRef || item.kind === 'lodging') continue;
    const row = alive.find((each) => each.item_id === ids[item.ref] && each.place_id === null);
    const found = row === undefined ? null : parse(row, { ref: item.ref, title: item.title });
    if (found !== null) return found;
  }
  return null;
}

/** Ręczna poprawka tekstu: zdjęcia, źródło i podpowiedź zostają. */
export function editGuideText(content: GuideContent, text: z.input<typeof GuideDraft>): GuideContent {
  const { history: _old, ...rest } = content;
  return { ...rest, ...GuideDraft.parse(text), edited: true };
}

/** Najwięcej zdjęć w opisie po ręcznych zmianach. */
export const MAX_GUIDE_IMAGES = 8;

const WIKIMEDIA_FILE = /^https:\/\/[a-z0-9.-]+\.wikimedia\.org\//;
const WIKIMEDIA_PAGE = /^https:\/\/([a-z0-9-]+\.)*(wikimedia|wikipedia|wikivoyage)\.org\//;

/** Zdjęcie wybrane ręcznie musi pochodzić z Wikimedia i mieć licencję: opis jest też na publicznym linku. */
export function isWikimediaImage(image: GuideImage): boolean {
  return WIKIMEDIA_FILE.test(image.url) && WIKIMEDIA_FILE.test(image.thumbUrl) && WIKIMEDIA_PAGE.test(image.sourceUrl) && Boolean(image.license?.trim());
}

export function removeGuideImage(content: GuideContent, url: string): GuideContent {
  return { ...content, images: content.images.filter((image) => image.url !== url), imagesEdited: true };
}

/** Wymiana zdjęcia `replaceUrl` na tym samym miejscu, bez niego dopisanie na końcu. Zdjęcie, które już jest w opisie, nic nie zmienia. */
export function putGuideImage(content: GuideContent, image: GuideImage, replaceUrl?: string): GuideContent {
  if (content.images.some((each) => each.url === image.url)) return content;
  const at = content.images.findIndex((each) => each.url === replaceUrl);
  const images = at === -1 ? [...content.images, image] : content.images.map((each, index) => (index === at ? image : each));
  return { ...content, images: images.slice(0, MAX_GUIDE_IMAGES), imagesEdited: true };
}

type Doc = TripDocument;
type Item = Doc['items'][number];

const placeRefOf = (item: Item) => item.leg?.toPlaceRef ?? item.placeRef;

/** Punkty planu po kolei: dzień po dniu, a w dniu wg `sortKey`. */
function plannedItems(doc: Doc): Item[] {
  const order = new Map([...doc.days].sort((a, b) => a.date.localeCompare(b.date)).map((day, index) => [day.ref, index]));
  const dayOf = (item: Item) => (item.dayRef === undefined ? Number.MAX_SAFE_INTEGER : (order.get(item.dayRef) ?? Number.MAX_SAFE_INTEGER));
  return [...doc.items].sort((a, b) => dayOf(a) - dayOf(b) || (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
}

/** Opis na liście „Opisy miejsc”. `placeRef` — opis miejsca; `itemRef` — opis punktu bez miejsca; oba puste — tego w planie już nie ma. */
export type TripGuide = { rowId: string; title: string; content: GuideContent; placeRef?: string; itemRef?: string; usedBy: { ref: string; title: string }[] };

/** Wszystkie opisy wyjazdu, w kolejności pierwszego użycia w planie; opisy niczego już nie pokazywane na końcu. */
export function tripGuides(doc: Doc, rows: readonly GuideRow[], ids: Record<string, string>, audience = 'adult'): TripGuide[] {
  const alive = rows.filter((row) => !row.deleted_at && row.audience === audience);
  const refOf = new Map(Object.entries(ids).map(([ref, id]) => [id, ref]));
  const used = new Map<string, TripGuide['usedBy']>();
  for (const item of plannedItems(doc)) {
    if (item.kind === 'lodging') continue;
    const placeRef = placeRefOf(item);
    const row = guideRowFor(alive, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef], audience);
    if (row !== undefined) used.set(row.id, [...(used.get(row.id) ?? []), { ref: item.ref, title: item.title }]);
  }
  const position = (row: GuideRow) => {
    const index = [...used.keys()].indexOf(row.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...alive].sort((a, b) => position(a) - position(b)).flatMap((row) => {
    const parsed = GuideContent.safeParse(row.content);
    if (!parsed.success) return [];
    const placeRef = row.place_id === null ? undefined : refOf.get(row.place_id);
    const itemRef = row.place_id !== null || row.item_id === null ? undefined : refOf.get(row.item_id);
    return [{ rowId: row.id, title: row.title, content: parsed.data, ...(placeRef ? { placeRef } : {}), ...(itemRef ? { itemRef } : {}), usedBy: used.get(row.id) ?? [] }];
  });
}

/** Zwiedzanie i aktywności z dniem bez opisu; miejsce opisane raz wystarcza dla wszystkich punktów w nim, więc każde jest tu raz. */
export function undescribedSights(doc: Doc, rows: readonly GuideRow[], ids: Record<string, string>): Item[] {
  const seen = new Set<string>();
  return doc.items.filter((item) => {
    if ((item.kind !== 'visit' && item.kind !== 'activity') || item.dayRef === undefined || item.planStatus !== 'scheduled') return false;
    const ref = placeRefOf(item);
    const key = ref ?? item.ref;
    if (seen.has(key)) return false;
    seen.add(key);
    return guideFor(rows, ids[item.ref], ref === undefined ? undefined : ids[ref]) === null;
  });
}

/** Tekst do czytania na głos (etap audio) i do kolumny `text`. */
export function guideText(content: GuideDraft): string {
  return [content.summary, ...content.facts, content.history ?? '', ...content.tips].filter((part) => part.trim() !== '').join('\n\n');
}
