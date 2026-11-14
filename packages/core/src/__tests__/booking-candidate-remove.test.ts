import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { removeCandidate, removeComparison } from '../booking-candidate-remove.ts';
import { documentProblem } from '../plan-edits.ts';
import { groupVariants } from '../plan-rules.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const root = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));
const plans = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name: slug }) => ({ slug, doc: TripDocument.parse(JSON.parse(readFileSync(`${root}${slug}/plan.json`, 'utf8'))) }));

describe('usunięcie propozycji z porównania rezerwacji', () => {
  it('każda propozycja z fixture’ów: dokument zostaje spójny, bez odwołań do usuniętych; zarezerwowanej nie usuwa', () => {
    let removed = 0;
    let ended = 0;
    for (const { slug, doc } of plans) {
      for (const group of doc.variantGroups.filter((each) => each.scope === 'booking')) {
        for (const variant of groupVariants(doc, group.ref)) {
          const result = removeCandidate(doc, group.ref, variant.ref);
          if ('error' in result) {
            expect(doc.bookings.some((booking) => booking.variantRef === variant.ref && (booking.status === 'booked' || booking.status === 'paid')), `${slug} ${variant.ref}: ${result.error}`).toBe(true);
            continue;
          }
          removed++;
          expect(documentProblem(result.doc), `${slug} ${variant.ref}`).toBeNull();
          expect(result.doc.variants.some((each) => each.ref === variant.ref)).toBe(false);
          for (const ref of result.removedBookingRefs) expect(JSON.stringify(result.doc)).not.toContain(`"${ref}"`);
          expect(result.writes.some((write) => write.collection === 'variants' && write.op === 'remove' && write.element.ref === variant.ref)).toBe(true);
          if (result.ended) {
            ended++;
            expect(result.doc.variantGroups.some((each) => each.ref === group.ref)).toBe(false);
            expect(JSON.stringify(result.doc)).not.toContain(`"${group.ref}"`);
          }
        }
      }
    }
    expect(removed).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(0);
  });

  it('całe porównanie z fixture’ów: znika grupa, warianty i kandydaci; dokument spójny', () => {
    let removed = 0;
    for (const { slug, doc } of plans) {
      for (const group of doc.variantGroups.filter((each) => each.scope === 'booking')) {
        const result = removeComparison(doc, group.ref);
        if ('error' in result) throw new Error(`${slug} ${group.ref}: ${result.error}`);
        removed++;
        expect(documentProblem(result.doc), `${slug} ${group.ref}`).toBeNull();
        expect(JSON.stringify(result.doc)).not.toContain(`"${group.ref}"`);
        for (const variant of groupVariants(doc, group.ref)) expect(JSON.stringify(result.doc)).not.toContain(`"${variant.ref}"`);
        for (const ref of result.removedBookingRefs) expect(JSON.stringify(result.doc)).not.toContain(`"${ref}"`);
        expect(result.writes.at(-1)).toMatchObject({ collection: 'variantGroups', op: 'remove', element: { ref: group.ref } });
      }
    }
    expect(removed).toBeGreaterThan(0);
  });

  it('całe porównanie z zarezerwowaną propozycją: ona zostaje zwykłą rezerwacją, punkty wskazujące porównanie — ją', () => {
    const maroko = plans.find((each) => each.slug === 'maroko')!.doc;
    const booked = { ...maroko, bookings: maroko.bookings.map((booking) => (booking.ref === 'auto-sixt-octavia' ? { ...booking, status: 'booked' as const } : booking)) };
    const result = removeComparison(booked, 'auto');
    if ('error' in result) throw new Error(result.error);
    expect(documentProblem(result.doc)).toBeNull();
    expect(result.keptBookingRefs).toEqual(['auto-sixt-octavia']);
    expect(result.removedBookingRefs).toHaveLength(8);
    const octavia = result.doc.bookings.find((booking) => booking.ref === 'auto-sixt-octavia')!;
    expect(octavia.variantGroupRef).toBeUndefined();
    expect(octavia.variantRef).toBeUndefined();
    expect(result.doc.items.find((item) => item.ref === 'd1-odbior-auta')?.bookingRef).toBe('auto-sixt-octavia');
    expect(result.doc.variantGroups.some((each) => each.ref === 'auto')).toBe(false);
  });
});
