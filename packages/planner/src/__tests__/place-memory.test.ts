import { type PlannerPlaceMemory, type TripBrief, TripDocument } from '@expeditionplan/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { withMemoryWarning } from '../plan-trip.ts';
import { memorySection, stage1Prompt } from '../prompts.ts';

const memory: PlannerPlaceMemory[] = [
  { name: 'Dinara — szczyt', years: [2024], worth: 0, notWorth: 2, notes: ['mgła po południu'], avoid: true },
  { name: 'Krka', years: [], worth: 1, notWorth: 0, notes: [], avoid: false, at: [15.97, 43.8] },
];

const doc = TripDocument.parse({
  schemaVersion: 1,
  trip: { title: 'Test', startDate: '2026-04-25', endDate: '2026-04-25', primaryTz: 'Europe/Zagreb', baseCurrency: 'EUR' },
  days: [{ ref: 'd1', date: '2026-04-25', tz: 'Europe/Zagreb' }],
  places: [{ ref: 'p1', name: 'Dinara - szczyt' }, { ref: 'p2', name: 'Krka', lat: 43.8, lng: 15.97 }],
});

describe('pamięć miejsc w „Zaplanuj z AI”', () => {
  it('prompt dostaje miejsca do unikania i notatki, bez pamięci nic się nie zmienia', () => {
    const brief = JSON.parse(readFileSync(new URL('../../../../fixtures/plans/dinara/brief.json', import.meta.url), 'utf8')) as TripBrief;
    expect(memorySection()).toEqual([]);
    expect(stage1Prompt(brief)).not.toContain('Pamięć miejsc');
    const prompt = stage1Prompt(brief, memory);
    expect(prompt).toContain('- [unikaj] Dinara — szczyt — byliśmy w 2024; 2 × nie warto; notatka: „mgła po południu”');
    expect(prompt).toContain('- Krka — 1 × warto');
    expect(prompt).toContain('nie proponuj ponownie');
  });

  it('szkic z miejscem do unikania dostaje ostrzeżenie, a „warto” nie', () => {
    const warned = withMemoryWarning(doc, memory);
    expect(warned.notes).toHaveLength(1);
    expect(warned.notes[0]).toMatchObject({ scope: 'trip', kind: 'warning' });
    expect(warned.notes[0]!.body).toContain('Dinara — szczyt (byliśmy w 2024, 2 × nie warto)');
    expect(warned.notes[0]!.body).not.toContain('Krka');
    expect(withMemoryWarning(doc, memory.slice(1))).toBe(doc);
  });
});
