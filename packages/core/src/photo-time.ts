/**
 * Czas zrobienia zdjęcia z EXIF JPEG (`DateTimeOriginal`, a bez niego `DateTime`): lokalna data i godzina aparatu,
 * bez strefy — wpis dziennika liczy ją w strefie dnia. Data pliku z komputera to zwykle czas kopiowania, więc
 * zdjęcie dodane po wyjeździe trafia na właściwą godzinę tylko dzięki EXIF. Czysty TS, tylko pierwsze ~128 KB pliku.
 */

const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME = 0x0132;
const EXIF_IFD = 0x8769;

/** Ile bajtów z początku pliku wystarczy (EXIF jest w APP1 na początku JPEG). */
export const PHOTO_TIME_BYTES = 128 * 1024;

export function photoTakenAt(bytes: Uint8Array): { date: string; time: string } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) return null;
    const size = view.getUint16(offset + 2);
    // APP1 z nagłówkiem „Exif\0\0”.
    if (marker === 0xe1 && offset + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'Exif') return fromTiff(view, offset + 10, Math.min(bytes.length, offset + 2 + size));
    offset += 2 + size;
  }
  return null;
}

function fromTiff(view: DataView, start: number, end: number): { date: string; time: string } | null {
  if (start + 8 > end) return null;
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at: number) => (at + 2 <= end ? view.getUint16(at, little) : -1);
  const u32 = (at: number) => (at + 4 <= end ? view.getUint32(at, little) : -1);
  const tags = (ifd: number): Map<number, number> => {
    const found = new Map<number, number>();
    const at = start + ifd;
    const count = u16(at);
    for (let index = 0; index < count && index < 512; index++) {
      const entry = at + 2 + index * 12;
      if (entry + 12 > end) break;
      found.set(u16(entry), entry);
    }
    return found;
  };
  const ascii = (entry: number): string | null => {
    const count = u32(entry + 4);
    if (count < 19) return null;
    const at = start + u32(entry + 8);
    if (at < start || at + 19 > end) return null;
    let text = '';
    for (let index = 0; index < 19; index++) text += String.fromCharCode(view.getUint8(at + index));
    return text;
  };
  const ifd0 = u32(start + 4);
  if (ifd0 <= 0) return null;
  const main = tags(ifd0);
  const exifEntry = main.get(EXIF_IFD);
  const exif = exifEntry === undefined ? new Map<number, number>() : tags(u32(exifEntry + 8));
  for (const entry of [exif.get(DATE_TIME_ORIGINAL), main.get(DATE_TIME)]) {
    const text = entry === undefined ? null : ascii(entry);
    const match = text === null ? null : /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(text);
    if (match && match[1] !== '0000') return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` };
  }
  return null;
}
