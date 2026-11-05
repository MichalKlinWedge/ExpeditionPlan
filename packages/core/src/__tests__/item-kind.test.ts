import { describe, expect, it } from 'vitest';

import { itemIcon } from '../item-icon.ts';
import { itemKindLabel, kindChoice, kindChoices, kindPatch, PUBLIC_MODES, publicMode } from '../item-kind.ts';
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

  it('powrót na „przejazd” daje auto, a lot i taxi nie są transportem publicznym', () => {
    expect(kindPatch({ kind: 'transport', leg: { mode: 'train', links: [] } }, 'transport').leg?.mode).toBe('car');
    expect(kindChoice({ kind: 'transport', leg: { mode: 'flight', links: [] } })).toBe('transport');
    expect(kindChoice({ kind: 'transport', leg: { mode: 'taxi', links: [] } })).toBe('transport');
    expect(itemKindLabel({ kind: 'transport', leg: { mode: 'flight', links: [] } }, LABELS)).toBe('przejazd');
  });
});

describe('rodzaj punktu: trekking i pieszo', () => {
  it('lista ma trekking i pieszo zaraz za przejazdem', () => {
    expect(kindChoices(LABELS).map(([key]) => key)).toEqual(['visit', 'transport', 'public', 'hike', 'walk', 'meal']);
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
