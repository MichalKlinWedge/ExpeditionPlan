import { GUIDE_PHOTO_BUCKET } from './guide.ts';
import type { NotePhoto, TripDocument } from './schemas/trip-document.ts';

/**
 * Zdjęcia przy uwagach punktu (`DocItem.notePhotos`): wgrane przez organizatora albo edytora z dysku,
 * zmniejszone w przeglądarce jak własne zdjęcia opisów miejsc i w tym samym publicznym bucketcie
 * (`guidePhotoPath`), bo telefon pokazuje je offline po adresie.
 */

/** Najwięcej zdjęć przy uwagach jednego punktu. */
export const MAX_NOTE_PHOTOS = 12;

type Item = TripDocument['items'][number];
type ItemEdit = { doc: TripDocument; item: Item };

function changeItem(doc: TripDocument, itemRef: string, change: (photos: NotePhoto[]) => NotePhoto[] | null): ItemEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const photos = change(item.notePhotos ?? []);
  if (photos === null) return null;
  const { notePhotos: _old, ...rest } = item;
  const next: Item = photos.length > 0 ? { ...rest, notePhotos: photos } : rest;
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next };
}

const clean = (photo: NotePhoto): NotePhoto => {
  const caption = photo.caption?.trim();
  const author = photo.author?.trim();
  return { url: photo.url, ...(caption ? { caption } : {}), ...(author ? { author } : {}) };
};

/** Dopisuje zdjęcie na końcu; `null`, gdy punktu nie ma, zdjęcie już jest albo limit jest pełny. */
export function addNotePhoto(doc: TripDocument, itemRef: string, photo: NotePhoto): ItemEdit | null {
  return changeItem(doc, itemRef, (photos) => (photos.length >= MAX_NOTE_PHOTOS || photos.some((each) => each.url === photo.url) ? null : [...photos, clean(photo)]));
}

/** Usuwa zdjęcie; `null`, gdy go nie ma. */
export function removeNotePhoto(doc: TripDocument, itemRef: string, url: string): ItemEdit | null {
  return changeItem(doc, itemRef, (photos) => (photos.some((each) => each.url === url) ? photos.filter((each) => each.url !== url) : null));
}

/** Nowy podpis zdjęcia (pusty usuwa podpis); `null`, gdy nic się nie zmienia. */
export function setNotePhotoCaption(doc: TripDocument, itemRef: string, url: string, caption: string): ItemEdit | null {
  return changeItem(doc, itemRef, (photos) => {
    const at = photos.findIndex((each) => each.url === url);
    if (at === -1 || (photos[at]!.caption ?? '') === caption.trim()) return null;
    return photos.map((each, index) => (index === at ? clean({ ...each, caption }) : each));
  });
}

/** Przesunięcie zdjęcia o jedno miejsce; `null` poza listą. */
export function moveNotePhoto(doc: TripDocument, itemRef: string, url: string, by: -1 | 1): ItemEdit | null {
  return changeItem(doc, itemRef, (photos) => {
    const from = photos.findIndex((each) => each.url === url);
    const to = from + by;
    if (from === -1 || to < 0 || to >= photos.length) return null;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}

/** Plik zdjęcia w bucketcie (ścieżka po `/public/guide_photos/`) albo `null` dla obcego adresu. */
export function notePhotoPath(url: string): string | null {
  const match = new RegExp(`/storage/v1/object/public/${GUIDE_PHOTO_BUCKET}/(.+)$`).exec(url);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Podpis pod zdjęciem: opis i „fot. autor”. */
export function notePhotoCredit(photo: NotePhoto): string {
  return [photo.caption, photo.author ? `fot. ${photo.author}` : undefined].filter(Boolean).join(' · ');
}

/** Adresy wszystkich zdjęć uwag wyjazdu (telefon pobiera je na drogę). */
export function notePhotoUrls(doc: TripDocument): string[] {
  return doc.items.flatMap((item) => (item.notePhotos ?? []).map((photo) => photo.url));
}
