import { describe, expect, it } from 'vitest';

import { daySunMarks } from '../day-sun.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { TripDocument, type TripDocumentInput } from '../schemas/trip-document.ts';

/** Marakesz 27.12.2026: wschód ok. 07:30, zachód ok. 17:35 (czas UTC+0). */
const doc = (items: TripDocumentInput['items'], extra: Partial<TripDocumentInput> = {}) =>
  TripDocument.parse({
    schemaVersion: 1,
    trip: { title: 'T', startDate: '2026-12-27', endDate: '2026-12-27', primaryTz: 'Africa/Casablanca', baseCurrency: 'PLN' },
    days: [{ ref: 'd1', date: '2026-12-27', tz: 'Africa/Casablanca', baseRef: 'riad' }],
    places: [{ ref: 'riad', name: 'Riad', lat: 31.6295, lng: -7.9811 }],
    items,
    ...extra,
  });

const marks = (items: TripDocumentInput['items'], extra: Partial<TripDocumentInput> = {}) =>
  daySunMarks(scheduleDay(doc(items, extra), 'd1')).map((mark) => `${mark.kind}@${mark.afterItemRef}`);

describe('daySunMarks', () => {
  it('wschód i zachód w godzinach planu stoją po punkcie, w którego trakcie albo po którym wypadają', () => {
    const items: TripDocumentInput['items'] = [
      { ref: 'sniadanie', dayRef: 'd1', sortKey: '0010', kind: 'meal', title: 'Śniadanie', time: { precision: 'exact', start: '07:00' }, durationMin: 20 },
      { ref: 'suki', dayRef: 'd1', sortKey: '0020', kind: 'visit', title: 'Suki', time: { precision: 'exact', start: '08:00' }, durationMin: 240 },
      { ref: 'ogrod', dayRef: 'd1', sortKey: '0030', kind: 'visit', title: 'Ogród', time: { precision: 'exact', start: '17:00' }, durationMin: 60 },
      { ref: 'kolacja', dayRef: 'd1', sortKey: '0040', kind: 'meal', title: 'Kolacja', time: { precision: 'exact', start: '19:00' }, durationMin: 60 },
    ];
    const result = daySunMarks(scheduleDay(doc(items), 'd1'));

    expect(result.map((mark) => `${mark.kind}@${mark.afterItemRef}`)).toEqual(['sunrise@sniadanie', 'sunset@ogrod']);
    expect(result[1]!.time).toMatch(/^17:[23]\d$/);
  });

  it('znika, gdy słońce wschodzi przed planem albo zachodzi po nim', () => {
    expect(
      marks([
        { ref: 'a', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'A', time: { precision: 'exact', start: '09:00' }, durationMin: 120 },
        { ref: 'b', dayRef: 'd1', sortKey: '0020', kind: 'visit', title: 'B', time: { precision: 'exact', start: '13:00' }, durationMin: 120 },
      ]),
    ).toEqual([]);
  });

  it('bez współrzędnych dnia nie ma znacznika', () => {
    const items: TripDocumentInput['items'] = [
      { ref: 'a', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'A', time: { precision: 'exact', start: '06:00' }, durationMin: 720 },
    ];
    const schedule = scheduleDay(
      TripDocument.parse({ ...doc(items), days: [{ ref: 'd1', date: '2026-12-27', tz: 'Africa/Casablanca' }], places: [] }),
      'd1',
    );

    expect(daySunMarks(schedule)).toEqual([]);
  });

  it('nie rozdziela przejazdu i jego postoju w trasie', () => {
    expect(
      marks([
        { ref: 'jazda', dayRef: 'd1', sortKey: '0010', kind: 'transport', title: 'Jazda', time: { precision: 'exact', start: '16:00' }, leg: { mode: 'car', durationMin: 120 } },
        { ref: 'kawa', dayRef: 'd1', sortKey: '0020', kind: 'free', title: 'Kawa', parentRef: 'jazda', durationMin: 30 },
        { ref: 'nocleg', dayRef: 'd1', sortKey: '0030', kind: 'lodging', title: 'Nocleg', durationMin: 30 },
      ]),
    ).toEqual(['sunset@kawa']);
  });

  it('liczy się wybrany wariant dnia', () => {
    const items: TripDocumentInput['items'] = [
      { ref: 'start', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Start', time: { precision: 'exact', start: '14:00' }, durationMin: 60 },
      { ref: 'krotko', dayRef: 'd1', sortKey: '0020', kind: 'visit', title: 'Krótko', variantRefs: ['v1'], durationMin: 60 },
      { ref: 'dlugo', dayRef: 'd1', sortKey: '0030', kind: 'visit', title: 'Długo', variantRefs: ['v2'], durationMin: 300 },
    ];
    const extra: Partial<TripDocumentInput> = {
      variantGroups: [{ ref: 'g', scope: 'day', dayRef: 'd1', title: 'Popołudnie', conditionKind: 'choice' }],
      variants: [{ ref: 'v1', groupRef: 'g', label: 'Krótko' }, { ref: 'v2', groupRef: 'g', label: 'Długo' }],
    };
    const schedule = (variant: string) => daySunMarks(scheduleDay(doc(items, extra), 'd1', { activeVariants: { g: variant } }));

    expect(schedule('v1')).toEqual([]);
    expect(schedule('v2').map((mark) => `${mark.kind}@${mark.afterItemRef}`)).toEqual(['sunset@dlugo']);
  });
});
