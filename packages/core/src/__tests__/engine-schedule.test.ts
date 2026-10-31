import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { priceForGroup } from '../engine/price.ts';
import { checkCarKmLimit, proposeCuts, scheduleDay, type ScheduleOptions } from '../engine/schedule.ts';
import { TripDocument, type TripDocumentInput } from '../schemas/trip-document.ts';

const fixture = (plan: string) =>
  TripDocument.parse(
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${plan}/plan.json`, import.meta.url)), 'utf8')),
  );

/** Dzień testowy w Marakeszu; punkty dopisuje każdy test. */
const doc = (items: TripDocumentInput['items'], extra: Partial<TripDocumentInput> = {}) =>
  TripDocument.parse({
    schemaVersion: 1,
    trip: { title: 'T', startDate: '2026-12-27', endDate: '2026-12-27', primaryTz: 'Africa/Casablanca', baseCurrency: 'PLN' },
    days: [{ ref: 'd1', date: '2026-12-27', tz: 'Africa/Casablanca', dayEnd: '22:00' }],
    items,
    ...extra,
  });

const times = (schedule: ReturnType<typeof scheduleDay>) =>
  Object.fromEntries(schedule.items.map((item) => [item.ref, `${item.startLocal}–${item.endLocal}`]));

const MARRAKESH: ScheduleOptions['coordinates'] = { lat: 31.6295, lng: -7.9811 };

describe('scheduleDay — podstawy', () => {
  it('liczy kolejne punkty z czasów trwania, buforów i godzin z planu', () => {
    const schedule = scheduleDay(
      doc([
        { ref: 'medersa', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Medersa', time: { precision: 'exact', start: '09:00' }, durationMin: 60, bufferAfterMin: 5 },
        { ref: 'spacer', dayRef: 'd1', sortKey: '0020', kind: 'transport', title: 'Przejście', leg: { mode: 'walk', durationMin: 25 } },
        { ref: 'bahia', dayRef: 'd1', sortKey: '0030', kind: 'visit', title: 'Bahia', time: { precision: 'approx', start: '10:30' }, durationMin: 60 },
      ]),
      'd1',
    );

    expect(times(schedule)).toEqual({ medersa: '09:00–10:00', spacer: '10:05–10:30', bahia: '10:30–11:30' });
    expect(schedule.warnings).toEqual([]);
  });

  it('przedział czasu trwania daje dwa scenariusze', () => {
    const day = doc([
      { ref: 'suki', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Suki', time: { precision: 'exact', start: '11:30' }, durationMin: 120, durationMaxMin: 180 },
    ]);

    expect(scheduleDay(day, 'd1', { scenario: 'optimistic' }).items[0]!.endLocal).toBe('13:30');
    expect(scheduleDay(day, 'd1', { scenario: 'pessimistic' }).items[0]!.endLocal).toBe('14:30');
  });

  it('„Zostajemy dłużej” przesuwa resztę dnia, a punkt ze stałą godziną zgłasza spóźnienie', () => {
    const day = doc([
      { ref: 'quady', dayRef: 'd1', sortKey: '0010', kind: 'activity', title: 'Quady', time: { precision: 'exact', start: '15:45' }, durationMin: 60 },
      { ref: 'kawa', dayRef: 'd1', sortKey: '0020', kind: 'free', title: 'Kawa', durationMin: 30 },
      { ref: 'wielblady', dayRef: 'd1', sortKey: '0030', kind: 'activity', title: 'Wielbłądy', time: { precision: 'exact', start: '17:15' }, durationMin: 60, isFixed: true },
    ]);

    const late = scheduleDay(day, 'd1', { delays: [{ itemRef: 'quady', minutes: 30 }] });

    expect(times(late).kawa).toBe('17:15–17:45');
    expect(times(late).wielblady).toBe('17:45–18:45');
    expect(late.warnings).toContainEqual(expect.objectContaining({ kind: 'late', itemRef: 'wielblady', severity: 'hard', minutes: 30 }));
    expect(late.slack).toBe('negative');
  });

  it('godzina poza godzinami otwarcia', () => {
    const schedule = scheduleDay(
      doc(
        [{ ref: 'bahia', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Bahia', placeRef: 'p-bahia', time: { precision: 'exact', start: '16:30' }, durationMin: 60 }],
        { places: [{ ref: 'p-bahia', name: 'Pałac Bahia', openingHours: '09:00–17:00' }] },
      ),
      'd1',
    );

    expect(schedule.warnings).toContainEqual(expect.objectContaining({ kind: 'closed', itemRef: 'bahia', minutes: 30 }));
  });

  it('bez jazdy po zmroku: dojazd kończący się po zmierzchu cywilnym łamie ograniczenie', () => {
    const day = doc(
      [
        { ref: 'wyjazd', dayRef: 'd1', sortKey: '0010', kind: 'transport', title: 'Dojazd do obozu', time: { precision: 'exact', start: '18:30' }, leg: { mode: 'rental_car', durationMin: 45 } },
      ],
      { constraints: [{ kind: 'no_driving_after_dark', dayRef: 'd1', severity: 'hard' }] },
    );

    const schedule = scheduleDay(day, 'd1', { coordinates: MARRAKESH });

    expect(schedule.warnings.map((warning) => warning.kind)).toEqual(expect.arrayContaining(['driving_after_dark', 'constraint']));
    expect(schedule.slack).toBe('negative');
  });

  it('bez współrzędnych nie udaje, że sprawdził zachód słońca', () => {
    const day = doc(
      [{ ref: 'spacer', dayRef: 'd1', sortKey: '0010', kind: 'activity', title: 'Spacer', time: { precision: 'exact', start: '16:00' }, durationMin: 60 }],
      { constraints: [{ kind: 'finish_before_sunset', itemRef: 'spacer', severity: 'hard' }] },
    );

    expect(scheduleDay(day, 'd1').warnings).toContainEqual(expect.objectContaining({ kind: 'no_coordinates' }));
  });
});

describe('scheduleDay — na Twoich planach', () => {
  it('Dinara, sobota: „0:00 wyjazd, +1:20 wyjście, Trasa (9h), +9:00 powrót, +1:30 Szybenik”', () => {
    const schedule = scheduleDay(fixture('dinara'), 'd2', { anchorTime: '06:00' });
    const at = times(schedule);

    expect(at['wyjazd-szybenik']).toBe('06:00–07:15');
    expect(at['dinara-wyjscie']).toMatch(/^07:20/);
    expect(at['dinara-ferrata']).toBe('07:20–16:20');
    expect(at['powrot-auto-dinara']).toMatch(/^16:20/);
    expect(at['przyjazd-szybenik']).toMatch(/^17:50/);
  });

  it('Dinara, sobota bez ustalonej godziny zero: przyjmuje koniec śniadania i mówi o tym', () => {
    const schedule = scheduleDay(fixture('dinara'), 'd2');

    expect(schedule.warnings).toContainEqual(expect.objectContaining({ kind: 'anchor_missing' }));
    expect(times(schedule)['dinara-wyjscie']).toMatch(/^06:50/);
  });

  it('Dinara, piątek: wyjazd 16:30 + 1:40 jazdy nie zdąży na ferratę o 18:00', () => {
    const schedule = scheduleDay(fixture('dinara'), 'd1');

    expect(schedule.warnings).toContainEqual(expect.objectContaining({ kind: 'late', minutes: 10 }));
  });

  it('Gruzja, dzień 1: wylot 15:40 czasu polskiego to 17:40 w Gruzji, przylot 21:10 na miejscu', () => {
    const at = times(scheduleDay(fixture('gruzja'), 'd1'));

    expect(at['d1-wylot']).toMatch(/^17:40/);
    expect(at['d1-przylot']).toMatch(/^21:10/);
  });

  it('Gruzja, dzień 2: dojazd przed „w Mestii ok. 13:00” liczony wstecz — start o 10:00', () => {
    expect(times(scheduleDay(fixture('gruzja'), 'd2'))['d2-dojazd-mestia']).toBe('10:00–13:00');
  });

  it('Chatka, sobota: ekipy pracują równolegle w bloku 14:15–16:00, a spacer zdąży przed zachodem', () => {
    const schedule = scheduleDay(fixture('chatka'), 'd1');
    const at = times(schedule);

    expect(at['ekipa-drewno']).toBe('14:15–16:00');
    expect(at['ekipa-latryna']).toBe('14:15–16:00');
    expect(at['spacer-rozpoznawczy']).toBe('16:00–17:00');
    expect(schedule.facts.dst).toEqual({ fromOffsetMin: 120, toOffsetMin: 60 });
    expect(schedule.warnings.filter((warning) => warning.severity === 'hard')).toEqual([]);
  });

  it('Maroko, dzień 2: po 4 h w Pałacu Bahia wyjazd łamie „nie po 15:00”, a cięcie Bahii to naprawia', () => {
    const plan = fixture('maroko');
    const options: ScheduleOptions = { delays: [{ itemRef: 'd2-bahia', minutes: 240 }] };

    const schedule = scheduleDay(plan, 'd2', options);
    const cuts = proposeCuts(plan, 'd2', options);

    expect(schedule.warnings).toContainEqual(expect.objectContaining({ kind: 'constraint', itemRef: 'd2-wyjazd', severity: 'hard' }));
    expect(cuts.at(-1)).toMatchObject({ itemRef: 'd2-bahia', resolves: true });
    expect(cuts.every((cut) => cut.itemRef !== 'd2-wyjazd')).toBe(true);
  });

  it('Maroko: suma kilometrów dni wobec limitu auta', () => {
    expect(checkCarKmLimit(fixture('maroko'))).toMatchObject({ totalKm: 675, limitKm: 680, overKm: 0 });
  });

  it('Maroko: Pałac Bahia dla piątki to 450 MAD — trzech dorosłych bez wieku policzonych jak dorośli', () => {
    const plan = fixture('maroko');
    const bahia = plan.items.find((item) => item.ref === 'd2-bahia')!;

    const price = priceForGroup(bahia.price!, plan.travelers);

    expect(price.minMinor).toBe(45_000);
    expect(price.unknownAgeRefs).toHaveLength(3);
  });
});

/**
 * Bramka PoC-5: silnik odtwarza godziny z Twoich pięciu planów w granicach ±15 min, w obu
 * scenariuszach, bez twardych naruszeń. Rozjazdy do 15 min to prawdziwe niespójności dokumentów
 * (np. lunch 12:45 trwający 1,5 h przed „murami o 14:00”) — są w `POC_WYNIKI.md`.
 */
describe('bramka PoC-5: plany referencyjne', () => {
  const plans = ['maroko', 'gruzja', 'barcelona', 'chatka', 'dinara'];

  it.each(plans)('%s: każdy dzień w ±15 min od planu i bez twardych naruszeń', (plan) => {
    const document = fixture(plan);
    const problems: string[] = [];

    for (const day of document.days) {
      for (const scenario of ['optimistic', 'pessimistic'] as const) {
        const schedule = scheduleDay(document, day.ref, { scenario });
        for (const item of schedule.items) {
          if (item.driftMin > 15) problems.push(`${day.ref}/${scenario}: ${item.title} +${item.driftMin} min`);
        }
        for (const warning of schedule.warnings) {
          if (warning.severity === 'hard') problems.push(`${day.ref}/${scenario}: ${warning.message}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('proposeCuts', () => {
  it('tnie najpierw opcjonalne według cutRank, nigdy „must”, aż dzień się spina', () => {
    const day = doc([
      { ref: 'a', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Muzeum', time: { precision: 'exact', start: '18:00' }, durationMin: 90, priority: 'must' },
      { ref: 'b', dayRef: 'd1', sortKey: '0020', kind: 'visit', title: 'Taras', durationMin: 60, priority: 'should', cutRank: 1 },
      { ref: 'c', dayRef: 'd1', sortKey: '0030', kind: 'visit', title: 'Sklep', durationMin: 45, priority: 'optional', cutRank: 2 },
      { ref: 'd', dayRef: 'd1', sortKey: '0040', kind: 'meal', title: 'Kolacja', durationMin: 60 },
    ]);

    const cuts = proposeCuts(day, 'd1');

    // Dzień kończy się 22:15 przy końcu o 22:00: najpierw wylatuje „optional”, mimo wyższego cutRank.
    expect(cuts.map((cut) => cut.itemRef)).toEqual(['c']);
    expect(cuts[0]).toMatchObject({ resolves: true, freesMin: 45 });
  });

  it('dzień, który się spina, nie dostaje propozycji cięć', () => {
    expect(proposeCuts(fixture('chatka'), 'd1')).toEqual([]);
  });
});
