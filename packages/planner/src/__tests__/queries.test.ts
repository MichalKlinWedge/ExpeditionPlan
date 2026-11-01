import { describe, expect, it } from 'vitest';

import { boxAround, candidateQueries, distanceKm, medianPoint, skipReason, tooCoarse } from '../queries.ts';

describe('zapytania do geokodera', () => {
  it('z dopisków w nawiasach bierze nazwy, a nie wysokości i linie metra', () => {
    expect(candidateQueries({ ref: 's', name: 'Szybenik (Šibenik)' })).toEqual(['Szybenik (Šibenik)', 'Szybenik', 'Šibenik']);
    expect(candidateQueries({ ref: 'd', name: 'Dinara (1831 m n.p.m.)' })).toEqual(['Dinara (1831 m n.p.m.)', 'Dinara']);
    expect(candidateQueries({ ref: 'j', name: 'Jaume I (metro L4)' })).toEqual(['Jaume I (metro L4)', 'Jaume I']);
  });

  it('nazwę lokalną z podpowiedzi próbuje najpierw, a dopisek po myślniku odcina', () => {
    expect(candidateQueries({ ref: 'x', name: 'Sixt — biuro w terminalu' }, ['Agadir Al Massira Airport'])).toEqual([
      'Agadir Al Massira Airport',
      'Sixt — biuro w terminalu',
      'Sixt',
    ]);
  });

  it('nie szuka miejsc prywatnych ani dwóch miejsc w jednej nazwie', () => {
    expect(skipReason({ ref: 'n', name: 'Nocleg u znajomej (okolice Jaume I)' })).not.toBeNull();
    expect(skipReason({ ref: 'b', name: 'Barça Store — La Rambla albo Portal de l’Àngel' })).not.toBeNull();
    expect(skipReason({ ref: 'm', name: 'Medersa Ben Youssefa' })).toBeNull();
  });

  it('hotel znaleziony jako miejscowość to trafienie zbyt ogólne, plaża przy wsi — nie', () => {
    expect(tooCoarse('lodging', 'place')).toBe(true);
    expect(tooCoarse('beach', 'place')).toBe(false);
    expect(tooCoarse('monument', 'tourism')).toBe(false);
  });
});

describe('geometria', () => {
  it('odległość Marakesz — Essaouira ok. 160 km', () => {
    expect(distanceKm({ lat: 31.6258, lng: -7.9892 }, { lat: 31.5118, lng: -9.7621 })).toBeCloseTo(168, -1);
  });

  it('mediana jest odporna na jedną pomyłkę', () => {
    const center = medianPoint([
      { lat: 50.27, lng: 16.53 },
      { lat: 50.26, lng: 16.52 },
      { lat: 53.33, lng: 14.7 },
    ]);
    expect(center).toEqual({ lat: 50.27, lng: 16.52 });
  });

  it('prostokąt wokół punktu ma zadany „promień”', () => {
    const box = boxAround({ lat: 50, lng: 16 }, 111);
    expect(box.north - box.south).toBeCloseTo(2, 5);
  });
});
