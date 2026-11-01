import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCoordinates, placesOffMap } from '../coordinates.ts';
import { TripDocument } from '../schemas/trip-document.ts';

describe('przypinanie miejsca: współrzędne z wklejonego tekstu', () => {
  it.each([
    ['31.6295, -7.9811', { lat: 31.6295, lng: -7.9811 }],
    ['31.6295 -7.9811', { lat: 31.6295, lng: -7.9811 }],
    ['31,6295; -7,9811', { lat: 31.6295, lng: -7.9811 }],
    ['https://www.google.com/maps/place/Agafay/@31.4421,-8.1923,13z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d31.4501!4d-8.2012', { lat: 31.4501, lng: -8.2012 }],
    ['https://www.google.com/maps/@31.4421,-8.1923,15z', { lat: 31.4421, lng: -8.1923 }],
    ['https://maps.google.com/?q=31.62,-7.98', { lat: 31.62, lng: -7.98 }],
    ['https://www.google.com/maps/search/?api=1&query=31.62%2C-7.98', { lat: 31.62, lng: -7.98 }],
    ['https://www.openstreetmap.org/?mlat=31.62&mlon=-7.98#map=17/31.6/-7.9', { lat: 31.62, lng: -7.98 }],
    ['https://www.openstreetmap.org/#map=17/31.62/-7.98', { lat: 31.62, lng: -7.98 }],
    ['geo:31.62,-7.98?z=17', { lat: 31.62, lng: -7.98 }],
  ])('%s', (text, expected) => {
    expect(parseCoordinates(text)).toEqual(expected);
  });

  it('nie zgaduje: tekst, krótki link, liczby spoza zakresu, 0,0', () => {
    expect(parseCoordinates('obóz Agafay')).toBeNull();
    expect(parseCoordinates('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(parseCoordinates('131.6, -7.9')).toBeNull();
    expect(parseCoordinates('0, 0')).toBeNull();
  });
});

describe('miejsca planu bez współrzędnych', () => {
  it('plan wzorcowy Maroka: lista z punktami, które ich używają', () => {
    const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
    const off = placesOffMap(maroko);
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((place) => place.usedBy.length > 0)).toBe(true);
    expect(off.map((place) => place.name)).toContain('Obóz na pustyni Agafay');
  });
});
