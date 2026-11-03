import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hikingMinutes, parseGpx, simplifyTrack, trackFromGpx, trackPosition, type TrackPoint } from '../gpx.ts';
import { dayMap } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

/** Ślad na północ: 101 punktów co ~111 m (0,001° szerokości), 1000 → 1100 m i z powrotem do 1050 m. */
const north: TrackPoint[] = Array.from({ length: 101 }, (_, i) => [15.7, 50.7 + i * 0.001, i <= 50 ? 1000 + i * 2 : 1100 - (i - 50)]);
const gpx = (points: TrackPoint[], tag = 'trkpt') =>
  `<?xml version="1.0"?><gpx><trk><name>Spalona &amp; Chatka</name><trkseg>${points
    .map((p) => `<${tag} lon="${p[0]}" lat="${p[1]}">${p[2] === undefined ? '' : `<ele>${p[2]}</ele>`}<time>2026-01-01T10:00:00Z</time></${tag}>`)
    .join('\n')}</trkseg></trk></gpx>`;

describe('GPX', () => {
  it('odczyt trkpt (atrybuty w dowolnej kolejności), nazwa z encjami, rtept gdy brak trkpt', () => {
    const track = parseGpx(gpx(north));
    expect(track.name).toBe('Spalona & Chatka');
    expect(track.points).toHaveLength(101);
    expect(track.points[0]).toEqual([15.7, 50.7, 1000]);
    expect(parseGpx(gpx(north.slice(0, 3), 'rtept')).points).toHaveLength(3);
    expect(parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2"/></trkseg></trk></gpx>').points).toEqual([[2, 1], [2, 1.1]]);
    expect(() => parseGpx('<gpx></gpx>')).toThrow();
  });

  it('statystyki: dystans, podejścia z progiem szumu, czas DIN 33466', () => {
    const { stats, line, name } = trackFromGpx(gpx(north));
    expect(name).toBe('Spalona & Chatka');
    expect(stats.distanceKm).toBeCloseTo(11.1, 1);
    expect(stats.ascentM).toBe(100);
    expect(stats.descentM).toBe(50);
    expect(stats.durationMin).toBe(hikingMinutes(stats.distanceKm, 100, 50));
    // Prosta linia — zostają końce i załamanie wysokości nie ma znaczenia dla kształtu.
    expect(line.coordinates.length).toBeLessThan(10);
    expect(hikingMinutes(4, 0, 0)).toBe(60);
    expect(hikingMinutes(4, 600, 0)).toBe(150);
  });

  it('uproszczenie trzyma limit punktów', () => {
    const zigzag: TrackPoint[] = Array.from({ length: 5000 }, (_, i) => [15.7 + (i % 2) * 0.0005, 50.7 + i * 0.0001]);
    expect(simplifyTrack(zigzag, 500).length).toBeLessThanOrEqual(500);
  });

  it('położenie na śladzie: odległość od linii, przebyte i pozostałe km, podejścia przed nami', () => {
    const line = { type: 'LineString' as const, coordinates: north };
    const at = trackPosition(line, { lat: 50.725, lng: 15.7015 });
    expect(at.offTrackM).toBeGreaterThan(90);
    expect(at.offTrackM).toBeLessThan(120);
    expect(at.doneKm).toBeCloseTo(2.8, 1);
    expect(at.leftKm).toBeCloseTo(8.3, 1);
    expect(at.leftAscentM).toBe(50);
  });

  it('mapa dnia rysuje ślad aktywności raz', () => {
    const chatka = load('chatka');
    const day = chatka.items.find((item) => item.ref === 'szpica-wyjscie')!.dayRef!;
    const withLine = { ...chatka, tracks: chatka.tracks.map((track) => (track.ref === 'trasa-chatka' ? { ...track, geojson: { type: 'LineString' as const, coordinates: north } } : track)) };
    const refs = withLine.items.filter((item) => item.dayRef === day).map((item) => item.ref);
    const lines = dayMap(withLine, refs).lines.filter((line) => line.track);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.coordinates[0]).toEqual([15.7, 50.7]);
  });
});
