import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { zonedToInstant } from '../engine/time.ts';
import { dayAlerts, tripReminders } from '../reminders.ts';
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

describe('powiadomienia z osi dnia', () => {
  const before = zonedToInstant('2026-12-26', '00:00', 'Africa/Casablanca');

  it('„Za 15 min” przed punktami i decyzja 30 min przed terminem, po kolei', () => {
    const list = dayAlerts(maroko, {}, before, { limit: 200 });
    const first = list.find((each) => each.key.startsWith('item:d1:'))!;
    expect(first.title.startsWith('Za 15 min: ')).toBe(true);
    const decision = list.find((each) => each.key === 'decide:d1-start')!;
    expect(decision.title).toBe('Decyzja do 12:30: Poślizg na lotnisku w Agadirze');
    expect(decision.at).toBe(zonedToInstant('2026-12-26', '12:00', 'Africa/Casablanca'));
    expect(list.map((each) => each.at)).toEqual([...list.map((each) => each.at)].sort((a, b) => a - b));
    expect(dayAlerts(maroko, {}, before)).toHaveLength(25);
  });

  it('opóźnienie z terenu przesuwa powiadomienia, wybór wariantu gasi decyzję', () => {
    const plain = dayAlerts(maroko, {}, before, { limit: 200 });
    const late = dayAlerts(maroko, { delays: [{ itemRef: 'd1-bankomat', minutes: 180 }], activeVariants: { 'd1-start': 'd1-v-plan' } }, before, { limit: 200 });
    const at = (list: typeof plain, key: string) => list.find((each) => each.key === key)?.at;
    // Suki są „nie wcześniej niż 16:00” — 3 h poślizgu przy bankomacie i tak je przesuwają.
    expect(at(late, 'item:d1:d1-suki')!).toBeGreaterThan(at(plain, 'item:d1:d1-suki')!);
    expect(at(late, 'decide:d1-start')).toBeUndefined();
  });

  it('nic z przeszłości', () => {
    expect(dayAlerts(maroko, {}, zonedToInstant('2027-01-01', '00:00', 'Africa/Casablanca'))).toEqual([]);
  });
});
