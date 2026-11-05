import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { editGuideText, GuideContent, type GuideRow, guideFor, guideText, tripGuides, undescribedSights } from '../guide.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const content = (summary: string): GuideContent => GuideContent.parse({ summary, facts: ['Fakt.'], tips: [], images: [{ url: 'https://example.com/a.jpg', thumbUrl: 'https://example.com/b.jpg', title: 'Zdjęcie', sourceUrl: 'https://example.com/c' }], article: { title: 'Artykuł', url: 'https://pl.wikipedia.org/wiki/A', lang: 'pl', site: 'wikipedia' }, hint: 'powiat' });

/** Identyfikatory wierszy: ref jako id, wystarczy do powiązań. */
const idsOf = (doc: TripDocument) => Object.fromEntries([...doc.places, ...doc.items].map((each) => [each.ref, `id-${each.ref}`]));

const row = (id: string, extra: Partial<GuideRow>): GuideRow => ({ id, item_id: null, place_id: null, audience: 'adult', lang: 'pl', title: id, content: content(id), ...extra });

describe('opisy miejsc wyjazdu', () => {
  const doc = load('maroko');
  const ids = idsOf(doc);
  const sights = doc.items.filter((item) => (item.kind === 'visit' || item.kind === 'activity') && item.dayRef !== undefined && item.planStatus === 'scheduled');
  const withPlace = sights.find((item) => item.placeRef !== undefined)!;
  const sameplace = sights.filter((item) => item.placeRef === withPlace.placeRef);

  it('opis miejsca jest na liście raz, z punktami, które go pokazują, po kolei', () => {
    const [guide] = tripGuides(doc, [row('g1', { place_id: ids[withPlace.placeRef!]!, item_id: ids[withPlace.ref]! })], ids);
    expect(guide).toMatchObject({ rowId: 'g1', title: 'g1', placeRef: withPlace.placeRef });
    expect(guide!.usedBy.map((item) => item.ref)).toEqual(expect.arrayContaining(sameplace.map((item) => item.ref)));
    expect(guide!.itemRef).toBeUndefined();
  });

  it('opis punktu (bez miejsca) wskazuje punkt, a opis bez punktu i miejsca też jest na liście, żeby dało się go usunąć', () => {
    const list = tripGuides(doc, [row('g2', { item_id: ids[withPlace.ref]! }), row('g3', { place_id: 'id-nie-ma' })], ids);
    expect(list.map((each) => each.rowId)).toEqual(['g2', 'g3']);
    expect(list[0]).toMatchObject({ itemRef: withPlace.ref });
    expect(list[0]!.usedBy.map((item) => item.ref)).toEqual([withPlace.ref]);
    expect(list[1]!.usedBy).toEqual([]);
    expect(list[1]!.placeRef).toBeUndefined();
    expect(list[1]!.itemRef).toBeUndefined();
  });

  it('usunięte, inne wersje i treść nie do odczytania nie wchodzą', () => {
    const rows = [row('a', { place_id: 'x', deleted_at: '2026-01-01' }), row('b', { place_id: 'x', audience: 'child' }), row('c', { place_id: 'x', content: { zepsute: true } })];
    expect(tripGuides(doc, rows, ids)).toEqual([]);
  });

  it('atrakcje bez opisu: każde miejsce raz, a opisane odpadają', () => {
    const all = undescribedSights(doc, [], ids);
    const keys = all.map((item) => item.leg?.toPlaceRef ?? item.placeRef ?? item.ref);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.length).toBeGreaterThan(0);
    const after = undescribedSights(doc, [row('g', { place_id: ids[withPlace.placeRef!]! })], ids);
    expect(after.some((item) => item.placeRef === withPlace.placeRef)).toBe(false);
    expect(after.length).toBe(all.length - 1);
    expect(all.every((item) => guideFor([], ids[item.ref], undefined) === null)).toBe(true);
  });

  it('ręczna poprawka zmienia tekst, a źródło, zdjęcia i podpowiedź zostają', () => {
    const old = content('Stary.');
    const edited = editGuideText(old, { summary: 'Nowy.', facts: ['Inny fakt.'], tips: ['Wskazówka.'] });
    expect(edited).toMatchObject({ summary: 'Nowy.', facts: ['Inny fakt.'], tips: ['Wskazówka.'], edited: true, article: old.article, images: old.images, hint: 'powiat' });
    expect(GuideContent.safeParse(edited).success).toBe(true);
    expect(guideText(edited)).toContain('Nowy.');
    const withHistory = { ...old, history: 'Dawno.' };
    expect(editGuideText(withHistory, { summary: 'Nowy.', facts: [], tips: [] }).history).toBeUndefined();
    expect(GuideContent.parse(old).edited).toBeUndefined();
  });
});
