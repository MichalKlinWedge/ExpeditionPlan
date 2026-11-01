import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AiClient } from '@expeditionplan/ai';
import { type LogisticsCandidates, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { logisticsCandidates, logisticsContext, mergeLogistics, party, rentalKm, searchLinks } from '../logistics.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

const candidate = (label: string, extra: Partial<LogisticsCandidates['groups'][number]['candidates'][number]> = {}) => ({
  label,
  priceMinMinor: 80_000,
  priceMaxMinor: 120_000,
  currency: 'MAD',
  priceBasis: 'per_night' as const,
  conditions: ['darmowe odwołanie'],
  includes: ['śniadanie'],
  pros: ['blisko placu'],
  cons: [],
  values: ['800–1200 MAD', 'tak'],
  recommended: false,
  searchQuery: 'riad Marrakech medina family room',
  ...extra,
});

const draft: LogisticsCandidates = {
  groups: [
    {
      kind: 'lodging',
      title: 'Nocleg w Marakeszu 26–27.12',
      area: 'medyna Marakeszu',
      start: '2026-12-26',
      end: '2026-12-27',
      mustHave: 'pokój dla 5 osób',
      columns: ['Cena za noc', 'Odwołanie'],
      candidates: [candidate('Riad w medynie', { recommended: true }), candidate('Hotel w Gueliz', { recommended: true })],
    },
    {
      kind: 'car_rental',
      title: 'Auto z lotniska Agadir',
      area: 'lotnisko Agadir',
      columns: ['Cena', 'Limit km'],
      candidates: [candidate('Mini z automatem, limit 200 km/dzień', { priceBasis: 'per_day', kmLimit: 200 }), candidate('Kompakt bez limitu')],
    },
  ],
  advice: [],
};

describe('etap 4 — kandydaci do porównania', () => {
  it('kontekst: skład grupy, noce w bazach, km jazdy wynajętym autem, rzeczy już ustalone', () => {
    const context = logisticsContext(maroko, null);
    expect(context.party.adults + context.party.children.length).toBe(maroko.travelers.length);
    expect(context.nights.length).toBe(maroko.days.length - 1);
    expect(context.driving.rentalKm).toBe(rentalKm(maroko));
  });

  it('jeden polecany w grupie; limit km auta wobec planu', async () => {
    const client: AiClient = { defaultProvider: 'GEMINI', ask: async () => ({ text: JSON.stringify(draft), provider: 'GEMINI', model: 'test' }), listModels: async () => [] };
    const { info, checks } = await logisticsCandidates(maroko, null, { client });
    // Plan Maroka już porównuje auta (Sixt) — druga grupa aut wypada.
    expect(info.groups.map((group) => group.kind)).toEqual(['lodging']);
    expect(info.groups[0]!.candidates.map((each) => each.recommended)).toEqual([true, false]);
    expect(checks).toEqual([]);
    // 200 km/dzień × 5 dni = 1000 km — plan Maroka ma mniej, więc bez ostrzeżenia; mały limit już tak.
    const tight = { ...info, groups: [{ ...draft.groups[1]!, candidates: [candidate('Mini', { kmLimit: 50 }), candidate('Kompakt')] }] };
    const { logisticsChecks } = await import('../logistics.ts');
    expect(logisticsChecks(maroko, tight)[0]).toContain('limit 250 km');
  });

  it('link do Booking.com z datami i składem grupy; bez rezerwacji', () => {
    const links = searchLinks(draft.groups[0]!, draft.groups[0]!.candidates[0]!, party(maroko));
    const url = new URL(links[0]!.url);
    expect(url.hostname).toBe('www.booking.com');
    expect(url.searchParams.get('checkin')).toBe('2026-12-26');
    expect(url.searchParams.get('group_children')).toBe(String(party(maroko).children.length));
  });

  it('wybrane grupy → grupa porównania z tabelą, warianty i kandydaci; dokument poprawny', () => {
    let n = 0;
    const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    const { doc, created } = mergeLogistics(maroko, { ...draft, groups: draft.groups.map((group) => ({ ...group, candidates: group.candidates.map((each, i) => ({ ...each, recommended: i === 0 })) })) }, [0], id);
    expect(created.map((entry) => entry.collection)).toEqual(['variantGroups', 'variants', 'variants', 'bookings', 'bookings']);
    const group = doc.variantGroups.at(-1)!;
    expect(group).toMatchObject({ scope: 'booking', title: 'Nocleg w Marakeszu 26–27.12', conditionText: 'pokój dla 5 osób' });
    expect(group.comparison!.rows[0]!.values).toEqual(['800–1200 MAD', 'tak']);
    const booking = doc.bookings.at(-2)!;
    expect(booking).toMatchObject({ status: 'candidate', kind: 'lodging', variantGroupRef: group.ref, price: { approx: true, minMinor: 80_000 } });
    expect(booking.links[0]!.url).toContain('booking.com');
    expect(() => TripDocument.parse(doc)).not.toThrow();
  });
});
