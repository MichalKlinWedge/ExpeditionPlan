import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { answeredDays, bestTerms, DatePoll, groupTally, pollDays, votesFromRows, type Votes, votingGroups } from '../votes.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('głosowanie nad wariantami', () => {
  const doc = fixture('barcelona');

  it('wiersze bazy na klucze planu; usunięte i nieznane pomija, brak wariantu = wszystko jedno', () => {
    const refOf = new Map([
      ['t1', 'u1'],
      ['t2', 'u2'],
      ['g1', 'vg-niedziela-rano'],
      ['v1', 'v-opcja-a'],
    ]);
    const votes = votesFromRows(
      [
        { traveler_id: 't1', variant_group_id: 'g1', variant_id: 'v1', deleted_at: null },
        { traveler_id: 't2', variant_group_id: 'g1', variant_id: null, deleted_at: null },
        { traveler_id: 't2', variant_group_id: 'g1', variant_id: 'v1', deleted_at: '2026-11-01T00:00:00Z' },
        { traveler_id: 'obcy', variant_group_id: 'g1', variant_id: 'v1', deleted_at: null },
        { traveler_id: 't1', day: '2027-01-15', answer: 'maybe', deleted_at: null },
      ],
      refOf,
    );
    expect(votes.variants).toEqual([
      { travelerRef: 'u1', groupRef: 'vg-niedziela-rano', variantRef: 'v-opcja-a' },
      { travelerRef: 'u2', groupRef: 'vg-niedziela-rano', variantRef: null },
    ]);
    expect(votes.days).toEqual([{ travelerRef: 'u1', date: '2027-01-15', answer: 'maybe' }]);
  });

  it('wynik: kto na co, obojętni, brakujący i prowadzący; remis to dwa prowadzące', () => {
    expect(votingGroups(doc).map((group) => group.ref)).toEqual(['vg-plecaki', 'vg-font-magica', 'vg-niedziela-rano']);
    const one: Votes = { variants: [{ travelerRef: 'u1', groupRef: 'vg-niedziela-rano', variantRef: 'v-opcja-b' }], days: [] };
    const tally = groupTally(doc, 'vg-niedziela-rano', one);
    expect(tally.options.map((option) => [option.variantRef, option.voters.length])).toEqual([
      ['v-opcja-a', 0],
      ['v-opcja-b', 1],
    ]);
    expect(tally.leaders).toEqual(['v-opcja-b']);
    expect(tally.missing).toEqual(['Uczestnik 2']);

    const tie: Votes = { variants: [...one.variants, { travelerRef: 'u2', groupRef: 'vg-niedziela-rano', variantRef: 'v-opcja-a' }], days: [] };
    expect(groupTally(doc, 'vg-niedziela-rano', tie).leaders).toEqual(['v-opcja-a', 'v-opcja-b']);
    const indifferent: Votes = { variants: [{ travelerRef: 'u2', groupRef: 'vg-niedziela-rano', variantRef: null }], days: [] };
    expect(groupTally(doc, 'vg-niedziela-rano', indifferent)).toMatchObject({ leaders: [], indifferent: ['Uczestnik 2'], missing: ['Uczestnik 1'] });
  });
});

describe('ankieta terminu', () => {
  const doc = fixture('barcelona');
  const poll = DatePoll.parse({ from: '2027-01-01', to: '2027-01-07' });
  const day = (travelerRef: string, date: string, answer: 'yes' | 'maybe' | 'no') => ({ travelerRef, date, answer });

  it('okno: dni po kolei, najwyżej 4 miesiące, koniec nie przed początkiem', () => {
    expect(pollDays(poll)).toHaveLength(7);
    expect(DatePoll.safeParse({ from: '2027-01-07', to: '2027-01-01' }).success).toBe(false);
    expect(DatePoll.safeParse({ from: '2027-01-01', to: '2027-08-01' }).success).toBe(false);
  });

  it('najlepszy termin: najmniej „nie mogę”, potem najwięcej pewnych, potem wcześniejszy', () => {
    const votes: Votes = {
      variants: [],
      days: [
        ...pollDays(poll).map((date) => day('u1', date, date === '2027-01-02' ? 'no' : 'yes')),
        ...pollDays(poll).map((date) => day('u2', date, date <= '2027-01-04' ? 'maybe' : 'yes')),
      ],
    };
    const terms = bestTerms(doc, poll, votes, 3);
    expect(terms[0]).toMatchObject({ start: '2027-01-05', end: '2027-01-07', yes: ['Uczestnik 1', 'Uczestnik 2'], blocked: [] });
    expect(terms[1]).toMatchObject({ start: '2027-01-03', maybe: ['Uczestnik 2'] });
    expect(terms.slice(0, 3).every((term) => term.blocked.length === 0)).toBe(true);
    expect(terms[3]!.blocked).toEqual(['Uczestnik 1']);
    expect(bestTerms(doc, poll, votes, 3, 2)).toHaveLength(2);
    expect(answeredDays(poll, votes, 'u1')).toBe(7);
  });

  it('bez odpowiedzi osoba jest „nieznana”, nie blokuje', () => {
    const terms = bestTerms(doc, poll, { variants: [], days: [day('u1', '2027-01-01', 'yes')] }, 1);
    expect(terms[0]).toMatchObject({ start: '2027-01-01', yes: ['Uczestnik 1'], unknown: ['Uczestnik 2'] });
  });
});
