import { describe, expect, it } from 'vitest';

import { TripDocument, type TripDocumentInput } from '../schemas/trip-document.ts';

/**
 * Dokument wyjazdu: kształt i spójność odwołań. Import, który zgubi powiązanie („ten punkt jest
 * w pakiecie tamtej rezerwacji”), ma się wywrócić tutaj, a nie po cichu w trakcie wyjazdu.
 */

const base = (): TripDocumentInput => ({
  schemaVersion: 1,
  trip: {
    title: 'Test',
    startDate: '2026-12-26',
    endDate: '2026-12-27',
    primaryTz: 'Africa/Casablanca',
    baseCurrency: 'PLN',
  },
  travelers: [{ ref: 'dorosly', name: 'Dorosły' }],
  days: [{ ref: 'd1', date: '2026-12-26', tz: 'Africa/Casablanca' }],
  bookings: [{ ref: 'oboz', kind: 'package', status: 'paid', title: 'Obóz Agafay' }],
  items: [
    { ref: 'wielblady', dayRef: 'd1', sortKey: '0010', kind: 'activity', title: 'Wielbłądy', bookingRef: 'oboz', payment: 'included' },
    { ref: 'majorelle', area: 'Marakesz', kind: 'visit', title: 'Ogród Majorelle', planStatus: 'does_not_fit' },
  ],
});

const issues = (input: unknown): string[] => {
  const result = TripDocument.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('TripDocument', () => {
  it('przyjmuje spójny dokument z pulą i pakietem', () => {
    expect(issues(base())).toEqual([]);
  });

  it('wyłapuje odwołanie do nieistniejącej rezerwacji', () => {
    const doc = base();
    doc.items![0]!.bookingRef = 'nie-ma';

    expect(issues(doc)).toEqual(['items.0.bookingRef: Nie ma elementu „nie-ma”.']);
  });

  it('wyłapuje odwołanie do elementu złego rodzaju', () => {
    const doc = base();
    doc.items![0]!.placeRef = 'oboz';

    expect(issues(doc)[0]).toContain('to bookings');
  });

  it('nie pozwala na dwa elementy z tym samym kluczem', () => {
    const doc = base();
    doc.travelers!.push({ ref: 'd1', name: 'Kolizja' });

    expect(issues(doc).join(' ')).toContain('jest już użyty');
  });

  it('punkt bez dnia nie może udawać zaplanowanego', () => {
    const doc = base();
    doc.items![1]!.planStatus = 'scheduled';

    expect(issues(doc).join(' ')).toContain('w puli');
  });

  it('tabela porównania wariantów musi mieć tyle wartości, ile kolumn', () => {
    const doc = base();
    doc.variantGroups = [
      {
        ref: 'uklad',
        scope: 'trip',
        title: 'Układ nocy',
        conditionKind: 'choice',
        chosenRef: 'a',
        comparison: { columns: ['Dzień 2', 'Najdłuższy dzień'], rows: [{ variantRef: 'a', values: ['Marakesz'] }] },
      },
    ];
    doc.variants = [{ ref: 'a', groupRef: 'uklad', label: 'A' }];

    expect(issues(doc).join(' ')).toContain('1 wartości, a tabela 2 kolumn');
  });

  it('szczegóły auta tylko przy wynajmie auta', () => {
    const doc = base();
    doc.bookings![0]!.car = { kmLimit: 680 };

    expect(issues(doc).join(' ')).toContain('wynajmem auta');
  });

  it('godzina względna od kotwicy dnia (wzór: „+1:20”)', () => {
    const doc = base();
    doc.items![0]!.time = { precision: 'relative', offsetMin: 80 };

    expect(issues(doc)).toEqual([]);
  });
});

/** Poprawki A1–A9 z PoC-0 — każda z przypadku, który wyszedł na prawdziwym planie. */
describe('poprawki z PoC-0', () => {
  it('A1: punkt w dniu przylotu może mieć godzinę w strefie wylotu', () => {
    const doc = base();
    doc.items![0]!.time = { precision: 'exact', start: '04:10', tz: 'Europe/Warsaw' };

    expect(issues(doc)).toEqual([]);
  });

  it('A2: czas względny liczy się domyślnie od kotwicy, a wzór użytkownika — od początku poprzedniego kroku', () => {
    const doc = base();
    doc.items![0]!.time = { precision: 'relative', offsetMin: 540, from: 'previous' };
    const parsed = TripDocument.parse(doc);
    const plain = TripDocument.parse({ ...base(), items: [{ ...base().items![0]!, time: { precision: 'relative', offsetMin: 80 } }] });

    expect(parsed.items[0]!.time).toMatchObject({ from: 'previous' });
    expect(plain.items[0]!.time).toMatchObject({ from: 'anchor' });
  });

  it('A3: punkt z dniem musi mieć sortKey, unikalny w dniu', () => {
    const missing = base();
    delete missing.items![0]!.sortKey;
    const duplicate = base();
    duplicate.items!.push({ ref: 'kolacja', dayRef: 'd1', sortKey: '0010', kind: 'meal', title: 'Kolacja' });

    expect(issues(missing).join(' ')).toContain('musi mieć sortKey');
    expect(issues(duplicate).join(' ')).toContain('ma już „wielblady”');
  });

  it('A4: przejazd z godziną to punkt transport ze szczegółami, nie zdublowany leg', () => {
    const doc = base();
    doc.places = [{ ref: 'lotnisko', name: 'BCN T2' }];
    doc.items!.push({
      ref: 'pociag',
      dayRef: 'd1',
      sortKey: '0005',
      kind: 'transport',
      title: 'Pociąg R2 Nord',
      time: { precision: 'approx', start: '09:30' },
      leg: { mode: 'train', line: 'R2 Nord', frequencyMin: 30, fromPlaceRef: 'lotnisko', alternative: { mode: 'bus', line: 'Aerobus' } },
    });
    const wrongKind = base();
    wrongKind.items![0]!.leg = { mode: 'walk' };

    expect(issues(doc)).toEqual([]);
    expect(issues(wrongKind).join(' ')).toContain('kind: transport');
  });

  it('A5: rezerwacja noclegu z samymi datami i koniec pakietu „ok. 10:00”', () => {
    const doc = base();
    doc.bookings![0]!.start = { date: '2026-12-27', time: '15:00', tz: 'Africa/Casablanca' };
    doc.bookings![0]!.end = { date: '2026-12-28', time: '10:00', precision: 'approx', tz: 'Africa/Casablanca' };
    doc.bookings!.push({
      ref: 'riad',
      kind: 'lodging',
      status: 'paid',
      title: 'Riad',
      start: { date: '2026-12-26', tz: 'Africa/Casablanca' },
      end: { date: '2026-12-27', tz: 'Africa/Casablanca' },
    });

    expect(issues(doc)).toEqual([]);
  });

  it('A6: status in_package już nie istnieje — pakiet to bookingRef + payment: included', () => {
    const doc = base();
    (doc.items![0] as { planStatus?: string }).planStatus = 'in_package';

    expect(issues(doc).length).toBeGreaterThan(0);
  });

  it('A7: dzień i punkt wskazują grupę kandydatów, kandydat — swój wariant', () => {
    const doc = base();
    doc.variantGroups = [{ ref: 'auto', scope: 'booking', title: 'Auto', conditionKind: 'choice' }];
    doc.variants = [{ ref: 'octavia', groupRef: 'auto', label: 'Škoda Octavia', recommended: true }];
    doc.bookings!.push({
      ref: 'sixt-octavia',
      kind: 'car_rental',
      status: 'candidate',
      title: 'Sixt — Octavia',
      variantGroupRef: 'auto',
      variantRef: 'octavia',
      recommended: true,
      addons: [{ title: 'Smart Protection', kind: 'insurance', recommended: true }],
    });
    doc.items!.push({ ref: 'zwrot', dayRef: 'd1', sortKey: '0090', kind: 'errand', title: 'Zwrot auta', bookingRef: 'auto' });
    doc.days![0]!.lodgingRef = 'oboz';

    expect(issues(doc)).toEqual([]);
  });

  it('A7: grupa wariantów, która nie porównuje rezerwacji, nie zastąpi rezerwacji', () => {
    const doc = base();
    doc.variantGroups = [{ ref: 'dzien', scope: 'day', title: 'Dzień', conditionKind: 'choice' }];
    doc.days![0]!.lodgingRef = 'dzien';

    expect(issues(doc).join(' ')).toContain('nie jest porównaniem rezerwacji');
  });

  it('A8: status rezerwacji „nie wiadomo” i „nie da się zarezerwować”', () => {
    const doc = base();
    doc.bookings!.push({ ref: 'lot', kind: 'flight', status: 'unknown', title: 'Lot' });
    doc.bookings!.push({ ref: 'chatka', kind: 'lodging', status: 'not_required', title: 'Chatka' });

    expect(issues(doc)).toEqual([]);
  });

  it('A9: wariant wyrzuca punkty, punkt zastępuje kilka innych', () => {
    const doc = base();
    doc.variantGroups = [{ ref: 'ciecie', scope: 'block', title: 'Cięcie', conditionKind: 'schedule_slip' }];
    doc.variants = [{ ref: 'jeden-zabytek', groupRef: doc.variantGroups[0]!.ref, label: 'Jeden zabytek', excludesRefs: ['wielblady'] }];
    doc.items!.push({ ref: 'dolina', area: 'Taghazout', kind: 'visit', title: 'Paradise Valley', planStatus: 'alternative', replacesRefs: ['wielblady', 'majorelle'] });

    expect(issues(doc)).toEqual([]);
  });
});
