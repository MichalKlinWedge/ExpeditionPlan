import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemFacts, lodgingContacts } from '../item-facts.ts';
import { dayLodging } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const item = (ref: string) => maroko.items.find((each) => each.ref === ref)!;

describe('karta punktu w terenie', () => {
  it('przejazd: cena za całość z trasy, gotówka, uwaga do ceny', () => {
    const facts = itemFacts(maroko, item('d1-a7'));
    expect(facts.price?.replace(/\s/g, ' ')).toBe('ok. 70 MAD – 90 MAD za całość');
    expect(facts.payment).toBe('tylko gotówka');
    expect(facts.priceNote).toContain('gotówką');
    expect(facts.contacts).toEqual([]);
  });

  it('bilet wg wieku: kwota dla całej grupy (dorośli + nastolatek + dziecko)', () => {
    const facts = itemFacts(maroko, item('d2-medersa'));
    expect(facts.price).toContain('za 5 os. (wg wieku');
    expect(facts.price).toContain('210');
  });

  it('punkt z rezerwacją noclegu: rezerwacja i gospodarz; nocleg dnia ma te same kontakty', () => {
    const facts = itemFacts(maroko, item('d1-marakesz'));
    expect(facts.booking?.ref).toBe('nocleg-riad');
    expect(facts.contacts.map((contact) => contact.ref)).toContain('k-riad');
    expect(lodgingContacts(maroko, dayLodging(maroko, 'd1'))[0]?.role).toBe('host');
  });
});
