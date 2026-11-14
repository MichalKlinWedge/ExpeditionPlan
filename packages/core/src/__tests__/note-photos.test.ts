import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { addNotePhoto, MAX_NOTE_PHOTOS, moveNotePhoto, notePhotoCredit, notePhotoPath, notePhotoUrls, removeNotePhoto, setNotePhotoCaption } from '../note-photos.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/guide_photos/trip-1/';
const plan = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/barcelona/plan.json', import.meta.url)), 'utf8')));
const doc = plan;
const LOT = plan.items[0]!.ref;

describe('zdjęcia przy uwagach punktu', () => {
  it('dodaje, podpisuje, przesuwa i usuwa; ostatnie usunięte zostawia punkt bez pola', () => {
    const one = addNotePhoto(doc, LOT, { url: `${BASE}a.jpg`, caption: ' Wejście T2 ', author: ' Ola ' })!;
    expect(one.item.notePhotos).toEqual([{ url: `${BASE}a.jpg`, caption: 'Wejście T2', author: 'Ola' }]);
    expect(addNotePhoto(one.doc, LOT, { url: `${BASE}a.jpg` })).toBeNull();
    const two = addNotePhoto(one.doc, LOT, { url: `${BASE}b.jpg`, caption: '  ' })!;
    expect(two.item.notePhotos?.[1]).toEqual({ url: `${BASE}b.jpg` });
    expect(moveNotePhoto(two.doc, LOT, `${BASE}b.jpg`, -1)!.item.notePhotos?.map((each) => each.url)).toEqual([`${BASE}b.jpg`, `${BASE}a.jpg`]);
    expect(moveNotePhoto(two.doc, LOT, `${BASE}a.jpg`, -1)).toBeNull();
    expect(setNotePhotoCaption(two.doc, LOT, `${BASE}a.jpg`, 'Wejście T2')).toBeNull();
    expect(setNotePhotoCaption(two.doc, LOT, `${BASE}a.jpg`, '')!.item.notePhotos?.[0]).toEqual({ url: `${BASE}a.jpg`, author: 'Ola' });
    expect(notePhotoUrls(two.doc)).toEqual([`${BASE}a.jpg`, `${BASE}b.jpg`]);
    const left = removeNotePhoto(removeNotePhoto(two.doc, LOT, `${BASE}a.jpg`)!.doc, LOT, `${BASE}b.jpg`)!;
    expect('notePhotos' in left.item).toBe(false);
    expect(TripDocument.safeParse(two.doc).success).toBe(true);
  });

  it('limit zdjęć, ścieżka pliku i podpis', () => {
    let current = doc;
    for (let i = 0; i < MAX_NOTE_PHOTOS; i++) current = addNotePhoto(current, LOT, { url: `${BASE}${i}.jpg` })!.doc;
    expect(addNotePhoto(current, LOT, { url: `${BASE}x.jpg` })).toBeNull();
    expect(notePhotoPath(`${BASE}a.jpg`)).toBe('trip-1/a.jpg');
    expect(notePhotoPath('https://example.com/a.jpg')).toBeNull();
    expect(notePhotoCredit({ url: `${BASE}a.jpg`, caption: 'Wejście', author: 'Ola' })).toBe('Wejście · fot. Ola');
  });
});
