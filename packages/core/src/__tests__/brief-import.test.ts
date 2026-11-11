import { describe, expect, it } from 'vitest';

import { applyBriefImport, type BriefDraft, BriefImport, briefImportRows } from '../brief-import.ts';
import { docxHtmlToText } from '../doc-text.ts';

const empty: BriefDraft = {
  goal: '',
  location: { kind: 'city', countries: [], places: [] },
  profiles: [],
  transport: [],
  budget: { level: 'medium', currency: 'PLN' },
  constraints: { pace: 'normal', noDrivingAfterDark: false, diet: [], allergies: [], accessibility: [], notes: [] },
  fixed: [],
  mustSee: [],
  avoid: [],
  notes: [],
};

const found = BriefImport.parse({
  goal: 'Pustynia i medyna z dziećmi.',
  locationKind: 'route',
  countries: ['ma', 'XYZ'],
  places: ['Marrakesz', 'Agafay', 'marrakesz'],
  profiles: ['family', 'nieznane'],
  transport: ['flight', 'rental_car'],
  budgetLevel: 'premium',
  currency: 'mad',
  budgetCap: 12000.5,
  mustSee: ['Jemaa el-Fna'],
  pace: 'calm',
  dayStart: '08:00',
  dayEnd: '25:00',
  maxDrivingMinPerDay: 180,
  noDrivingAfterDark: true,
  diet: ['wegetariańska'],
  fixed: [{ kind: 'flight', title: 'Lot WRO → RAK', startLocal: '2026-12-26 06:10', reference: 'FR1234' }, { kind: 'rakieta', title: 'Coś' }],
  notes: ['Riad przy bramie Bab Doukkala, 15 min pieszo do placu.'],
});

describe('brief z dokumentu', () => {
  it('podgląd: tylko znane wartości, poprawne godziny, bez powtórek; domyślne pola formularza nie są „teraz w briefie”', () => {
    const rows = briefImportRows(empty, found, 'Africa/Casablanca');
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byKey.countries?.value).toBe('MA');
    expect(byKey.places?.value).toBe('Marrakesz · Agafay');
    expect(byKey.profiles?.value).toBe('z dziećmi');
    expect(byKey.currency).toMatchObject({ value: 'MAD', current: 'PLN' });
    expect(byKey.budgetLevel?.current).toBeUndefined();
    expect(byKey.pace?.current).toBeUndefined();
    expect(byKey.dayEnd).toBeUndefined();
    expect(byKey.fixed?.value).toBe('lot: Lot WRO → RAK · 2026-12-26 06:10 · FR1234\ninne: Coś');
    expect(rows.every((row) => row.key !== 'avoid')).toBe(true);
  });

  it('wstawia wybrane pola: listy dopisują nowe pozycje, pojedyncze zastępują', () => {
    const current: BriefDraft = { ...empty, location: { kind: 'city', countries: ['MA'], places: ['Marrakesz'] }, goal: 'Stary cel' };
    const rows = briefImportRows(current, found, 'Africa/Casablanca');
    expect(rows.find((row) => row.key === 'countries')).toBeUndefined();
    expect(rows.find((row) => row.key === 'goal')?.current).toBe('Stary cel');
    const next = applyBriefImport(current, found, 'Africa/Casablanca', ['places', 'fixed', 'notes', 'budgetCap', 'currency', 'noDrivingAfterDark', 'dayStart']);
    expect(next.goal).toBe('Stary cel');
    expect(next.location.places).toEqual(['Marrakesz', 'Agafay']);
    expect(next.fixed[0]).toEqual({ kind: 'flight', title: 'Lot WRO → RAK', startTz: 'Africa/Casablanca', startLocal: '2026-12-26T06:10', reference: 'FR1234' });
    expect(next.budget).toEqual({ level: 'medium', currency: 'MAD', capMinor: 1200050 });
    expect(next.constraints).toMatchObject({ noDrivingAfterDark: true, dayStart: '08:00', pace: 'normal' });
    expect(next.notes).toHaveLength(1);
    // Wejście się nie zmienia.
    expect(current.location.places).toEqual(['Marrakesz']);
  });

  it('DOCX: tabela zostaje wierszami „a | b”', () => {
    expect(docxHtmlToText('<h2>Dzień 1</h2><table><tr><td><p>8:00</p><p>wyjazd</p></td><td>Agafay</td></tr></table>')).toBe('## Dzień 1\n\n8:00 / wyjazd | Agafay');
  });
});
