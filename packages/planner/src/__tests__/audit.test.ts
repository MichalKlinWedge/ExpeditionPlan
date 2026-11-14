import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StoredAudit, tripReadiness, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { auditContext, auditPrompt, numberedAudit, openFindings } from '../audit.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const today = '2026-11-14';

describe('kontrola wyjazdu — kontekst i prompt', () => {
  const issues = tripReadiness(maroko, today);
  const context = auditContext(maroko, new Set(), issues, today);

  it('dni z nocą, rezerwacje z punktami i braki z kodu', () => {
    expect(context.days.map((day) => day.ref)).toEqual(maroko.days.map((day) => day.ref));
    expect(context.days.every((day) => typeof day.night === 'string')).toBe(true);
    const flight = context.bookings.find((booking) => booking.ref === 'lot-tam')!;
    expect(flight.items).toEqual(expect.arrayContaining(['d1-lotnisko-wro', 'd1-przylot']));
    expect(context.codeIssues.length).toBe(issues.length);
    expect(context.dates.start).toBe(maroko.trip.startDate);
  });

  it('prompt z prośbą organizatora i schematem', () => {
    const prompt = auditPrompt(maroko, new Set(), issues, today, 'dzieci');
    expect(prompt).toContain('Organizator prosi szczególnie: dzieci');
    expect(prompt).toContain('"findings"');
  });
});

describe('kontrola wyjazdu — wynik', () => {
  it('numeruje uwagi, gubi zmyślone klucze i pomija odrzucone', () => {
    const stored = numberedAudit(maroko, {
      summary: 'Plan spójny, jedna sprzeczność.',
      findings: [
        { severity: 'error', category: 'consistency', title: 'Dzień 1: lot', detail: 'Godziny się nie zgadzają.', dayRef: 'd1', itemRefs: ['d1-przylot', 'nie-ma'], bookingRef: 'lot-tam' },
        { severity: 'tip', category: 'risk', title: 'Dzień 9', detail: 'Coś.', dayRef: 'd99', itemRefs: [], bookingRef: 'zmyslona' },
      ],
    });
    expect(StoredAudit.safeParse(stored).success).toBe(true);
    expect(stored.audit.findings.map((each) => each.id)).toEqual(['a1', 'a2']);
    expect(stored.audit.findings[0]).toMatchObject({ dayRef: 'd1', itemRefs: ['d1-przylot'], bookingRef: 'lot-tam' });
    expect(stored.audit.findings[1]).not.toHaveProperty('dayRef');
    expect(stored.audit.findings[1]).not.toHaveProperty('bookingRef');
    expect(openFindings({ ...stored, dismissed: ['a1'] }).map((each) => each.id)).toEqual(['a2']);
  });
});
