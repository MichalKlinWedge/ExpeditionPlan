import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dayLodging, dayMap, isTransit, formatMinutes, legLabel, mapCoverage, missingOnMap } from '../plan-info.ts';
import { encodePolyline, type LngLat } from '../polyline.ts';
import { DocItem, TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
const transport = (leg: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  DocItem.parse({ ref: 't', kind: 'transport', title: 'Przejazd', leg: { mode: 'rental_car', ...leg }, ...extra });

describe('opis mapy w planie', () => {
  it('czas po ludzku', () => {
    expect(formatMinutes(84)).toBe('1 h 24 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
  });

  it('przejazd: trasa z mapy, szacunek albo czas wpisany ręcznie', () => {
    expect(legLabel(transport({ durationMin: 84, durationMaxMin: 109, distanceKm: 63.6, routed: true }))).toBe('64 km · 1 h 24 min, w gorszym razie 1 h 49 min (trasa z mapy)');
    expect(legLabel(transport({ durationMin: 20, distanceKm: 1.7, routed: true }))).toBe('1,7 km · 20 min (trasa z mapy)');
    expect(legLabel(transport({ durationMin: 75, distanceKm: 70 }))).toBe('ok. 1 h 15 min, ok. 70 km (szacunek)');
    expect(legLabel(transport({ durationMin: 75, routed: true }, { durationMin: 90 }))).toBe('1 h 30 min (wpisane ręcznie)');
    expect(legLabel(transport({}))).toBeNull();
  });

  it('pokrycie mapy planu wzorcowego: miejsca bez współrzędnych i przejazdy bez trasy', () => {
    const coverage = mapCoverage(maroko);
    expect(coverage.places.total).toBeGreaterThan(coverage.places.onMap);
    expect(coverage.legs).toMatchObject({ routed: 0 });
    expect(coverage.legs.routable).toBeGreaterThan(0);
    const unplaced = maroko.items.find((item) => missingOnMap(maroko, item));
    expect(unplaced).toBeDefined();
  });
});

describe('nocleg dnia', () => {
  it('baza dnia z rezerwacją tej nocy; zameldowanie tylko pierwszej nocy; ostatni dzień bez noclegu', () => {
    expect(dayLodging(maroko, 'd1')).toEqual({
      placeRef: 'p-riad',
      name: 'Riad Lakhdar',
      booking: expect.objectContaining({ ref: 'nocleg-riad' }),
      onMap: true,
    });
    // Obóz to pakiet z noclegiem; miejsce bez współrzędnych.
    expect(dayLodging(maroko, 'd2')).toMatchObject({ placeRef: 'p-agafay', booking: { ref: 'nocleg-agafay', checkInFrom: '15:00' }, onMap: false });
    expect(dayLodging(maroko, 'd5')).toBeNull();
  });

  it('bez bazy dnia — miejsce z rezerwacji; odwołana rezerwacja się nie liczy', () => {
    const noBase = TripDocument.parse({ ...maroko, days: maroko.days.map((day) => (day.ref === 'd1' ? { ...day, baseRef: undefined } : day)) });
    expect(dayLodging(noBase, 'd1')).toMatchObject({ placeRef: 'p-riad', booking: { ref: 'nocleg-riad' } });
    const cancelled = TripDocument.parse({ ...noBase, bookings: noBase.bookings.map((booking) => (booking.ref === 'nocleg-riad' ? { ...booking, status: 'cancelled' } : booking)) });
    expect(dayLodging(cancelled, 'd1')).toBeNull();
  });
});

describe('mapa dnia', () => {
  const d2 = ['d2-wyjscie', 'd2-medersa', 'd2-do-bahii', 'd2-bahia', 'd2-suki-dzien', 'd2-lunch'];

  it('numery w kolejności dnia, przejazd numerowany w celu, to samo miejsce = jedna pinezka', () => {
    const map = dayMap(maroko, d2, { baseRef: 'p-agafay' });
    expect(map.numbers).toEqual({ 'd2-wyjscie': 1, 'd2-medersa': 2, 'd2-do-bahii': 3, 'd2-bahia': 4, 'd2-suki-dzien': 5 });
    expect(map.pins.map((pin) => pin.placeRef)).toEqual(['p-riad', 'p-medersa', 'p-bahia', 'p-jemaa']);
    expect(map.pins.find((pin) => pin.placeRef === 'p-bahia')!.stops.map((stop) => stop.n)).toEqual([3, 4]);
    // Medersa → (przejazd z Medersy) → Bahia: bez powtórzonego punktu na linii.
    expect(map.lines).toEqual([{ routed: false, coordinates: expect.any(Array) }]);
    expect(map.lines[0]!.coordinates).toHaveLength(4);
    // Baza dnia 2 (Agafay) nie ma współrzędnych — nie ma jej na mapie.
    expect(map.pins.some((pin) => pin.base)).toBe(false);
  });

  it('dojazd i powrót (lot, przejazd ponad 250 km) da się ukryć — numery się nie zmieniają', () => {
    const item = (ref: string) => maroko.items.find((each) => each.ref === ref)!;
    expect(isTransit(maroko, item('d1-lotnisko-wro'))).toBe(true);
    expect(isTransit(maroko, item('d5-wylot'))).toBe(true);
    expect(isTransit(maroko, item('d1-a7'))).toBe(false);
    const d1 = dayMap(maroko, maroko.items.filter((each) => each.dayRef === 'd1').map((each) => each.ref), { baseRef: 'p-riad' });
    expect(d1.pins.filter((pin) => pin.transit).map((pin) => pin.placeRef)).toEqual(['p-wro']);
    expect(d1.lines.filter((line) => line.transit)).toHaveLength(1);
    expect(d1.numbers['d1-lotnisko-wro']).toBe(1);
    const d5 = dayMap(maroko, maroko.items.filter((each) => each.dayRef === 'd5').map((each) => each.ref));
    // Powrót: lotnisko w Agadirze (tylko odprawa i wylot) i Wrocław; zwrot auta (Sixt) zostaje.
    expect(d5.pins.filter((pin) => pin.transit).map((pin) => pin.placeRef)).toEqual(['p-aga', 'p-wro']);
    expect(d5.pins.find((pin) => pin.placeRef === 'p-sixt-aga')?.transit).toBeUndefined();
  });

  it('baza dnia i punkty z puli w miejscach ze współrzędnymi', () => {
    const map = dayMap(maroko, ['d2-medersa'], { baseRef: 'p-riad', pool: true });
    expect(map.pins.find((pin) => pin.placeRef === 'p-riad')!.base).toBe(true);
    // Dzień kończy się linią do noclegu.
    expect(map.lines.at(-1)!.coordinates.at(-1)).toEqual(at('p-riad'));
    const pooled = maroko.items.filter((item) => item.dayRef === undefined && item.placeRef !== undefined && !missingOnMap(maroko, item));
    expect(map.pins.flatMap((pin) => pin.pool ?? []).map((each) => each.ref).sort()).toEqual(pooled.map((item) => item.ref).sort());
  });

  const at = (ref: string): LngLat => {
    const place = maroko.places.find((each) => each.ref === ref)!;
    return [place.lng!, place.lat!];
  };
  const withRoute = (geometry: LngLat[]) =>
    TripDocument.parse({
      ...maroko,
      items: maroko.items.map((item) => (item.ref === 'd2-do-bahii' ? { ...item, leg: { ...item.leg!, routed: true, geometry: encodePolyline(geometry) } } : item)),
    });

  it('przejazd z linią trasy rysuje się po drogach, reszta prosto', () => {
    const [medersa, bahia] = [at('p-medersa'), at('p-bahia')];
    const road: LngLat[] = [medersa, [medersa[0] + 0.002, medersa[1] - 0.004], [bahia[0] - 0.001, bahia[1] + 0.001], bahia];
    const map = dayMap(withRoute(road), d2);
    expect(map.lines.map((line) => line.routed)).toEqual([false, true, false]);
    expect(map.lines[0]!.coordinates).toEqual([at('p-riad'), medersa]);
    expect(map.lines[1]!.coordinates).toHaveLength(4);
    expect(map.lines[2]!.coordinates).toEqual([bahia, at('p-jemaa')]);
    // Numery i pinezki bez zmian.
    expect(map.numbers['d2-do-bahii']).toBe(3);
  });

  it('linia trasy z innej kolejności (końce daleko od miejsc) ustępuje prostej', () => {
    const elsewhere: LngLat[] = [[-7.5, 31.2], [-7.6, 31.3]];
    const map = dayMap(withRoute(elsewhere), d2);
    expect(map.lines.every((line) => !line.routed)).toBe(true);
    expect(map.lines[0]!.coordinates).toHaveLength(4);
  });

  it('własna pinezka (provider: user) da się przesunąć, miejsca z bazy nie', () => {
    const doc = TripDocument.parse({ ...maroko, places: maroko.places.map((place) => (place.ref === 'p-bahia' ? { ...place, provider: 'user' } : place)) });
    const pins = dayMap(doc, d2).pins;
    expect(pins.find((pin) => pin.placeRef === 'p-bahia')!.movable).toBe(true);
    expect(pins.find((pin) => pin.placeRef === 'p-medersa')!.movable).toBeUndefined();
  });
});
