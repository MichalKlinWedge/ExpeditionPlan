import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dayItems, documentProblem } from '../plan-edits.ts';
import { copyFromDraft, inAllVariants, pairDays, replaceDayFromDraft } from '../plan-merge.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
let counter = 0;
const newId = () => `00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;

/** Szkic = plan wzorcowy z jednym dniem więcej (dzień po końcu wyjazdu). */
const EXTRA_DATE = '2099-01-01';
const draftWithExtraDay = (doc: TripDocument) =>
  TripDocument.parse({
    ...doc,
    days: [...doc.days, { ref: 'd-extra', date: EXTRA_DATE, tz: doc.days[0]!.tz, title: 'Dzień ze szkicu' }],
    items: [...doc.items, { ref: 'x-1', dayRef: 'd-extra', sortKey: '0010', kind: 'visit', title: 'Punkt ze szkicu', durationMin: 60 }],
  });

describe('szkic AI → plan', () => {
  const plan = maroko;
  const draft = draftWithExtraDay(maroko);

  it('dni łączą się po dacie; dzień tylko w szkicu nie ma dnia planu', () => {
    const pairs = pairDays(plan, draft);
    expect(pairs.map((pair) => pair.date)).toEqual(draft.days.map((day) => day.date));
    const last = pairs.at(-1)!;
    expect(last.planDay).toBeUndefined();
    expect(last.plan).toEqual([]);
    expect(last.draft.map((item) => item.title)).toEqual(['Punkt ze szkicu']);
  });

  it('przeniesione punkty lądują na końcu dnia, miejsca o tej samej nazwie się nie dublują', () => {
    const day = plan.days[1]!;
    const draftDay = maroko.days.find((each) => each.date === day.date)!;
    const picked = dayItems(maroko, draftDay.ref).slice(0, 2);
    const edit = copyFromDraft(plan, maroko, picked.map((item) => item.ref), day.date, newId);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(edit.created.filter((each) => each.collection === 'places')).toEqual([]);
    const items = dayItems(edit.doc, day.ref);
    expect(items.slice(-2).map((item) => item.title)).toEqual(picked.map((item) => item.title));
    expect(items.slice(-2).every((item) => item.ref.startsWith('id-') && item.variantRefs.length === 0 && item.bookingRef === undefined)).toBe(true);
    expect(Object.keys(edit.copied)).toEqual(picked.map((item) => item.ref));
  });

  it('dzień, którego plan nie ma, powstaje z dnia szkicu', () => {
    const edit = copyFromDraft(plan, draft, ['x-1'], EXTRA_DATE, newId);
    expect(documentProblem(edit.doc)).toBeNull();
    const created = edit.created.find((each) => each.collection === 'days');
    expect(created?.element).toMatchObject({ date: EXTRA_DATE, title: 'Dzień ze szkicu' });
    expect(edit.doc.days.at(-1)!.ref).toBe(created!.element.ref);
    expect(dayItems(edit.doc, created!.element.ref).map((item) => item.title)).toEqual(['Punkt ze szkicu']);
  });

  it('nowe miejsce szkicu trafia do planu razem z punktem', () => {
    const draft = TripDocument.parse({
      ...maroko,
      places: [...maroko.places, { ref: 'p-nowe', name: 'Ogrody Majorelle (szkic)', lat: 31.6417, lng: -7.9 }],
      items: maroko.items.map((item, i) => (i === 0 ? { ...item, placeRef: 'p-nowe' } : item)),
    });
    const source = draft.items[0]!;
    const edit = copyFromDraft(plan, draft, [source.ref], plan.days[0]!.date, newId);
    expect(documentProblem(edit.doc)).toBeNull();
    const place = edit.created.find((each) => each.collection === 'places');
    expect(place?.element.name).toBe('Ogrody Majorelle (szkic)');
    expect(edit.doc.items.find((item) => item.ref === edit.copied[source.ref])!.placeRef).toBe(place!.element.ref);
  });

  it('do puli: kandydat bez kolejności i bez godziny względnej', () => {
    const source = maroko.items.find((item) => item.dayRef !== undefined)!;
    const edit = copyFromDraft(plan, maroko, [source.ref], null, newId);
    expect(documentProblem(edit.doc)).toBeNull();
    const item = edit.doc.items.find((each) => each.ref === edit.copied[source.ref])!;
    expect(item.dayRef).toBeUndefined();
    expect(item.sortKey).toBeUndefined();
    expect(item.planStatus).not.toBe('scheduled');
  });

  it('zastąpienie dnia: zostają punkty ręcznie zmienione i powiązane, reszta to szkic', () => {
    const pair = pairDays(plan, maroko).find((each) => each.plan.length >= 3)!;
    const locked = pair.plan[0]!;
    const edit = replaceDayFromDraft(plan, maroko, pair.date, new Set([locked.ref]), newId);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(edit.kept[0]).toMatchObject({ ref: locked.ref, reason: 'zmieniony ręcznie' });
    expect(edit.removed.length + edit.kept.length).toBe(pair.plan.length);
    // Kolejność dnia = kolejność szkicu; punkt, który został, stoi w miejscu odpowiednika (bez dubla).
    const after = dayItems(edit.doc, pair.planDay!.ref).map((item) => item.title);
    const keptTitles = new Set(edit.kept.map((each) => each.title));
    const expected = pair.draft.filter((item) => inAllVariants(item) || keptTitles.has(item.title)).map((item) => item.title);
    const keptOnly = [...keptTitles].filter((title) => !expected.includes(title));
    expect(after).toEqual([...expected, ...keptOnly]);
    expect(edit.changed.some((item) => item.ref === locked.ref)).toBe(true);
    expect(edit.kept.slice(1).every((each) => each.reason.startsWith('powiązany: '))).toBe(true);
  });
});
