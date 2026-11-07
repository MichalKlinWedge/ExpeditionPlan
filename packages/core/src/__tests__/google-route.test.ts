import { describe, expect, it } from 'vitest';

import { googleRouteVias, isGoogleDirections, isGoogleShortLink } from '../google-route.ts';

describe('punkty pośrednie z linku do trasy w Mapach Google', () => {
  it('rozwinięty link bez punktów pośrednich: pusta lista', () => {
    const url = 'https://www.google.com/maps/dir/42.17835,42.49101/42.16129,42.36811/@42.1732543,42.3476637,12z/data=!3m1!4b1!4m2!4m1!3e0?entry=tts';
    expect(isGoogleDirections(url)).toBe(true);
    expect(googleRouteVias(url)).toEqual([]);
  });

  it('przystanek współrzędnymi i przeciągnięty punkt trasy; nazwa miejsca pominięta', () => {
    const url = 'https://www.google.com/maps/dir/42.17835,42.49101/42.2,42.45/Samtredia/42.16129,42.36811/@42.17,42.34,12z/data=!4m14!4m13!1m5!3m4!1m2!1d42.47!2d42.18!3s0x0:0x0!1m0!1m0!1m0!3e0';
    expect(googleRouteVias(url)).toEqual([
      [42.45, 42.2],
      [42.47, 42.18],
    ]);
  });

  it('udokumentowany format api=1: waypoints rozdzielone „|”', () => {
    const url = 'https://www.google.com/maps/dir/?api=1&origin=42.1,42.4&destination=42.2,42.3&waypoints=42.15%2C42.35%7CKutaisi&travelmode=driving';
    expect(googleRouteVias(url)).toEqual([[42.35, 42.15]]);
  });

  it('skrócony link trzeba rozwinąć; inny adres to nie trasa Google', () => {
    expect(isGoogleShortLink('https://maps.app.goo.gl/KbKYv2PaaZ1PUAq4A')).toBe(true);
    expect(isGoogleShortLink('https://goo.gl/maps/abc')).toBe(true);
    expect(isGoogleShortLink('https://goo.gl/abc')).toBe(false);
    expect(googleRouteVias('https://maps.app.goo.gl/KbKYv2PaaZ1PUAq4A')).toBeNull();
    expect(googleRouteVias('https://mapy.com/fnc/v1/route?start=1,2&end=3,4')).toBeNull();
    expect(googleRouteVias('https://evil.example/maps/dir/1,2/3,4/5,6')).toBeNull();
  });
});
