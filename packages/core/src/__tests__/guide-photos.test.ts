import { describe, expect, it } from 'vitest';

import { droppedGuidePhotos, GuideContent, guideImageCredit, guidePhotoPath, isWikimediaImage, ownGuideImage, ownGuidePhotoPath, putGuideImage, removeGuideImage } from '../guide.ts';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/guide_photos/';
const trip = '0190a1b2-0000-7000-8000-000000000001';
const commons = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Dinara.jpg',
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Dinara.jpg/960px-Dinara.jpg',
  title: 'File:Dinara.jpg',
  author: 'Jan',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Dinara.jpg',
};
const content = GuideContent.parse({ summary: 'Szczyt.', facts: [], images: [commons], article: { title: 'Dinara', url: 'https://pl.wikipedia.org/wiki/Dinara', lang: 'pl' } });

describe('własne zdjęcie w opisie miejsca', () => {
  it('plik w guide_photos/<wyjazd>/<id>.jpg, podpis „fot. autor”, nie udaje Commons', () => {
    const path = guidePhotoPath(trip, '0190a1b2-0000-7000-8000-0000000000aa');
    const own = ownGuideImage(BASE + path, ' Widok ze szczytu ', 'Ola');
    expect(own).toMatchObject({ title: 'Widok ze szczytu', author: 'Ola', own: true, thumbUrl: own.url });
    expect(GuideContent.shape.images.parse([own])).toHaveLength(1);
    expect(isWikimediaImage(own)).toBe(false);
    expect(ownGuidePhotoPath(own)).toBe(path);
    expect(ownGuidePhotoPath(commons)).toBeNull();
    expect(guideImageCredit(own)).toBe('fot. Ola');
    expect(guideImageCredit(commons)).toBe('Jan, CC BY-SA 4.0, Wikimedia Commons');
  });

  it('do skasowania idą tylko własne pliki, które wypadły z opisu', () => {
    const own = ownGuideImage(BASE + guidePhotoPath(trip, 'x'), 'Widok', 'Ola');
    const withOwn = putGuideImage(content, own);
    expect(droppedGuidePhotos(content, withOwn)).toEqual([]);
    expect(droppedGuidePhotos(withOwn, removeGuideImage(withOwn, commons.url))).toEqual([]);
    expect(droppedGuidePhotos(withOwn, removeGuideImage(withOwn, own.url))).toEqual([guidePhotoPath(trip, 'x')]);
    // Wymiana własnego na inne też zwalnia plik.
    expect(droppedGuidePhotos(withOwn, putGuideImage(withOwn, { ...commons, url: `${commons.url}?2` }, own.url))).toEqual([guidePhotoPath(trip, 'x')]);
  });
});
