import { describe, expect, it } from 'vitest';

import { codeLabel, codeSymbol, documentPath, formatBytes, isLinearCode, vaultDocument } from '../documents.ts';

describe('sejf dokumentów', () => {
  it('ścieżka w buckecie: katalog wyjazdu i dokumentu, nazwa bez polskich znaków', () => {
    expect(documentPath('trip', 'doc', 'Bilet Pałac Bahia — 5 osób.PDF')).toBe('trip/doc/Bilet-Palac-Bahia-5-osob.pdf');
    expect(documentPath('trip', 'doc', 'Łódź.jpeg')).toBe('trip/doc/Lodz.jpeg');
    expect(documentPath('trip', 'doc', '???.png')).toBe('trip/doc/plik.png');
    expect(documentPath('trip', 'doc', 'bez-rozszerzenia')).toBe('trip/doc/bez-rozszerzenia');
  });

  it('wiersz z bazy → dokument; usunięty znika', () => {
    const row = { id: 'd1', file_name: 'bilet.pdf', storage_path: 't/d1/bilet.pdf', mime: 'application/pdf', size: '2048', sha256: '', booking_id: 'b1', item_id: null, visibility: 'members', visible_to: ['u1'], offline: true, code_payload: 'ABC123', code_format: 'Aztec', deleted_at: null };
    expect(vaultDocument(row)).toMatchObject({ id: 'd1', size: 2048, sha256: null, bookingId: 'b1', visibility: 'members', visibleTo: ['u1'], codeFormat: 'Aztec' });
    expect(vaultDocument({ ...row, deleted_at: '2026-11-03T10:00:00Z' })).toBeNull();
    expect(vaultDocument({ ...row, visibility: 'cokolwiek' })!.visibility).toBe('all');
  });

  it('format kodu → symbol do narysowania i nazwa', () => {
    expect(codeSymbol('Aztec')).toBe('azteccode');
    expect(codeSymbol('PDF417')).toBe('pdf417');
    expect(codeSymbol(null)).toBe('qrcode');
    expect(codeLabel('QRCode')).toBe('kod QR');
    expect(isLinearCode('Code128')).toBe(true);
    expect(isLinearCode('QRCode')).toBe(false);
    expect(formatBytes(1536)).toBe('2 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
  });
});
