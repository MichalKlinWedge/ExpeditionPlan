import { describe, expect, it } from 'vitest';

import { zonedToInstant } from '../engine/time.ts';
import type { TrackLine, TrackPoint } from '../gpx.ts';
import { classifyOsm, placeOnTrack, trackPoisFromOsm } from '../track-pois.ts';
import { dinMinutes, planPace, profileSketch, trackDaylight, trackProfile, trackSections } from '../track-profile.ts';

/** Ślad na południe od Zakopanego: 4 km w górę o 600 m, potem 4 km w dół (punkt co ~100 m). */
const ridge = (): TrackLine => {
  const coordinates: TrackPoint[] = [];
  for (let i = 0; i <= 80; i++) {
    const ele = i <= 40 ? 1000 + i * 15 : 1600 - (i - 40) * 15;
    coordinates.push([19.95, 49.25 - i * 0.0009, ele]);
  }
  return { type: 'LineString', coordinates };
};

describe('profil i odcinki śladu', () => {
  it('profil: km od startu, najniżej i najwyżej', () => {
    const profile = trackProfile(ridge());
    expect(profile.hasElevation).toBe(true);
    expect(profile.minEle).toBe(1000);
    expect(profile.maxEle).toBe(1600);
    expect(profile.totalKm).toBeCloseTo(8, 0);
  });

  it('dwa odcinki: podejście i zejście, czasy wg DIN', () => {
    const sections = trackSections(ridge());
    expect(sections.map((section) => section.trend)).toEqual(['up', 'down']);
    expect(sections[0]!.ascentM).toBe(600);
    // 4 km w górę o 600 m: 2 h pionowo + połowa z 1 h poziomo = 150 min.
    expect(sections[0]!.minutes).toBeCloseTo(dinMinutes(sections[0]!.distanceKm, 600, 0), 5);
    expect(Math.round(sections[0]!.minutes)).toBe(150);
    // Powrót tym odcinkiem to zejście: 1,2 h w dół + połowa z 1 h poziomo = 102 min.
    expect(Math.round(sections[0]!.backMinutes)).toBe(102);
    expect(sections[1]!.startMin).toBeCloseTo(sections[0]!.endMin, 5);
  });

  it('ślad bez wysokości: odcinki co 5 km', () => {
    const line: TrackLine = { type: 'LineString', coordinates: Array.from({ length: 121 }, (_, i): TrackPoint => [19.95, 49.25 - i * 0.0009]) };
    const sections = trackSections(line);
    expect(sections.length).toBe(2);
    expect(sections.every((section) => section.trend === 'flat')).toBe(true);
  });

  it('tempo z planu: czas punktu do sumy odcinków, w granicach 0,5–2', () => {
    const sections = trackSections(ridge());
    const din = sections.reduce((sum, section) => sum + section.minutes, 0);
    expect(planPace(sections, Math.round(din * 1.2))).toBeCloseTo(1.2, 2);
    expect(planPace(sections, 10)).toBe(0.5);
    expect(planPace(sections, undefined)).toBe(1);
  });
});

describe('słońce na trasie', () => {
  const tz = 'Europe/Warsaw';

  it('rano: meta długo przed zachodem, zawracać nie trzeba', () => {
    const sections = trackSections(ridge());
    const light = trackDaylight(ridge(), sections, zonedToInstant('2026-07-10', '09:00', tz), tz);
    expect(light.startLocal).toBe('09:00');
    expect(light.marginMin).toBeGreaterThan(400);
    expect(light.turnaround).toBeNull();
    expect(light.startsAfterSunset).toBe(false);
    // Podejście jest wolniejsze niż zejście, więc do mety bliżej już przed połową trasy.
    expect(light.pointOfNoReturnKm).toBeGreaterThan(2);
    expect(light.pointOfNoReturnKm).toBeLessThan(4.5);
  });

  it('późne wyjście w listopadzie: meta po zachodzie i najpóźniejszy punkt zawrócenia', () => {
    const sections = trackSections(ridge());
    const light = trackDaylight(ridge(), sections, zonedToInstant('2026-11-10', '13:00', tz), tz);
    expect(light.marginMin).toBeLessThan(0);
    expect(light.turnaround).not.toBeNull();
    expect(light.turnaround!.km).toBeGreaterThan(0);
    expect(light.turnaround!.km).toBeLessThan(4);
    expect(light.turnaround!.atLocal > '13:00').toBe(true);
  });

  it('start po zachodzie', () => {
    const light = trackDaylight(ridge(), trackSections(ridge()), zonedToInstant('2026-11-10', '18:00', tz), tz);
    expect(light.startsAfterSunset).toBe(true);
    expect(light.turnaround).toBeNull();
  });
});

describe('woda, schroniska i zejścia przy śladzie', () => {
  it('rodzaje z tagów OSM; wiata przystanku to nie schronienie', () => {
    expect(classifyOsm({ natural: 'spring', drinking_water: 'no' })).toEqual({ kind: 'water', type: 'spring', potable: false });
    expect(classifyOsm({ amenity: 'drinking_water' })).toEqual({ kind: 'water', type: 'drinking_water', potable: true });
    expect(classifyOsm({ tourism: 'alpine_hut' })).toEqual({ kind: 'shelter', type: 'alpine_hut' });
    expect(classifyOsm({ amenity: 'shelter', shelter_type: 'public_transport' })).toBeNull();
    expect(classifyOsm({ place: 'village' })).toEqual({ kind: 'exit', type: 'village' });
    expect(classifyOsm({ amenity: 'bench' })).toBeNull();
  });

  it('km od startu, za daleko odpada, powtórki i nadmiar wiosek też', () => {
    const line = ridge();
    expect(placeOnTrack(line, { lat: 49.25 - 40 * 0.0009, lng: 19.95 }).km).toBeCloseTo(4, 0);
    const pois = trackPoisFromOsm(line, [
      { id: 'node/1', lat: 49.25 - 10 * 0.0009, lng: 19.951, tags: { natural: 'spring', name: 'Źródło' } },
      { id: 'node/2', lat: 49.25 - 10 * 0.0009, lng: 19.9512, tags: { natural: 'spring' } },
      { id: 'node/3', lat: 49.25 - 40 * 0.0009, lng: 19.955, tags: { tourism: 'alpine_hut', name: 'Schronisko' } },
      { id: 'node/4', lat: 49.25 - 20 * 0.0009, lng: 19.99, tags: { natural: 'spring' } },
      { id: 'node/5', lat: 49.25 - 70 * 0.0009, lng: 19.96, tags: { place: 'village', name: 'Dalsza' } },
      { id: 'node/6', lat: 49.25 - 70 * 0.0009, lng: 19.953, tags: { place: 'hamlet', name: 'Bliższa' } },
    ]);
    expect(pois.map((poi) => poi.osmId)).toEqual(['node/1', 'node/3', 'node/6']);
    expect(pois[0]!.name).toBe('Źródło');
    expect(pois[1]!.km).toBeCloseTo(4, 0);
  });
});

describe('zarys profilu do pokazu', () => {
  it('równo po kilometrach, najwyżej tyle punktów, z wysokością; ślad bez wysokości — brak', () => {
    const climb: TrackLine = { type: 'LineString', coordinates: Array.from({ length: 300 }, (_, i): TrackPoint => [19.95, 49.25 - i * 0.0009, 1000 + i * 2]) };
    const sketch = profileSketch(trackProfile(climb), 50)!;
    expect(sketch).toHaveLength(50);
    expect(sketch[0]!.km).toBe(0);
    expect(sketch[0]!.ele).toBe(1000);
    expect(sketch.at(-1)!.ele).toBeGreaterThan(1500);
    expect(sketch.every((point, at) => at === 0 || point.km > sketch[at - 1]!.km)).toBe(true);
    const flatLine: TrackLine = { type: 'LineString', coordinates: Array.from({ length: 20 }, (_, i): TrackPoint => [19.95, 49.25 - i * 0.0009]) };
    expect(profileSketch(trackProfile(flatLine))).toBeNull();
  });
});
