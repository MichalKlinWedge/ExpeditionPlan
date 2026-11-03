import { describe, expect, it } from 'vitest';

import { guideRowFor } from '../guide.ts';
import { linkGuideText } from '../guide-links.ts';

const targets = [
  { ref: 'kutubia', names: ['Meczet Kutubijja', 'Kutubijja'] },
  { ref: 'medyna', names: ['Medyna Essaouiry (UNESCO)', 'Medina of Essaouira'] },
  { ref: 'fna', names: ['Dżami al-Fna'] },
];

const linked = (segments: ReturnType<typeof linkGuideText>) => segments.filter((each) => each.ref).map((each) => `${each.ref}:${each.text}`);

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
