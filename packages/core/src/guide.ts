import { z } from 'zod';

/**
 * Przewodnik po punkcie planu (SPECYFIKACJA M8, tabela `audio_guides`): krótki opis, ciekawostki,
 * historia i zdjęcia — z artykułu Wikipedii (ugruntowanie), streszczone przez AI. Tekst pochodny
 * artykułu (Wikipedia albo Wikivoyage) = CC BY-SA 4.0 z linkiem do źródła; każde zdjęcie z Commons ma własną licencję i autora.
 * Jeden przewodnik na miejsce (`place_id`), a gdy punkt nie ma miejsca — na punkt (`item_id`).
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
  article: z.object({ title: z.string(), url: z.url(), lang: z.string(), site: z.enum(['wikipedia', 'wikivoyage']).default('wikipedia') }),
});

export type GuideImage = z.infer<typeof GuideImage>;
export type GuideDraft = z.infer<typeof GuideDraft>;
export type GuideContent = z.infer<typeof GuideContent>;

export const GUIDE_LICENSE = 'CC BY-SA 4.0';

/** „z Wikipedii” / „z Wikivoyage” — podpis źródła przewodnika. */
export const GUIDE_SITE: Record<'wikipedia' | 'wikivoyage', string> = { wikipedia: 'Wikipedii', wikivoyage: 'Wikivoyage' };

/** Wiersz `audio_guides` tak, jak przychodzi z `pull_changes`. */
export type GuideRow = { id: string; item_id: string | null; place_id: string | null; audience: string; lang: string; title: string; content: unknown; deleted_at?: string | null };

/** Przewodnik punktu: po miejscu, potem po samym punkcie; treść, która nie przechodzi walidacji, jest pomijana. */
export function guideFor(rows: readonly GuideRow[], itemId: string | undefined, placeId: string | undefined, audience = 'adult'): (GuideContent & { title: string }) | null {
  const alive = rows.filter((row) => !row.deleted_at && row.audience === audience);
  const row = (placeId !== undefined ? alive.find((each) => each.place_id === placeId) : undefined) ?? (itemId !== undefined ? alive.find((each) => each.item_id === itemId) : undefined);
  if (row === undefined) return null;
  const parsed = GuideContent.safeParse(row.content);
  return parsed.success ? { ...parsed.data, title: row.title } : null;
}

/** Tekst do czytania na głos (etap audio) i do kolumny `text`. */
export function guideText(content: GuideDraft): string {
  return [content.summary, ...content.facts, content.history ?? '', ...content.tips].filter((part) => part.trim() !== '').join('\n\n');
}
