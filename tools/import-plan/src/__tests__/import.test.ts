import { TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { compareDocuments, missingTitles, normalizeTitle, similarity } from '../compare.ts';
import { htmlToText } from '../extract.ts';
import { importPrompt, jsonSchema } from '../prompt.ts';

describe('htmlToText', () => {
  it('zachowuje tabelę harmonogramu jako wiersze z kolumnami', () => {
    const html =
      '<h2>Sobota 5.12</h2><table><tr><td>09:00</td><td>Lądowanie na T2</td></tr>'
      + '<tr><td>~09:30</td><td>Pociąg R2 Nord</td></tr></table>';

    expect(htmlToText(html)).toBe('## Sobota 5.12\n\n09:00 | Lądowanie na T2\n~09:30 | Pociąg R2 Nord');
  });

  it('akapity w komórce tabeli (jak w DOCX) zostają w jednym wierszu', () => {
    const html = '<table><tr><td><p>09:00</p></td><td><p>Lądowanie</p><p>na T2</p></td></tr></table>';

    expect(htmlToText(html)).toBe('09:00 | Lądowanie / na T2');
  });

  it('dokleja adres linku, którego nie widać w tekście', () => {
    expect(htmlToText('<p><a href="https://mapy.com/s/x">Cikola</a></p>')).toBe('Cikola (https://mapy.com/s/x)');
  });
});

describe('importPrompt', () => {
  it('niesie schemat i dokument, a anonimizację tylko na życzenie', () => {
    const plain = importPrompt('Plan dnia', { fileName: 'plan.docx' });
    const anonymous = importPrompt('Plan dnia', { anonymize: true });

    expect(plain).toContain('"schemaVersion"');
    expect(plain).toContain('<<<\nPlan dnia\n>>>');
    expect(plain).not.toContain('ANONIMIZACJA');
    expect(anonymous).toContain('ANONIMIZACJA');
  });

  it('JSON Schema da się odczytać', () => {
    expect(JSON.parse(jsonSchema()).type).toBe('object');
  });
});

describe('porównanie z wzorcem', () => {
  it('dopasowuje tytuły mimo innych sformułowań', () => {
    expect(normalizeTitle('Medersa Ben Youssefa!')).toBe('medersa ben youssefa');
    expect(similarity('Medersa Ben Youssefa', 'Zwiedzanie: Medersa Ben Youssefa')).toBeGreaterThan(0.5);
    expect(missingTitles(['Pałac Bahia', 'Ogród Majorelle'], ['Palac Bahia — dziedzińce'])).toEqual(['Ogród Majorelle']);
  });

  it('liczy, ile punktów wzorca import odnalazł', () => {
    const doc = (titles: string[]) =>
      TripDocument.parse({
        schemaVersion: 1,
        trip: { title: 'T', startDate: '2026-12-26', endDate: '2026-12-27', primaryTz: 'Africa/Casablanca', baseCurrency: 'PLN' },
        items: titles.map((title, index) => ({ ref: `i${index}`, kind: 'visit', title, planStatus: 'candidate' })),
      });

    const result = compareDocuments(doc(['Pałac Bahia', 'Ogród Majorelle']), doc(['Pałac Bahia']));

    expect(result.itemRecall).toBe(0.5);
    expect(result.missingItems).toEqual(['Ogród Majorelle']);
  });
});
