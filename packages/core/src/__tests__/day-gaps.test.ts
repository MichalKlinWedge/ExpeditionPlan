import { describe, expect, it } from 'vitest';

import { dayGaps } from '../day-gaps.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { TripDocument, type TripDocumentInput } from '../schemas/trip-document.ts';

const doc = (items: TripDocumentInput['items']) =>
  TripDocument.parse({
    schemaVersion: 1,
    trip: { title: 'T', startDate: '2027-03-25', endDate: '2027-03-25', primaryTz: 'Europe/Budapest', baseCurrency: 'PLN' },
    days: [{ ref: 'd1', date: '2027-03-25', tz: 'Europe/Budapest' }],
    items,
  });

describe('wolny czas w planie dnia', () => {
  it('przerwa przed punktem ze stałą godziną dostaje znacznik po poprzednim wierszu', () => {
    const schedule = scheduleDay(
      doc([
        { ref: 'jazda', dayRef: 'd1', sortKey: '0010', kind: 'transport', title: 'Przejazd', time: { precision: 'exact', start: '05:00' }, leg: { mode: 'car', durationMin: 344 } },
        { ref: 'obiad', dayRef: 'd1', sortKey: '0020', kind: 'meal', title: 'Obiad', time: { precision: 'approx', start: '14:00' }, durationMin: 75 },
        { ref: 'nocleg', dayRef: 'd1', sortKey: '0030', kind: 'lodging', title: 'Zakwaterowanie', time: { precision: 'exact', start: '16:00' }, isFixed: true, durationMin: 0 },
        { ref: 'spacer', dayRef: 'd1', sortKey: '0040', kind: 'free', title: 'Spacer', durationMin: 60 },
      ]),
      'd1',
    );
    expect(dayGaps(schedule).map(({ from, to, minutes, afterItemRef }) => ({ from, to, minutes, afterItemRef }))).toEqual([
      { from: '10:44', to: '14:00', minutes: 196, afterItemRef: 'jazda' },
      { from: '15:15', to: '16:00', minutes: 45, afterItemRef: 'obiad' },
    ]);
  });

  it('krótki luz i podpunkty bloku nie robią przerwy', () => {
    const schedule = scheduleDay(
      doc([
        { ref: 'a', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'A', time: { precision: 'exact', start: '09:00' }, durationMin: 60 },
        { ref: 'b', dayRef: 'd1', sortKey: '0020', kind: 'visit', title: 'B', time: { precision: 'exact', start: '10:10' }, durationMin: 60 },
      ]),
      'd1',
    );
    expect(dayGaps(schedule)).toEqual([]);
  });
});
