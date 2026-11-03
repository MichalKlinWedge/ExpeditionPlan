import { type GuideRow, guideFor } from './guide.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Odnośniki w przewodniku: nazwa innego opisanego miejsca tego wyjazdu w treści opisu („…stąd widać
 * Kutubiję”) staje się linkiem do jego karty. Odmiana po polsku: każde słowo nazwy dłuższe niż
 * 4 litery dopasowuje się po rdzeniu (bez dwóch ostatnich liter), więc „Medyna Essaouiry” trafia
 * też w „medynie Essaouiry”. Jeden link na miejsce w całym opisie — pierwsze wystąpienie.
 * Bez lookbehind i `\p{L}` (silnik regex telefonu), litery wypisane wprost.
 */

type Doc = TripDocument;
export type GuideLinkTarget = { ref: string; names: string[] };
export type GuideSegment = { text: string; ref?: string };

const LETTER = 'a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\\u00C0-\\u024F';
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wzorzec nazwy z tolerancją odmiany; `null` dla nazw za krótkich, żeby nie łapać przypadkowych słów. */
function namePattern(name: string): string | null {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s,–—-]+/)
    .filter((word) => word.length > 0);
  if (words.length === 0 || words.join('').length < 4) return null;
  return words.map((word) => (word.length > 4 ? `${escape(word.slice(0, -2))}[${LETTER}]*` : escape(word))).join('[\\s-]+');
}

/** Miejsca z przewodnikiem w wyjeździe (bez `exceptRef` — punktu, którego opis się czyta). */
export function guideLinkTargets(doc: Doc, rows: readonly GuideRow[], ids: Record<string, string>, exceptRef?: string): GuideLinkTarget[] {
  const except = doc.items.find((item) => item.ref === exceptRef);
  const exceptPlace = except?.leg?.toPlaceRef ?? except?.placeRef;
  const seen = new Set<string>();
  const targets: GuideLinkTarget[] = [];
  for (const item of doc.items) {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    const key = placeRef ?? item.ref;
    if (item.ref === exceptRef || (exceptPlace !== undefined && placeRef === exceptPlace) || seen.has(key)) continue;
    const guide = guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
    if (guide === null) continue;
    seen.add(key);
    const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
    const names = [...new Set([place?.name, guide.title, guide.article.title].filter((name): name is string => typeof name === 'string' && name.trim() !== ''))];
    targets.push({ ref: item.ref, names });
  }
  return targets;
}

/**
 * Tekst pocięty na kawałki zwykłe i z odnośnikiem. `used` — miejsca już podlinkowane we wcześniejszych
 * akapitach tego samego opisu (wspólny zbiór dla opisu, ciekawostek i historii).
 */
export function linkGuideText(text: string, targets: readonly GuideLinkTarget[], used: Set<string> = new Set()): GuideSegment[] {
  const patterns = targets.flatMap((target) =>
    target.names
      .map(namePattern)
      .filter((pattern): pattern is string => pattern !== null)
      // Dłuższa nazwa najpierw: „Medyna Essaouiry” przed „Essaouira”.
      .sort((a, b) => b.length - a.length)
      .map((pattern) => ({ ref: target.ref, regex: new RegExp(`(^|[^${LETTER}])(${pattern})(?![${LETTER}])`, 'i') })),
  );
  const segments: GuideSegment[] = [];
  let rest = text;
  for (;;) {
    let best: { ref: string; start: number; length: number } | null = null;
    for (const { ref, regex } of patterns) {
      if (used.has(ref)) continue;
      const match = regex.exec(rest);
      if (match === null) continue;
      const start = match.index + match[1]!.length;
      if (best === null || start < best.start || (start === best.start && match[2]!.length > best.length)) best = { ref, start, length: match[2]!.length };
    }
    if (best === null) break;
    if (best.start > 0) segments.push({ text: rest.slice(0, best.start) });
    segments.push({ text: rest.slice(best.start, best.start + best.length), ref: best.ref });
    used.add(best.ref);
    rest = rest.slice(best.start + best.length);
  }
  if (rest !== '') segments.push({ text: rest });
  return segments;
}
