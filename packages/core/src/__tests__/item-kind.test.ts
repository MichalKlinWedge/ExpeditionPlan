import { describe, expect, it } from 'vitest';

import { itemIcon } from '../item-icon.ts';
import { hiredMode, isTransitItem, itemKindLabel, kindChoice, kindChoices, kindPatch, PUBLIC_MODES, publicMode, vehicleChoices, vehicleFor, vehicleMode } from '../item-kind.ts';
import type { TripDocument } from '../schemas/trip-document.ts';

const LABELS = { visit: 'zwiedzanie', transport: 'przejazd', meal: 'posiłek' };

describe('rodzaj punktu: transport publiczny', () => {
  it('nowy punkt jedzie domyślnie autobusem, a wybrany środek daje nazwę i ikonę', () => {
    expect(kindPatch(null, 'public')).toEqual({ kind: 'transport', leg: { mode: 'bus', links: [] } });
    const train = kindPatch({ kind: 'visit' }, 'public', 'train');
    expect(train).toEqual({ kind: 'transport', leg: { mode: 'train', links: [] } });
    expect(kindChoice(train)).toBe('public');
    expect(publicMode(train)).toBe('train');
    expect(itemKindLabel(train, LABELS)).toBe('pociąg');
    expect(itemIcon({ bookings: [] } as unknown as TripDocument, train as TripDocument['items'][number])).toBe('🚆');
    expect(PUBLIC_MODES.map(([mode]) => mode)).toEqual(['bus', 'tram', 'metro', 'train', 'ferry', 'cable_car']);
  });

  it('zapis bez zmiany zachowuje środek, a zmiana środka usuwa linię trasy z auta', () => {
    const metro = { mode: 'metro' as const, durationMin: 20, links: [] };
    expect(kindPatch({ kind: 'transport', leg: metro }, 'public').leg).toEqual(metro);
    const car = { mode: 'car' as const, durationMin: 40, routed: true, geometry: 'abc', links: [] };
    expect(kindPatch({ kind: 'transport', leg: car }, 'public', 'tram').leg).toEqual({ mode: 'tram', durationMin: 40, links: [] });
  });

  it('zmiana na samolot i z samolotu kasuje kilometry i czas drogi', () => {
    const car = { mode: 'car' as const, distanceKm: 2009, durationMin: 1200, line: 'A7', links: [] };
    expect(kindPatch({ kind: 'transport', leg: car }, 'public', 'flight').leg).toEqual({ mode: 'flight', line: 'A7', links: [] });
    const flight = { mode: 'flight' as const, distanceKm: 1700, durationMin: 150, links: [] };
    expect(kindPatch({ kind: 'transport', leg: flight }, 'public', 'train').leg).toEqual({ mode: 'train', links: [] });
  });

  it('powrót na „przejazd” daje auto, a taxi nie jest transportem publicznym', () => {
    expect(kindPatch({ kind: 'transport', leg: { mode: 'train', links: [] } }, 'transport').leg?.mode).toBe('car');
    expect(publicMode({ kind: 'transport', leg: { mode: 'taxi', links: [] } })).toBeUndefined();
  });

  it('samolot jest na liście transportu publicznego, ale nie jest komunikacją', () => {
    const flight = { kind: 'transport' as const, leg: { mode: 'flight' as const, durationMin: 150, links: [] } };
    expect(kindChoice(flight)).toBe('public');
    expect(vehicleMode(flight)).toBe('flight');
    expect(isTransitItem(flight)).toBe(false);
    expect(itemKindLabel(flight, LABELS)).toBe('samolot');
    expect(vehicleChoices('public')!.map(([mode]) => mode)).toContain('flight');
    expect(kindPatch({ kind: 'visit' }, 'public', 'flight')).toEqual({ kind: 'transport', leg: { mode: 'flight', links: [] } });
    expect(kindPatch(flight, 'public').leg).toEqual(flight.leg);
    expect(kindPatch(flight, 'transport').leg?.mode).toBe('car');
  });
});

describe('rodzaj punktu: taksówka / transfer', () => {
  it('nowy punkt to taksówka, bus z kierowcą to „transfer”, ikony z trybu', () => {
    expect(kindPatch(null, 'hired')).toEqual({ kind: 'transport', leg: { mode: 'taxi', links: [] } });
    const bus = kindPatch({ kind: 'visit' }, 'hired', 'hired_driver');
    expect(kindChoice(bus)).toBe('hired');
    expect(hiredMode(bus)).toBe('hired_driver');
    expect(itemKindLabel(bus, LABELS)).toBe('transfer');
    expect(itemKindLabel(kindPatch(null, 'hired'), LABELS)).toBe('taksówka');
    expect(itemIcon({ bookings: [] } as unknown as TripDocument, bus as TripDocument['items'][number])).toBe('🚐');
  });

  it('auto ↔ taksówka zostawia policzoną trasę, środek spoza listy daje pierwszy z niej', () => {
    const car = { mode: 'car' as const, durationMin: 40, routed: true, geometry: 'abc', links: [] };
    expect(kindPatch({ kind: 'transport', leg: car }, 'hired').leg).toEqual({ ...car, mode: 'taxi' });
    expect(kindPatch({ kind: 'transport', leg: { ...car, mode: 'taxi' } }, 'transport').leg).toEqual(car);
    expect(kindPatch({ kind: 'transport', leg: car }, 'hired', 'tram').leg?.mode).toBe('taxi');
    expect(vehicleFor('hired', 'tram')).toBe('taxi');
    expect(vehicleFor('public', 'tram')).toBe('tram');
    expect(vehicleFor('visit', 'tram')).toBeUndefined();
  });
});

describe('rodzaj punktu: trekking i pieszo', () => {
  it('lista ma trekking i pieszo zaraz za przejazdem', () => {
    expect(kindChoices(LABELS).map(([key]) => key)).toEqual(['visit', 'transport', 'public', 'hired', 'hike', 'walk', 'meal']);
  });

  it('trekking to przejazd z trybem pieszym: nazwa i ikona się zgadzają', () => {
    const patch = kindPatch({ kind: 'visit' }, 'hike');
    expect(patch).toEqual({ kind: 'transport', leg: { mode: 'hike', links: [] } });
    expect(kindChoice(patch)).toBe('hike');
    expect(itemKindLabel(patch, LABELS)).toBe('trekking');
    expect(itemIcon({ bookings: [] } as unknown as TripDocument, patch as TripDocument['items'][number])).toBe('🥾');
  });

  it('auto, które zostaje przejazdem, nie traci czasu ani linii', () => {
    const leg = { mode: 'car' as const, durationMin: 40, routed: true, geometry: 'abc', links: [] };
    expect(kindPatch({ kind: 'transport', leg }, 'transport').leg).toEqual(leg);
    expect(itemKindLabel({ kind: 'transport', leg }, LABELS)).toBe('przejazd');
    expect(kindChoice({ kind: 'transport', leg })).toBe('transport');
  });

  it('zmiana środka transportu zostawia czas jako szacunek i usuwa linię trasy', () => {
    const leg = { mode: 'car' as const, durationMin: 40, distanceKm: 30, routed: true, geometry: 'abc', links: [] };
    expect(kindPatch({ kind: 'transport', leg }, 'hike').leg).toEqual({ mode: 'hike', durationMin: 40, distanceKm: 30, links: [] });
    expect(kindPatch({ kind: 'transport', leg: { mode: 'hike', durationMin: 45, links: [] } }, 'transport').leg).toEqual({ mode: 'car', durationMin: 45, links: [] });
  });

  it('inny rodzaj nie ma szczegółów przejazdu, a przejazd bez nich zostaje bez nich', () => {
    expect(kindPatch({ kind: 'transport', leg: { mode: 'hike', links: [] } }, 'visit')).toEqual({ kind: 'visit', leg: undefined });
    expect(kindPatch(null, 'transport')).toEqual({ kind: 'transport', leg: { mode: 'car', links: [] } });
    expect(kindPatch({ kind: 'visit', leg: undefined }, 'transport')).toEqual({ kind: 'transport', leg: { mode: 'car', links: [] } });
    expect(kindPatch({ kind: 'transport', leg: undefined }, 'transport')).toEqual({ kind: 'transport', leg: { mode: 'car', links: [] } });
  });
});
