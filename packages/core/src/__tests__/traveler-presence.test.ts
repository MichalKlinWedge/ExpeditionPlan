import { describe, expect, it } from 'vitest';

import { travelerDates } from '../traveler-presence.ts';

const trip = { startDate: '2027-07-10', endDate: '2027-07-20' };

describe('travelerDates', () => {
  it('puste pola to cały wyjazd', () => {
    expect(travelerDates('', '', trip)).toEqual({ fromDate: null, toDate: null });
    expect(travelerDates(undefined, undefined, trip)).toEqual({ fromDate: null, toDate: null });
  });

  it('początek i koniec wyjazdu nie są zapisywane', () => {
    expect(travelerDates('2027-07-10', '2027-07-20', trip)).toEqual({ fromDate: null, toDate: null });
    expect(travelerDates('2027-07-12', '2027-07-20', trip)).toEqual({ fromDate: '2027-07-12', toDate: null });
    expect(travelerDates('2027-07-10', '2027-07-15', trip)).toEqual({ fromDate: null, toDate: '2027-07-15' });
  });

  it('odrzuca odwrócony zakres i daty poza wyjazdem', () => {
    expect(travelerDates('2027-07-15', '2027-07-12', trip)).toHaveProperty('error');
    expect(travelerDates('2027-07-09', undefined, trip)).toHaveProperty('error');
    expect(travelerDates(undefined, '2027-07-21', trip)).toHaveProperty('error');
  });
});
