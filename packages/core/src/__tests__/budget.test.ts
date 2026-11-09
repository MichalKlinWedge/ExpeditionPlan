import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { budgetPace, budgetSummary, formatMoney, lineTravelerNames, parseMoney, TripDocument, walletSummary } from '../index.ts';

const load = (slug: string) =>
  TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('budżet: zapłacone / do wydania', () => {
  it('Maroko: 7 519 zł zapłacone, ~3 915–5 555 zł do wydania (kryterium odbioru MVP-3)', () => {
    const summary = budgetSummary(load('maroko'));
    expect(summary.currency).toBe('PLN');
    expect(summary.paidMinor).toBe(751_930);
    expect(summary.toSpendLowMinor).toBe(391_500);
    expect(summary.toSpendHighMinor).toBe(555_500);
    expect(summary.totalHighMinor).toBe(751_930 + 555_500);
    expect(summary.byCategory[0]?.category).toBe('flights');
    expect(summary.unconverted).toEqual({});
  });

  it('pozycja „na osobę” liczy się razy liczba uczestników', () => {
    const doc = load('dinara');
    const summary = budgetSummary(doc);
    // Samolot 400 zł na osobę × 5 + reszta 1340 zł.
    expect(summary.toSpendLowMinor).toBe(40_000 * doc.travelers.length + 134_000);
    expect(summary.perPersonLowMinor).toBe(Math.round(summary.totalLowMinor / doc.travelers.length));
  });

  it('portfel przelicza po kursie z planu, waluta bez kursu zostaje osobno', () => {
    const doc = load('maroko');
    const wallet = walletSummary(doc, [
      { amountMinor: 10_000, currency: 'MAD', category: 'food' },
      { amountMinor: 5_000, currency: 'PLN', category: 'food' },
      { amountMinor: 2_000, currency: 'GBP' },
    ]);
    expect(wallet.spentMinor).toBe(4_300 + 5_000);
    expect(wallet.byCategory).toEqual({ food: 9_300 });
    expect(wallet.unconverted).toEqual({ GBP: 2_000 });
  });

  it('kwoty: zapis i odczyt', () => {
    expect(parseMoney('1 270,50')).toBe(127_050);
    expect(parseMoney('45')).toBe(4_500);
    expect(parseMoney('abc')).toBeNull();
    // Polska norma nie grupuje liczb czterocyfrowych („7519”), pięciocyfrowe już tak.
    expect(formatMoney(751_930, 'PLN').replace(/\s/g, ' ')).toBe('7519,30 zł');
    expect(formatMoney(1_200_000, 'PLN').replace(/\s/g, ' ')).toBe('12 000 zł');
  });
});

describe('budżet: pozycja dla części osób', () => {
  const base = load('dinara');
  const [a, b, ...others] = base.travelers.map((traveler) => traveler.ref);
  const people = base.travelers.length;
  const line = { category: 'other', status: 'estimate', currency: base.trip.baseCurrency, perPerson: false } as const;
  const withLines = (...lines: Partial<(typeof base.budgetLines)[number]>[]) =>
    TripDocument.parse({ ...base, budgetLines: lines.map((each, i) => ({ ...line, ref: `linia-${i}`, title: `Pozycja ${i}`, lowMinor: 0, highMinor: 0, ...each })) });
  const share = (summary: ReturnType<typeof budgetSummary>, ref: string) => summary.perTraveler.find((each) => each.ref === ref)!;

  it('bez wyboru osób nic się nie zmienia: średnia zostaje, każdemu wypada tyle samo', () => {
    const summary = budgetSummary(withLines({ lowMinor: 100 * people, highMinor: 200 * people }, { lowMinor: 50, highMinor: 50, perPerson: true }));
    expect(summary.totalLowMinor).toBe(150 * people);
    expect(summary.perPersonLowMinor).toBe(150);
    expect(summary.perPersonHighMinor).toBe(250);
    expect(summary.perTraveler.every((each) => each.lowMinor === 150 && each.highMinor === 250)).toBe(true);
  });

  it('pozycja łączna dla dwóch osób: suma ta sama, dzieli się tylko na nie, a średniej nie ma', () => {
    const summary = budgetSummary(withLines({ lowMinor: 1_000, highMinor: 2_000, participantRefs: [a!, b!] }));
    expect(summary.totalLowMinor).toBe(1_000);
    expect(summary.totalHighMinor).toBe(2_000);
    expect(summary.perPersonLowMinor).toBeNull();
    expect(share(summary, a!)).toMatchObject({ lowMinor: 500, highMinor: 1_000 });
    expect(share(summary, others[0]!)).toMatchObject({ lowMinor: 0, highMinor: 0 });
  });

  it('„na osobę” mnoży się przez wybrane osoby, nie przez wszystkich', () => {
    const summary = budgetSummary(withLines({ lowMinor: 300, highMinor: 300, perPerson: true, participantRefs: [a!, b!] }));
    expect(summary.totalLowMinor).toBe(600);
    expect(share(summary, b!).lowMinor).toBe(300);
    expect(share(summary, others[0]!).lowMinor).toBe(0);
  });

  it('udziały sumują się do całości, także gdy kwota nie dzieli się równo', () => {
    const summary = budgetSummary(withLines({ lowMinor: 1_000, highMinor: 1_000 }, { lowMinor: 700, highMinor: 900, participantRefs: [a!, b!] }, { lowMinor: 100, highMinor: 100, perPerson: true, participantRefs: [b!] }));
    const sum = summary.perTraveler.reduce((total, each) => total + each.highMinor, 0);
    expect(Math.abs(sum - summary.totalHighMinor)).toBeLessThanOrEqual(people);
    expect(share(summary, b!).highMinor).toBeGreaterThan(share(summary, a!).highMinor);
  });

  it('pozycja zapłacona ma w udziałach tę samą kwotę co w sumach', () => {
    const summary = budgetSummary(withLines({ lowMinor: 400, highMinor: 900, status: 'paid', participantRefs: [a!] }));
    expect(summary.totalHighMinor).toBe(400);
    expect(share(summary, a!).highMinor).toBe(400);
  });

  it('dwie pozycje dające każdemu po tyle samo nie psują średniej', () => {
    const rest = base.travelers.slice(1).map((traveler) => traveler.ref);
    const summary = budgetSummary(withLines({ lowMinor: 100, highMinor: 100, participantRefs: [a!] }, { lowMinor: 100 * rest.length, highMinor: 100 * rest.length, participantRefs: rest }));
    expect(summary.perPersonLowMinor).toBe(100);
  });

  it('imiona pozycji: tylko przy części osób', () => {
    const doc = withLines({ participantRefs: [a!] }, {}, { participantRefs: base.travelers.map((traveler) => traveler.ref) });
    expect(lineTravelerNames(doc.travelers, doc.budgetLines[0]!)).toEqual([base.travelers[0]!.name]);
    expect(lineTravelerNames(doc.travelers, doc.budgetLines[1]!)).toBeNull();
    expect(lineTravelerNames(doc.travelers, doc.budgetLines[2]!)).toBeNull();
  });

  it('odwołanie do nieistniejącej osoby nie przechodzi walidacji', () => {
    expect(TripDocument.safeParse({ ...base, budgetLines: [{ ...line, ref: 'linia', title: 'X', lowMinor: 1, highMinor: 1, participantRefs: ['nie-ma'] }] }).success).toBe(false);
  });

  it('zadatek jest zapłacony, do wydania zostaje reszta; całość i udziały bez zmian', () => {
    const doc = withLines({ status: 'committed', lowMinor: 500_000, highMinor: 600_000, depositMinor: 100_000, participantRefs: [a!, b!] });
    const summary = budgetSummary(doc);
    expect(summary.paidMinor).toBe(100_000);
    expect(summary.toSpendLowMinor).toBe(400_000);
    expect(summary.toSpendHighMinor).toBe(500_000);
    expect(summary.totalLowMinor).toBe(500_000);
    expect(share(summary, a!).lowMinor).toBe(250_000);
    // Tempo wydatków w trakcie nie liczy zadatku zapłaconego wcześniej.
    expect(budgetPace(doc, [], doc.trip.startDate).categories.find((each) => each.category === 'other')?.plannedLowMinor).toBe(400_000);
  });

  it('zadatek większy od kwoty liczy się najwyżej jako cała kwota, a przy „zapłacone” nie liczy się wcale', () => {
    expect(budgetSummary(withLines({ lowMinor: 1000, highMinor: 2000, depositMinor: 5000 }))).toMatchObject({ paidMinor: 1000, toSpendLowMinor: 0, toSpendHighMinor: 1000 });
    expect(budgetSummary(withLines({ status: 'paid', lowMinor: 1000, highMinor: 1000, depositMinor: 300 }))).toMatchObject({ paidMinor: 1000, toSpendLowMinor: 0 });
  });
});
