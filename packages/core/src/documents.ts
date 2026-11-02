/**
 * Sejf dokumentów (SPECYFIKACJA M11): pliki biletów, voucherów i potwierdzeń przy rezerwacji albo
 * punkcie, z widocznością i treścią kodu (QR, Aztec, PDF417…) odczytaną z pliku. Ten sam opis
 * na webie (wgrywanie, odczyt kodu w przeglądarce) i w telefonie (offline, kod na pełnym ekranie).
 */

/** Ten sam limit co w buckecie `documents` (migracja *_documents_vault). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_MIME: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];

export type DocumentVisibility = 'all' | 'members' | 'owner';

export const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  all: 'wszyscy w wyjeździe',
  members: 'wybrane osoby',
  owner: 'tylko organizator',
};

export type VaultDocument = {
  id: string;
  fileName: string;
  storagePath: string;
  mime: string | null;
  size: number | null;
  sha256: string | null;
  bookingId: string | null;
  itemId: string | null;
  visibility: DocumentVisibility;
  visibleTo: string[];
  offline: boolean;
  codePayload: string | null;
  codeFormat: string | null;
};

/** Wiersz `documents` (z `pull_changes` albo z pamięci telefonu) → dokument; usunięty = `null`. */
export function vaultDocument(row: Record<string, unknown>): VaultDocument | null {
  if (row.deleted_at !== null && row.deleted_at !== undefined) return null;
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  const visibility = row.visibility === 'members' || row.visibility === 'owner' ? row.visibility : 'all';
  return {
    id: String(row.id),
    fileName: String(row.file_name),
    storagePath: String(row.storage_path),
    mime: text(row.mime),
    size: typeof row.size === 'number' ? row.size : row.size === null || row.size === undefined ? null : Number(row.size),
    sha256: text(row.sha256),
    bookingId: text(row.booking_id),
    itemId: text(row.item_id),
    visibility,
    visibleTo: Array.isArray(row.visible_to) ? row.visible_to.map(String) : [],
    offline: row.offline !== false,
    codePayload: text(row.code_payload),
    codeFormat: text(row.code_format),
  };
}

/**
 * Ścieżka w buckecie: `<trip>/<dokument>/<nazwa>`. Nazwa bez polskich znaków i odstępów —
 * Storage przyjmuje ograniczony zestaw znaków, a oryginalna nazwa zostaje w `file_name`.
 */
export function documentPath(tripId: string, documentId: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const safe =
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plik';
  return `${tripId}/${documentId}/${safe}${extension ? `.${extension}` : ''}`;
}

/** Format kodu z czytnika (nazwy zxing-cpp) → symbol do narysowania (bwip-js) i nazwa po polsku. */
const CODES: Record<string, { bcid: string; label: string }> = {
  QRCode: { bcid: 'qrcode', label: 'kod QR' },
  MicroQRCode: { bcid: 'microqrcode', label: 'kod QR (mikro)' },
  Aztec: { bcid: 'azteccode', label: 'kod Aztec' },
  PDF417: { bcid: 'pdf417', label: 'kod PDF417' },
  DataMatrix: { bcid: 'datamatrix', label: 'kod DataMatrix' },
  Code128: { bcid: 'code128', label: 'kod kreskowy' },
  Code39: { bcid: 'code39', label: 'kod kreskowy' },
  EAN13: { bcid: 'ean13', label: 'kod kreskowy EAN' },
  EAN8: { bcid: 'ean8', label: 'kod kreskowy EAN' },
  ITF: { bcid: 'interleaved2of5', label: 'kod kreskowy' },
};

export const CODE_FORMATS: readonly string[] = Object.keys(CODES);

/** Symbol bwip-js dla formatu; nieznany format rysujemy jako QR z tą samą treścią. */
export const codeSymbol = (format: string | null) => CODES[format ?? '']?.bcid ?? 'qrcode';
export const codeLabel = (format: string | null) => CODES[format ?? '']?.label ?? 'kod';
/** Kody jednowymiarowe (paski) rysuje się szerzej niż wysoko. */
export const isLinearCode = (format: string | null) => ['Code128', 'Code39', 'EAN13', 'EAN8', 'ITF'].includes(format ?? '');

/** 1 234 567 → „1,2 MB”. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}
