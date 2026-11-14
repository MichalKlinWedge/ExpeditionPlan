import { describe, expect, it } from 'vitest';

import { dayExtras, setExtraDismissed } from '../day-extras.ts';
import { EXTERNAL_EXTRAS_FORMAT, externalExtrasBrief, importExternalExtras, parseExternalExtras } from '../day-extras-external.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { TripDocument } from '../schemas/trip-document.ts';

/** A — rynek, 7 km na wschód B — jezioro; przejazd autem A → B. */
const doc = TripDocument.parse({
  schemaVersion: 1,
  trip: { title: 'Test', startDate: '2026-07-01', endDate: '2026-07-01', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
  travelers: [{ ref: 't1', name: 'Ala', age: 9 }],
  places: [
    { ref: 'a', name: 'Rynek', lat: 50, lng: 20 },
    { ref: 'b', name: 'Jezioro', lat: 50, lng: 20.1 },
  ],
  days: [{ ref: 'd1', date: '2026-07-01', tz: 'Europe/Warsaw' }],
  items: [
    { ref: 'rynek', dayRef: 'd1', sortKey: '10', kind: 'visit', title: 'Rynek', placeRef: 'a', durationMin: 60, time: { precision: 'exact', start: '09:00' } },
    { ref: 'jazda', dayRef: 'd1', sortKey: '20', kind: 'transport', title: 'Do jeziora', leg: { mode: 'car', fromPlaceRef: 'a', toPlaceRef: 'b', durationMin: 20 } },
    { ref: 'jezioro', dayRef: 'd1', sortKey: '30', kind: 'visit', title: 'Jezioro', placeRef: 'b', durationMin: 120 },
  ],
});
const schedule = scheduleDay(doc, 'd1');
const refs = schedule.items.map((item) => item.ref);

const answer = {
  format: EXTERNAL_EXTRAS_FORMAT,
  date: '2026-07-01',
  items: [
    { title: 'Zamek Wysoki', type: 'zamek', why: 'Ruiny nad drogą.', lat: 50.005, lng: 20.06, stayMin: 45, fit: 'stop', nearRef: null, swapRef: 'jezioro', weather: 'outdoor', wikipedia: 'https://pl.wikipedia.org/wiki/Zamek', website: null },
    { title: 'Wieża', lat: '50.002', lng: '20', stayMin: 15, fit: 'cokolwiek' },
    { title: 'Rynek', lat: 50, lng: 20, stayMin: 10, fit: 'pass' },
    { title: 'Zamek w innym kraju', lat: 41, lng: 2, stayMin: 60, fit: 'visit' },
  ],
};

describe('po drodze i w pobliżu z zewnętrznego AI', () => {
  it('wytyczne: plan z godzinami i współrzędnymi, trasa, zasięg, format; bez imion', () => {
    const brief = externalExtrasBrief(doc, 'd1', schedule);
    expect(brief).toContain('| `rynek` | 09:00–10:00 | Rynek |');
    expect(brief).toContain('Rynek (50.00000, 20.00000) → Jezioro (50.00000, 20.10000)');
    expect(brief).toContain('autem `jazda`');
    expect(brief).toContain('do 5 km od miejsc punktów');
    expect(brief).toContain(`"format": "${EXTERNAL_EXTRAS_FORMAT}"`);
    expect(brief).toContain('Uczestnicy (wiek): 9');
    expect(brief).not.toContain('Ala');
  });

  it('odpowiedź w bloku ```json z tekstem dookoła; uszkodzona — polski błąd', () => {
    const parsed = parseExternalExtras(`Oto lista:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\nMiłej podróży!`);
    expect('data' in parsed && parsed.data.items).toHaveLength(4);
    expect('data' in parsed && parsed.data.items[1]).toMatchObject({ lat: 50.002, lng: 20, fit: 'stop' });
    expect(parseExternalExtras('{"items": [')).toEqual({ error: expect.stringMatching(/uszkodzony/) });
    expect(parseExternalExtras('brak')).toEqual({ error: expect.stringMatching(/nie ma obiektu JSON/) });
  });

  it('wczytanie: odległość i objazd z kodu, plan i dalekie odpadają z powodem, drugi raz nie dubluje', () => {
    const parsed = parseExternalExtras(JSON.stringify(answer));
    if (!('data' in parsed)) throw new Error(parsed.error);
    const result = importExternalExtras(doc, 'd1', refs, parsed.data, '2026-06-01');
    expect(result.added).toBe(2);
    expect(result.skipped).toEqual([
      { title: 'Rynek', reason: 'już w planie' },
      { title: 'Zamek w innym kraju', reason: expect.stringMatching(/^za daleko od trasy dnia/) },
    ]);
    const withDay = result.edit!.doc;
    expect(TripDocument.safeParse(withDay).success).toBe(true);
    const open = dayExtras(withDay, 'd1').open;
    const castle = open.find((each) => each.title === 'Zamek Wysoki')!;
    expect(castle).toMatchObject({ id: 'ext:50.0050,20.0600', along: 'car', nearRef: 'jazda', swapRef: 'jezioro', stayMin: 45, wikipedia: 'https://pl.wikipedia.org/wiki/Zamek' });
    expect(open.find((each) => each.title === 'Wieża')).toMatchObject({ along: 'at', nearRef: 'rynek', fit: 'stop' });

    const dismissed = setExtraDismissed(withDay, 'd1', castle.id, true)!.doc;
    const again = importExternalExtras(dismissed, 'd1', refs, parsed.data, '2026-06-02');
    expect(again.added).toBe(0);
    expect(again.skipped.slice(0, 2)).toEqual([
      { title: 'Zamek Wysoki', reason: 'odrzucone wcześniej' },
      { title: 'Wieża', reason: 'już na liście' },
    ]);
    expect(importExternalExtras(doc, 'd1', refs, { ...parsed.data, date: '2026-07-02' }, '2026-06-01').wrongDate).toBe('2026-07-02');
  });
});
