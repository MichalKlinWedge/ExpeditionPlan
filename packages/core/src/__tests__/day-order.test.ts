import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dayOrderNotes, dayPrograms, reorderDays } from '../day-order.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { dayLodging } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('kolejność dni', () => {
  const gruzja = fixture('gruzja');
  const refs = dayPrograms(gruzja).map((day) => day.ref);

  it('lista dni ma opis, liczbę punktów i nocleg', () => {
    const programs = dayPrograms(gruzja);
    expect(programs).toHaveLength(gruzja.days.length);
    expect(programs.map((day) => day.date)).toEqual([...programs.map((day) => day.date)].sort());
    for (const day of programs) {
      expect(day.title).not.toBe('');
      expect(day.summary.length).toBeLessThanOrEqual(141);
    }
    expect(programs.some((day) => day.lodging !== null)).toBe(true);
  });

  it('zamiana dwóch dni przestawia daty, a noclegi zostają przy datach', () => {
    const order = [...refs];
    [order[3], order[4]] = [order[4]!, order[3]!];
    const edit = reorderDays(gruzja, order)!;
    expect(edit.changed.map((day) => day.ref).sort()).toEqual([refs[3], refs[4]].sort());
    const old = (ref: string) => gruzja.days.find((day) => day.ref === ref)!;
    const next = (ref: string) => edit.doc.days.find((day) => day.ref === ref)!;
    expect(next(refs[3]!).date).toBe(old(refs[4]!).date);
    expect(next(refs[4]!).date).toBe(old(refs[3]!).date);
    // Program jedzie z dniem: tytuł i punkty bez zmian, nocleg i baza z daty.
    expect(next(refs[3]!).title).toBe(old(refs[3]!).title);
    expect(next(refs[3]!).lodgingRef).toBe(old(refs[4]!).lodgingRef);
    expect(next(refs[3]!).baseRef).toBe(old(refs[4]!).baseRef);
    expect(edit.doc.items).toBe(gruzja.items);
    for (const ref of [refs[3]!, refs[4]!]) {
      const slot = refs.indexOf(ref) === 3 ? refs[4]! : refs[3]!;
      expect(dayLodging(edit.doc, ref)?.name).toBe(dayLodging(gruzja, slot)?.name);
    }
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
    expect(() => scheduleDay(edit.doc, refs[3]!)).not.toThrow();
  });

  it('dwie zamiany wracają do początku', () => {
    const order = [...refs];
    [order[1], order[2]] = [order[2]!, order[1]!];
    const once = reorderDays(gruzja, order)!.doc;
    const back = reorderDays(once, refs)!.doc;
    for (const day of gruzja.days) expect(back.days.find((each) => each.ref === day.ref)).toEqual(day);
  });

  it('nie ta sama lista dni albo bez zmian = null', () => {
    expect(reorderDays(gruzja, refs)).toBeNull();
    expect(reorderDays(gruzja, refs.slice(1))).toBeNull();
    expect(reorderDays(gruzja, [...refs.slice(1), refs[1]!])).toBeNull();
  });

  it('uwagi: rezerwacja na datę i inny nocleg', () => {
    const programs = dayPrograms(gruzja);
    const first = [...refs];
    [first[0], first[1]] = [first[1]!, first[0]!];
    const notes = dayOrderNotes(programs, first);
    const heldFirst = programs[0]!.held.length + programs[1]!.held.length;
    expect(notes.filter((note) => note.includes('rezerwację') || note.includes('stałą godzinę'))).toHaveLength(heldFirst);
    expect(dayOrderNotes(programs, refs)).toEqual([]);
  });
});
