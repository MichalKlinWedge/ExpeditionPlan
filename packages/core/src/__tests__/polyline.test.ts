import { describe, expect, it } from 'vitest';

import { decodePolyline, distanceM, encodePolyline, type LngLat, simplifyPath } from '../polyline.ts';

describe('polilinia trasy', () => {
  // Przykład z opisu formatu Google: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
  const points: LngLat[] = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]];
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('koduje i dekoduje jak format Google (precyzja 5)', () => {
    expect(encodePolyline(points)).toBe(encoded);
    expect(decodePolyline(encoded)).toEqual(points);
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(encodePolyline([[-7.98912, 31.62947]]))).toEqual([[-7.98912, 31.62947]]);
  });

  it('uszkodzony napis daje punkty do miejsca uszkodzenia', () => {
    expect(decodePolyline(encoded.slice(0, -2))).toEqual(points.slice(0, 2));
  });

  it('odległość po kuli: stopień południka ≈ 111 km', () => {
    expect(distanceM([0, 0], [0, 1]) / 1000).toBeCloseTo(111.2, 0);
  });

  it('upraszczanie zostawia zakręty i końce, wyrzuca punkty na prostej', () => {
    // Prosta na wschód, co ~11 m punkt z drganiem 1 m, potem zakręt na północ.
    const straight: LngLat[] = Array.from({ length: 50 }, (_, i) => [i * 0.0001, i % 2 === 0 ? 0 : 0.00001]);
    const turn: LngLat[] = [...straight, [0.0049, 0.005]];
    const simple = simplifyPath(turn, 5);
    expect(simple[0]).toEqual(turn[0]);
    expect(simple.at(-1)).toEqual(turn.at(-1));
    expect(simple.length).toBeLessThanOrEqual(4);
    expect(simplifyPath(turn, 0).length).toBe(turn.length);
    expect(simplifyPath([[1, 1]], 5)).toEqual([[1, 1]]);
  });
});
