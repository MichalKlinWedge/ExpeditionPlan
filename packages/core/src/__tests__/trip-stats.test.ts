import { describe, expect, it } from 'vitest';

import { localToday, type TripSummary, tripStats } from '../trip-stats.ts';

const trip = (id: string, startDate: string, endDate: string): TripSummary => ({ id, title: id, startDate, endDate });

describe('statystyki wyjazdów (Start)', () => {
  const trips = [
    trip('dinara', '2026-03-05', '2026-03-08'),
    trip('maroko', '2026-10-28', '2026-11-04'),
    trip('gruzja', '2026-11-20', '2026-11-27'),
    trip('chatka', '2027-01-10', '2027-01-12'),
    trip('sylwester', '2026-12-30', '2027-01-02'),
  ];

  it('trwający, nadchodzące, zakończone i najbliższy', () => {
    const stats = tripStats(trips, '2026-11-01');
    expect(stats.total).toBe(5);
    expect(stats.past).toBe(1);
    expect(stats.upcoming).toBe(3);
    expect(stats.ongoing).toMatchObject({ trip: { id: 'maroko' }, dayNo: 5, days: 8 });
    expect(stats.next).toMatchObject({ trip: { id: 'gruzja' }, inDays: 19, days: 8 });
  });

  it('dni: przebyte (z trwającym do dziś), zaplanowane i w tym roku', () => {
    const stats = tripStats(trips, '2026-11-01');
    expect(stats.daysTraveled).toBe(4 + 5);
    expect(stats.daysAhead).toBe(8 + 3 + 4);
    // 2026: dinara 4, maroko 8, gruzja 8, sylwester 30–31 grudnia 2.
    expect(stats.daysThisYear).toBe(22);
  });

  it('pierwszy i ostatni dzień wyjazdu liczą się jako trwające', () => {
    expect(tripStats(trips, '2026-10-28').ongoing?.dayNo).toBe(1);
    expect(tripStats(trips, '2026-11-04').ongoing?.dayNo).toBe(8);
    expect(tripStats(trips, '2026-11-05').ongoing).toBeNull();
  });

  it('bez wyjazdów same zera', () => {
    expect(tripStats([], '2026-11-01')).toMatchObject({ total: 0, ongoing: null, next: null, daysTraveled: 0 });
  });

  it('dzisiejsza data w strefie urządzenia', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
