import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BAD_COORDINATES, type BookingPlace, bookingPlace } from '../booking-place.ts';
import { placesOffMap } from '../coordinates.ts';
import { dayLodging } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const riad = maroko.places.find((place) => place.ref === 'p-riad')!;
const input = (name: string, coordinates = '') => ({ name, coordinates, title: 'Hotel z rezerwacji' });
const done = (result: BookingPlace | string) => {
  if (typeof result === 'string') throw new Error(result);
  return result;
};

describe('miejsce rezerwacji noclegu', () => {
  it('nowa nazwa ze współrzędnymi to nowe miejsce, pinezka użytkownika', () => {
    const result = done(bookingPlace(maroko, undefined, input('Hotel Atlas', '31.62951, -7.98112'), 'abc'));
    expect(result.placeRef).toBe('id-abc');
    expect(result.write).toMatchObject({ op: 'insert', place: { name: 'Hotel Atlas', lat: 31.62951, lng: -7.98112, provider: 'user' } });
    expect(result.places).toHaveLength(maroko.places.length + 1);
  });

  it('link z mapy działa jak liczby, a same współrzędne biorą nazwę rezerwacji', () => {
    const result = done(bookingPlace(maroko, undefined, input('', 'https://www.openstreetmap.org/#map=17/31.62/-7.98'), 'abc'));
    expect(result.write?.place).toMatchObject({ name: 'Hotel z rezerwacji', lat: 31.62, lng: -7.98 });
  });

  it('nazwa znana z planu wskazuje to samo miejsce, bez względu na wielkość liter', () => {
    const result = done(bookingPlace(maroko, undefined, input(riad.name.toUpperCase()), 'abc'));
    expect(result.placeRef).toBe(riad.ref);
    expect(result.write).toBeUndefined();
  });

  it('te same liczby niczego nie zapisują, a zmienione przenoszą miejsce', () => {
    const same = done(bookingPlace(maroko, riad.ref, input(riad.name, `${riad.lat}, ${riad.lng}`), 'abc'));
    expect(same.write).toBeUndefined();
    const moved = done(bookingPlace(maroko, riad.ref, input(riad.name, '31.1, -7.1'), 'abc'));
    expect(moved.write).toMatchObject({ op: 'update', place: { ref: riad.ref, lat: 31.1, lng: -7.1, provider: 'user' } });
  });

  it('puste pola odpinają miejsce, a błędne współrzędne dają komunikat', () => {
    expect(bookingPlace(maroko, riad.ref, input(''), 'abc')).toEqual({ placeRef: undefined, places: maroko.places });
    expect(bookingPlace(maroko, riad.ref, input(riad.name, 'https://maps.app.goo.gl/AbC'), 'abc')).toBe(BAD_COORDINATES);
  });

  it('nocleg z rezerwacji jest na mapie dnia, nawet gdy dzień ma inną bazę', () => {
    const edited = TripDocument.parse({
      ...maroko,
      places: [...maroko.places, { ref: 'p-nowy', name: 'Hotel Atlas', lat: 31.6, lng: -7.9, provider: 'user' }],
      bookings: maroko.bookings.map((booking) => (booking.ref === 'nocleg-riad' ? { ...booking, startPlaceRef: 'p-nowy' } : booking)),
      days: maroko.days.map((day) => (day.ref === 'd1' ? { ...day, baseRef: 'p-agafay' } : day)),
    });
    expect(dayLodging(edited, 'd1')).toMatchObject({ placeRef: 'p-nowy', name: 'Hotel Atlas', onMap: true });
  });

  it('miejsce noclegu bez współrzędnych trafia na listę do przypięcia', () => {
    const edited = TripDocument.parse({
      ...maroko,
      places: [...maroko.places, { ref: 'p-nowy', name: 'Hotel Atlas' }],
      bookings: [...maroko.bookings, { ref: 'b-nowa', kind: 'lodging', status: 'booked', title: 'Hotel Atlas, noc 1', startPlaceRef: 'p-nowy' }],
    });
    expect(placesOffMap(edited).find((place) => place.ref === 'p-nowy')?.usedBy).toEqual(['nocleg: Hotel Atlas, noc 1']);
  });
});
