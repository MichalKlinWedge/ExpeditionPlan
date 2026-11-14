import { describe, expect, it } from 'vitest';

import { markdownPlainLines, notesMarkdown, parseInline, parseMarkdown } from '../note-markdown.ts';

describe('uwagi punktu w Markdown', () => {
  it('pogrubienie, kursywa i link w tekście', () => {
    expect(parseInline('Weź **kurtkę** i *czapkę*, mapa: [mapy.com](https://mapy.com/s/abc)')).toEqual([
      { kind: 'text', text: 'Weź ' },
      { kind: 'text', text: 'kurtkę', bold: true },
      { kind: 'text', text: ' i ' },
      { kind: 'text', text: 'czapkę', italic: true },
      { kind: 'text', text: ', mapa: ' },
      { kind: 'link', label: 'mapy.com', url: 'https://mapy.com/s/abc' },
    ]);
  });

  it('podkreślniki w adresie i w słowie nie są kursywą, gwiazdka w rachunku też nie', () => {
    expect(parseInline('Zob. https://example.com/a_b_c oraz snake_case_name i 2 * 3 * 4')).toEqual([
      { kind: 'text', text: 'Zob. https://example.com/a_b_c oraz snake_case_name i 2 * 3 * 4' },
    ]);
  });

  it('kursywa w pogrubieniu', () => {
    expect(parseInline('**bardzo _ważne_**')).toEqual([
      { kind: 'text', text: 'bardzo ', bold: true },
      { kind: 'text', text: 'ważne', bold: true, italic: true },
    ]);
  });

  it('bloki: nagłówek, akapit z liniami, listy punktowana i numerowana', () => {
    const blocks = parseMarkdown('## Dojście\nOd parkingu 20 min\nszlakiem żółtym\n\n- woda\n* czołówka\n1. bilet\n2) karta');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', lines: [[{ text: 'Od parkingu 20 min' }], [{ text: 'szlakiem żółtym' }]] });
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false, items: [[{ text: 'woda' }], [{ text: 'czołówka' }]] });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('dawne uwagi (jedna na pozycję) składają się w listę, jedna zostaje sobą', () => {
    expect(notesMarkdown(['Na górze wieje', ' ', 'Weź kurtki'])).toBe('- Na górze wieje\n- Weź kurtki');
    expect(notesMarkdown(['**Jedna** uwaga\nz dwiema liniami'])).toBe('**Jedna** uwaga\nz dwiema liniami');
    expect(notesMarkdown([])).toBe('');
  });

  it('tekst bez znaczników do kalendarza', () => {
    expect(markdownPlainLines('# Uwaga\n**Weź** wodę\n- [mapa](https://mapy.com/x)\n1. bilet')).toEqual(['Uwaga', 'Weź wodę', '• mapa (https://mapy.com/x)', '1. bilet']);
  });
});
