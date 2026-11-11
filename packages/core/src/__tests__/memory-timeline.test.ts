import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GuideContent } from '../guide.ts';
import { memoryTimeline, shortText } from '../memory-timeline.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { tripMemories } from '../trip-memories.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const guide = (title: string): GuideContent => ({
  summary: `${title} to ważne miejsce. Warto tu przyjść rano. Trzecie zdanie jest dość długie i opowiada o historii miejsca, której nikt nie chce czytać na osi czasu, bo to tylko skrót opisu z przewodnika, a pełny opis jest na karcie punktu razem ze zdjęciami i ciekawostkami.`,
  facts: [],
  tips: [],
  images: [{ url: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`, thumbUrl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.jpg`, title, sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', author: 'Autor' }],
  article: { title, url: 'https://pl.wikipedia.org/wiki/X', lang: 'pl', site: 'wikipedia' },
});

describe('pamiątka jako oś czasu', () => {
  it('pięć planów: dni po kolei, punkty jak w liczbach pamiątki (bez noclegów), godziny rosną', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const timeline = memoryTimeline(doc, { done: [], skipRefs: [], guideOf: () => null, journal: [] });
      expect(timeline.days.map((day) => day.date)).toEqual([...doc.days].map((day) => day.date).sort());
      const stats = tripMemories(doc, { done: [], skipRefs: [] });
      const points = timeline.days.flatMap((day) => day.entries.map((entry) => (entry.kind === 'point' ? entry.ref : '')));
      const lodgings = stats.routeRefs.filter((ref) => doc.items.find((item) => item.ref === ref)?.kind === 'lodging');
      expect(points).toEqual(stats.routeRefs.filter((ref) => !lodgings.includes(ref)));
    }
  });

  it('dojazd na początku i powrót na końcu mają własne mapy, mapy dni zaczynają się na miejscu', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const timeline = memoryTimeline(doc, { done: [], skipRefs: [], guideOf: () => null, journal: [] });
      const approach = [...(timeline.outbound?.refs ?? []), ...(timeline.back?.refs ?? [])];
      for (const day of timeline.days) expect(day.routeRefs.filter((ref) => approach.includes(ref))).toEqual([]);
      // Punkty dojazdu zostają na liście swojego dnia.
      const listed = timeline.days.flatMap((day) => day.entries.map((entry) => (entry.kind === 'point' ? entry.ref : '')));
      for (const ref of approach) if (doc.items.find((item) => item.ref === ref)?.kind !== 'lodging') expect(listed).toContain(ref);
    }
    const maroko = memoryTimeline(fixture('maroko'), { done: [], skipRefs: [], guideOf: () => null, journal: [] });
    expect(maroko.outbound?.label).toBe('Dojazd');
    expect(maroko.back?.label).toBe('Powrót');
  });

  it('najważniejszy punkt ma skrót opisu i zdjęcie, wpisy dziennika: przy punkcie, po godzinie i bez dnia', () => {
    const doc = fixture('maroko');
    const first = memoryTimeline(doc, { done: [], skipRefs: [], guideOf: () => null, journal: [] });
    const day = first.days.find((each) => each.entries.filter((entry) => entry.kind === 'point' && entry.time !== undefined).length >= 2)!;
    const points = day.entries.flatMap((entry) => (entry.kind === 'point' ? [entry] : []));
    const sight = doc.items.find((item) => points.some((point) => point.ref === item.ref) && (item.kind === 'visit' || item.kind === 'activity'))!;
    const tz = doc.days.find((each) => each.ref === day.ref)!.tz;
    const second = points.filter((point) => point.time !== undefined)[1]!;
    // Chwila tuż po starcie drugiego punktu z godziną (w strefie dnia).
    const offset = (Date.parse(`${day.date}T12:00:00Z`) - Date.parse(new Date(`${day.date}T12:00:00Z`).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T') + 'Z'));
    const takenAt = Date.parse(`${day.date}T${second.time}:00Z`) + offset + 60_000;

    const timeline = memoryTimeline(doc, {
      done: [{ itemRef: sight.ref }],
      skipRefs: [],
      guideOf: (item) => (item.ref === sight.ref ? guide(item.title) : null),
      journal: [
        { id: 'a', dayRef: day.ref, itemRef: sight.ref, body: 'przy punkcie', takenAt: 0, photoUrl: 'https://x/a.jpg' },
        { id: 'b', dayRef: day.ref, body: 'po drugim punkcie', takenAt },
        { id: 'c', body: 'po powrocie', takenAt: 0 },
      ],
    });
    const entries = timeline.days.find((each) => each.ref === day.ref)!.entries;
    const point = entries.find((entry) => entry.kind === 'point' && entry.ref === sight.ref);
    expect(point).toMatchObject({ key: true, status: 'done', summary: `${sight.title} to ważne miejsce. Warto tu przyjść rano.`, image: { credit: 'Autor' } });
    expect(point?.kind === 'point' && point.journal.map((entry) => entry.id)).toEqual(['a']);
    const at = entries.findIndex((entry) => entry.kind === 'journal' && entry.id === 'b');
    const before = entries[at - 1]!;
    expect(before.time !== undefined && before.time <= second.time!).toBe(true);
    expect(entries.slice(at + 1).every((entry) => entry.time === undefined || entry.time >= entries[at]!.time!)).toBe(true);
    expect(timeline.loose.map((entry) => entry.id)).toEqual(['c']);
  });

  it('trekking: duża karta z profilem wysokości ze śladu GPX; ten sam ślad drugi raz bez profilu', () => {
    const doc = fixture('dinara');
    const first = memoryTimeline(doc, { done: [], skipRefs: [], guideOf: () => null, journal: [] });
    const withTrack = first.days.flatMap((day) => day.entries).flatMap((entry) => (entry.kind === 'point' ? [entry] : [])).filter((point) => doc.items.find((item) => item.ref === point.ref)?.activity?.trackRef !== undefined);
    expect(withTrack.length).toBeGreaterThan(0);
    expect(withTrack.every((point) => point.key && point.walk !== undefined && point.walk.profile === undefined)).toBe(true);

    const trackRef = doc.items.find((item) => item.ref === withTrack[0]!.ref)!.activity!.trackRef!;
    const line = { type: 'LineString' as const, coordinates: [[16.4, 44.06, 900], [16.41, 44.05, 1400], [16.42, 44.04, 1831], [16.43, 44.03, 1200]] };
    const second = { ...doc, tracks: doc.tracks.map((track) => (track.ref === trackRef ? { ...track, geojson: line } : track)) };
    // Drugi punkt z tym samym śladem (zejście).
    const host = second.items.find((item) => item.ref === withTrack[0]!.ref)!;
    const twin = { ...host, ref: `${host.ref}-zejscie`, title: 'Zejście' };
    second.items = [...second.items, twin];
    const timeline = memoryTimeline(second, { done: [], skipRefs: [], guideOf: () => null, journal: [] });
    const points = timeline.days.flatMap((day) => day.entries).flatMap((entry) => (entry.kind === 'point' && second.items.find((item) => item.ref === entry.ref)?.activity?.trackRef === trackRef ? [entry] : []));
    expect(points.length).toBeGreaterThan(1);
    expect(points[0]!.walk).toMatchObject({ minEle: 900, maxEle: 1831 });
    expect(points[0]!.walk!.profile).toHaveLength(120);
    expect(points.slice(1).every((point) => point.walk !== undefined && point.walk.profile === undefined)).toBe(true);
  });

  it('skrót: pełne zdania do limitu, zbyt długie pierwsze zdanie ucięte na słowie', () => {
    expect(shortText('Jedno. Dwa zdania tutaj. Trzy.', 20)).toBe('Jedno.');
    expect(shortText('Bardzo długie zdanie bez kropki aż do końca', 20)).toBe('Bardzo długie…');
    expect(shortText('Krótko.', 20)).toBe('Krótko.');
  });
});
