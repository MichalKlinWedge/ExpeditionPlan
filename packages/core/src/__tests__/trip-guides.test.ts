import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { editGuideText, GuideContent, type GuideImage, type GuideRow, guideFor, guideText, isWikimediaImage, MAX_GUIDE_IMAGES, moveGuideImage, putGuideImage, removeGuideImage, speechParts, tripGuides, undescribedSights } from '../guide.ts';
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

  describe('zdjęcia opisu', () => {
    const photo = (name: string): GuideImage => ({ url: `https://upload.wikimedia.org/${name}.jpg`, thumbUrl: `https://upload.wikimedia.org/thumb/${name}.jpg`, title: name, license: 'CC BY-SA 4.0', sourceUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg` });
    const withPhotos = (...names: string[]) => ({ ...content('Opis.'), images: names.map(photo) });

    it('usunięcie zabiera jedno zdjęcie, a tekst i źródło zostają', () => {
      const old = withPhotos('a', 'b');
      const next = removeGuideImage(old, photo('a').url);
      expect(next.images.map((image) => image.title)).toEqual(['b']);
      expect(next).toMatchObject({ summary: 'Opis.', article: old.article, imagesEdited: true });
      expect(next.edited).toBeUndefined();
      expect(GuideContent.safeParse(next).success).toBe(true);
    });

    it('wymiana zostaje na tym samym miejscu, a bez wskazanego zdjęcia nowe idzie na koniec', () => {
      const old = withPhotos('a', 'b');
      expect(putGuideImage(old, photo('c'), photo('a').url).images.map((image) => image.title)).toEqual(['c', 'b']);
      expect(putGuideImage(old, photo('c')).images.map((image) => image.title)).toEqual(['a', 'b', 'c']);
      expect(putGuideImage(old, photo('c'), 'https://upload.wikimedia.org/nie-ma.jpg').images.map((image) => image.title)).toEqual(['a', 'b', 'c']);
    });

    it('kolejność: o jedno miejsce albo na początek, poza listę nic nie zmienia', () => {
      const old = withPhotos('a', 'b', 'c');
      const titles = (next: GuideContent) => next.images.map((image) => image.title);
      expect(titles(moveGuideImage(old, photo('b').url, -1))).toEqual(['b', 'a', 'c']);
      expect(titles(moveGuideImage(old, photo('b').url, 1))).toEqual(['a', 'c', 'b']);
      expect(titles(moveGuideImage(old, photo('c').url, 'first'))).toEqual(['c', 'a', 'b']);
      expect(moveGuideImage(old, photo('c').url, 'first').imagesEdited).toBe(true);
      expect(moveGuideImage(old, photo('a').url, -1)).toBe(old);
      expect(moveGuideImage(old, photo('c').url, 1)).toBe(old);
      expect(moveGuideImage(old, photo('a').url, 'first')).toBe(old);
      expect(moveGuideImage(old, 'https://upload.wikimedia.org/nie-ma.jpg', 1)).toBe(old);
    });

    it('zdjęcie już będące w opisie nic nie zmienia, a limit nie przepuszcza kolejnego', () => {
      const old = withPhotos('a', 'b');
      expect(putGuideImage(old, photo('b'), photo('a').url)).toBe(old);
      const full = withPhotos(...Array.from({ length: MAX_GUIDE_IMAGES }, (_, index) => `p${index}`));
      expect(putGuideImage(full, photo('nowe')).images).toHaveLength(MAX_GUIDE_IMAGES);
    });

    it('wybrać można tylko zdjęcie z Wikimedia z licencją', () => {
      expect(isWikimediaImage(photo('a'))).toBe(true);
      expect(isWikimediaImage({ ...photo('a'), url: 'https://example.com/a.jpg' })).toBe(false);
      expect(isWikimediaImage({ ...photo('a'), thumbUrl: 'https://upload.wikimedia.org.example.com/a.jpg' })).toBe(false);
      expect(isWikimediaImage({ ...photo('a'), sourceUrl: 'https://example.com/plik' })).toBe(false);
      expect(isWikimediaImage({ ...photo('a'), license: undefined })).toBe(false);
    });
  });
});

describe('speechParts', () => {
  it('dzieli po akapitach, a za długi akapit po zdaniach w limicie', () => {
    expect(speechParts('Pierwszy.\n\nDrugi.', 100)).toEqual(['Pierwszy.', 'Drugi.']);
    const parts = speechParts('Aaaa aaaa. Bbbb bbbb! Cccc cccc?', 22);
    expect(parts).toEqual(['Aaaa aaaa. Bbbb bbbb!', 'Cccc cccc?']);
    expect(parts.every((part) => part.length <= 22)).toBe(true);
  });
});
