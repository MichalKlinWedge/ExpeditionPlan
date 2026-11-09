import { describe, expect, it } from 'vitest';

import { photoTakenAt } from '../photo-time.ts';

/** Minimalny JPEG: SOI, APP1 z TIFF (IFD0 → Exif IFD → DateTimeOriginal), SOS. */
function jpeg(little: boolean, original: string | null, plain: string | null): Uint8Array {
  const tiff: number[] = [];
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) => (little ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24] : [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  const text = (value: string) => [...value].map((char) => char.charCodeAt(0)).concat(0);
  // Układ: nagłówek (8), IFD0 z 2 wpisami (2+24+4=30) od 8, Exif IFD z 1 wpisem (2+12+4=18) od 38, teksty od 56 i 76.
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(2));
  tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(plain === null ? 0 : 76));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(38));
  tiff.push(...u32(0));
  tiff.push(...u16(original === null ? 0 : 1));
  if (original !== null) tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(56));
  tiff.push(...u32(0));
  while (tiff.length < 56) tiff.push(0);
  tiff.push(...(original === null ? new Array(20).fill(0) : text(original)));
  tiff.push(...(plain === null ? new Array(20).fill(0) : text(plain)));
  const app1 = [...text('Exif'), 0, ...tiff];
  const size = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

describe('photoTakenAt', () => {
  it('czyta DateTimeOriginal (Intel i Motorola)', () => {
    expect(photoTakenAt(jpeg(true, '2026:10:24 14:37:05', '2026:11:01 09:00:00'))).toEqual({ date: '2026-10-24', time: '14:37' });
    expect(photoTakenAt(jpeg(false, '2026:10:24 14:37:05', null))).toEqual({ date: '2026-10-24', time: '14:37' });
  });
  it('bez DateTimeOriginal bierze DateTime', () => {
    expect(photoTakenAt(jpeg(true, null, '2026:10:25 08:05:00'))).toEqual({ date: '2026-10-25', time: '08:05' });
  });
  it('nie JPEG, bez EXIF albo pusta data → null', () => {
    expect(photoTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(photoTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(photoTakenAt(jpeg(true, '0000:00:00 00:00:00', null))).toBeNull();
    expect(photoTakenAt(jpeg(true, '2026:10:24 14:37:05', null).subarray(0, 40))).toBeNull();
  });
});
