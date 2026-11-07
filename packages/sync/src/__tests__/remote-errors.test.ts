import { describe, expect, it, vi } from 'vitest';

import { dbErrorMessage, dbLoadError } from '../remote.ts';

describe('komunikat błędu bazy', () => {
  it('odmowa RLS to brak uprawnień', () => {
    expect(dbErrorMessage({ code: '42501', message: 'new row violates row-level security policy for table "items"' })).toBe('Brak uprawnień do tej zmiany.');
  });
  it('własne komunikaty funkcji SQL przechodzą', () => {
    expect(dbErrorMessage({ code: '42501', message: 'Tylko organizator zaprasza' })).toBe('Tylko organizator zaprasza');
    expect(dbErrorMessage({ code: 'EP001', message: 'Plan zmienił się w międzyczasie' })).toBe('Plan zmienił się w międzyczasie');
    expect(dbErrorMessage({ code: 'P0002', message: 'Zaproszenie jest nieważne' })).toBe('Zaproszenie jest nieważne');
  });
  it('brak sieci', () => {
    expect(dbErrorMessage({ message: 'TypeError: fetch failed' })).toBe('Brak połączenia z serwerem. Sprawdź internet.');
    expect(dbErrorMessage({ message: 'Network request failed' })).toBe('Brak połączenia z serwerem. Sprawdź internet.');
  });
  it('tekst techniczny zastępuje polski komunikat', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(dbErrorMessage({ code: '23503', message: 'insert or update on table violates foreign key constraint' })).not.toMatch(/violates/);
    expect(dbErrorMessage({ message: 'column does not exist' }, 'Nie zapisano.')).toBe('Nie zapisano.');
    expect(dbLoadError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe('Nie udało się wczytać danych. Odśwież stronę.');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
