import type { TripDocument } from '@expeditionplan/core';

/**
 * Porównanie importu AI z planem wzorcowym (`fixtures/plans/<plan>/plan.json`). Nie szuka
 * identyczności — `ref` i sformułowania będą inne — tylko tego, czy import czegoś nie zgubił:
 * liczności kolekcji, punktów i rezerwacji dopasowanych po tytule.
 */

const COUNTED = [
  'travelers',
  'places',
  'days',
  'items',
  'legs',
  'variantGroups',
  'variants',
  'constraints',
  'bookings',
  'contacts',
  'budgetLines',
  'tasks',
  'packing',
  'notes',
  'sources',
  'tracks',
] as const;

/** Tytuł sprowadzony do porównywalnej postaci: małe litery, bez znaków diakrytycznych i interpunkcji. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (title: string): Set<string> =>
  new Set(normalizeTitle(title).split(' ').filter((word) => word.length > 2));

/** Podobieństwo dwóch tytułów: część wspólnych słów (Jaccard), 0–1. */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return normalizeTitle(a) === normalizeTitle(b) ? 1 : 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Tytuły wzorca, dla których import nie ma odpowiednika o podobieństwie ≥ progu. */
export function missingTitles(gold: string[], imported: string[], threshold = 0.34): string[] {
  return gold.filter((title) => !imported.some((candidate) => similarity(title, candidate) >= threshold));
}

export type Comparison = {
  counts: { collection: (typeof COUNTED)[number]; gold: number; imported: number }[];
  missingItems: string[];
  extraItems: string[];
  missingBookings: string[];
  /** Część punktów wzorca odnaleziona w imporcie, 0–1. */
  itemRecall: number;
};

export function compareDocuments(gold: TripDocument, imported: TripDocument): Comparison {
  const goldItems = gold.items.map((item) => item.title);
  const importedItems = imported.items.map((item) => item.title);
  const missingItems = missingTitles(goldItems, importedItems);

  return {
    counts: COUNTED.map((collection) => ({
      collection,
      gold: gold[collection].length,
      imported: imported[collection].length,
    })),
    missingItems,
    extraItems: missingTitles(importedItems, goldItems),
    missingBookings: missingTitles(
      gold.bookings.map((booking) => booking.title),
      imported.bookings.map((booking) => booking.title),
    ),
    itemRecall: goldItems.length === 0 ? 1 : 1 - missingItems.length / goldItems.length,
  };
}

export function formatComparison(result: Comparison): string {
  const lines = ['Kolekcja        wzorzec  import', '---------------------------------'];
  for (const row of result.counts) {
    const mark = row.imported < row.gold ? '  ←' : '';
    lines.push(`${row.collection.padEnd(16)} ${String(row.gold).padStart(7)} ${String(row.imported).padStart(7)}${mark}`);
  }
  lines.push('', `Punkty odnalezione: ${Math.round(result.itemRecall * 100)}%`);
  if (result.missingItems.length > 0) lines.push('', 'Brakujące punkty:', ...result.missingItems.map((t) => `- ${t}`));
  if (result.missingBookings.length > 0) lines.push('', 'Brakujące rezerwacje:', ...result.missingBookings.map((t) => `- ${t}`));
  if (result.extraItems.length > 0) lines.push('', 'Punkty spoza wzorca:', ...result.extraItems.map((t) => `- ${t}`));
  return lines.join('\n');
}
