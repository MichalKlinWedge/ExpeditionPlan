import { describe, expect, it } from 'vitest';

import { type GuideRow, guideRowFor, placeGuide } from '../guide.ts';
import { linkGuideText } from '../guide-links.ts';

const targets = [
  { ref: 'kutubia', names: ['Meczet Kutubijja', 'Kutubijja'] },
  { ref: 'medyna', names: ['Medyna Essaouiry (UNESCO)', 'Medina of Essaouira'] },
  { ref: 'fna', names: ['Dżami al-Fna'] },
];

const linked = (segments: ReturnType<typeof linkGuideText>) => segments.filter((each) => each.ref).map((each) => `${each.ref}:${each.text}`);

describe('opis przy miejscu', () => {
  const content = (summary: string) => ({ summary, facts: [], tips: [], images: [], article: { title: 'A', url: 'https://pl.wikipedia.org/wiki/A', lang: 'pl', site: 'wikipedia' } });
  const row = (id: string, item_id: string | null, place_id: string | null, summary: string, extra: Partial<GuideRow> = {}) =>
    ({ id, item_id, place_id, audience: 'adult', lang: 'pl', title: summary, content: content(summary), ...extra }) as GuideRow;
  const ids = { mestia: 'p1', kutaisi: 'p2', 'punkt-1': 'i1', dojazd: 'i2', nocleg: 'i3' };
  const items = [
    { ref: 'punkt-1', title: 'Wieże', kind: 'visit', placeRef: 'mestia' },
    { ref: 'dojazd', title: 'Dojazd', kind: 'transport', leg: { toPlaceRef: 'kutaisi' } },
    { ref: 'nocleg', title: 'Hotel', kind: 'lodging', placeRef: 'kutaisi' },
  ];

  it('własny opis miejsca wygrywa z opisem punktu', () => {
    const rows = [row('a', 'i1', null, 'punkt'), row('b', 'i1', 'p1', 'miejsce')];
    expect(placeGuide(items, rows, ids, 'mestia')).toMatchObject({ rowId: 'b', content: { summary: 'miejsce' } });
    expect(placeGuide(items, rows, ids, 'mestia')?.fromItem).toBeUndefined();
  });

  it('bez niego opis punktu z tym miejscem, z informacją skąd', () => {
    expect(placeGuide(items, [row('a', 'i1', null, 'punkt')], ids, 'mestia')).toMatchObject({ rowId: 'a', fromItem: { ref: 'punkt-1', title: 'Wieże' } });
    expect(placeGuide(items, [row('a', 'i2', null, 'droga')], ids, 'kutaisi')?.fromItem?.ref).toBe('dojazd');
  });

  it('nie bierze noclegu, usuniętych, opisu innego miejsca ani zepsutej treści', () => {
    expect(placeGuide(items, [row('a', 'i3', null, 'hotel')], ids, 'kutaisi')).toBeNull();
    expect(placeGuide(items, [row('a', null, 'p1', 'x', { deleted_at: '2026-01-01' })], ids, 'mestia')).toBeNull();
    expect(placeGuide(items, [row('a', 'i1', 'p2', 'inne')], ids, 'mestia')).toBeNull();
    expect(placeGuide(items, [row('a', null, 'p1', 'x', { content: { summary: 'bez reszty' } })], ids, 'mestia')).toBeNull();
  });
});

describe('odnośniki w przewodniku', () => {
  it('nazwy w odmianie, pierwsze wystąpienie, tekst bez zmian po złożeniu', () => {
    const text = 'Z placu Dżami al-Fna widać minaret Kutubijji. W medynie Essaouiry jest inaczej niż przy Kutubijji.';
    const segments = linkGuideText(text, targets);
    expect(segments.map((each) => each.text).join('')).toBe(text);
    expect(linked(segments)).toEqual(['fna:Dżami al-Fna', 'kutubia:Kutubijji', 'medyna:medynie Essaouiry']);
  });

  it('bez fałszywych trafień w środku słowa i z krótkich nazw', () => {
    expect(linked(linkGuideText('Antykutubijjański nastrój.', targets))).toEqual([]);
    expect(linked(linkGuideText('To jest Fes.', [{ ref: 'x', names: ['Fes'] }]))).toEqual([]);
  });

  it('wspólny zbiór „użytych” — w ciekawostkach nie linkuje drugi raz', () => {
    const used = new Set<string>();
    expect(linked(linkGuideText('Kutubijja góruje nad miastem.', targets, used))).toEqual(['kutubia:Kutubijja']);
    expect(linked(linkGuideText('Kutubijja ma 77 m.', targets, used))).toEqual([]);
  });
});

describe('który opis ma punkt', () => {
  const row = (id: string, item_id: string | null, place_id: string | null) => ({ id, item_id, place_id, audience: 'adult', lang: 'pl', title: id, content: {} });
  it('własny opis punktu (ze wskazówką) przed opisem miejsca, opis miejsca przed opisem z innego punktu', () => {
    const rows = [row('miejsce', 'i-1', 'p-1'), row('punkt', 'i-2', null)];
    expect(guideRowFor(rows, 'i-2', 'p-1')?.id).toBe('punkt');
    expect(guideRowFor(rows, 'i-3', 'p-1')?.id).toBe('miejsce');
    expect(guideRowFor([row('miejsce', 'i-1', 'p-1'), row('inny', 'i-1', 'p-2')], 'i-1', undefined)?.id).toBe('miejsce');
  });
});
