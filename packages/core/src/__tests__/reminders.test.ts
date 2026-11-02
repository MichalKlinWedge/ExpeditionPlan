import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { zonedToInstant } from '../engine/time.ts';
import { tripReminders } from '../reminders.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

describe('przypomnienia z planu', () => {
  it('zadania z terminem i „Jutro wyjazd”, tylko przyszłe, po kolei', () => {
    const doc = TripDocument.parse({
      ...maroko,
      tasks: [
        ...maroko.tasks,
        { ref: 't-pasz', kind: 'todo', title: 'Sprawdź paszporty', status: 'open', due: { kind: 'before_trip', days: 14 }, priority: 'high' },
        { ref: 't-zrob', kind: 'todo', title: 'Już zrobione', status: 'done', due: { kind: 'before_trip', days: 3 } },
        { ref: 't-stare', kind: 'todo', title: 'Dawno', status: 'open', due: { kind: 'absolute', date: '2020-01-01' } },
      ],
    });
    const now = zonedToInstant('2026-11-02', '12:00', 'Europe/Warsaw');
    const list = tripReminders(doc, now);
    const keys = list.map((each) => each.key);
    expect(keys).toContain('task:t-pasz');
    expect(keys).not.toContain('task:t-zrob');
    expect(keys).not.toContain('task:t-stare');
    expect(list.map((each) => each.at)).toEqual([...list.map((each) => each.at)].sort((a, b) => a - b));
    const passports = list.find((each) => each.key === 'task:t-pasz')!;
    expect(passports.title).toBe('Ważne: Sprawdź paszporty');
    expect(passports.at).toBe(zonedToInstant('2026-12-12', '09:00', 'Europe/Warsaw'));
    expect(list.find((each) => each.key === 'trip:eve')!.at).toBe(zonedToInstant('2026-12-25', '19:00', 'Europe/Warsaw'));
  });

  it('po wyjeździe nic nie zostaje', () => {
    expect(tripReminders(maroko, zonedToInstant('2027-02-01', '12:00', 'Europe/Warsaw'))).toEqual([]);
  });
});
