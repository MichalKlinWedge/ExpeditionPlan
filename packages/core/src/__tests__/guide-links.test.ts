import { describe, expect, it } from 'vitest';

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
