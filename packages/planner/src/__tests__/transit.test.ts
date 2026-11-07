import type { AiClient } from '@expeditionplan/ai';
import { describe, expect, it } from 'vitest';

import { readTransitText, TRANSIT_TEXT_LIMIT, transitPrompt } from '../transit.ts';

const answering = (reply: unknown): AiClient => ({
  defaultProvider: 'GEMINI',
  ask: async () => ({ text: JSON.stringify(reply), provider: 'GEMINI', model: 'test' }),
  listModels: async () => [],
});

const READING = {
  isRoute: true,
  segments: [
    { mode: 'metro', line: 'L5', from: 'Sagrada Família', to: 'Diagonal', durationMin: 6 },
    { mode: 'metro', line: ' L3 ', from: 'Diagonal', to: 'Espanya', durationMin: 12 },
  ],
  durationMin: 24,
  frequencyMin: 4,
  departures: ['10:02', '10:06'],
  instructions: 'Wsiądź w L5 w kierunku Cornellà.',
  alternative: null,
};

describe('trasa komunikacją z wklejonego tekstu', () => {
  it('oczyszczony szkic; tekst o czymś innym daje null', async () => {
    const trip = { title: 'Metro na Montjuïc' };
    expect(await readTransitText(answering(READING), 'tekst', trip)).toMatchObject({ durationMin: 24, segments: [{ line: 'L5' }, { line: 'L3' }], departures: ['10:02', '10:06'] });
    expect(await readTransitText(answering({ ...READING, isRoute: false }), 'przepis na pizzę', trip)).toBeNull();
  });

  it('godzina spoza formatu nie przechodzi', async () => {
    await expect(readTransitText(answering({ ...READING, departures: ['10.02'] }), 'tekst', { title: 'x' })).rejects.toThrow();
  });

  it('przejazd z planu w poleceniu, tekst w znaczniku przycięty do limitu', () => {
    const prompt = transitPrompt('x'.repeat(TRANSIT_TEXT_LIMIT + 50), { title: 'Metro do Sagrady', from: 'Plaça de Catalunya', to: 'Sagrada Família' });
    expect(prompt).toContain('„Metro do Sagrady”, skąd: Plaça de Catalunya, dokąd: Sagrada Família');
    expect(prompt).toContain('<tekst>');
    expect(prompt.match(/x+/g)!.some((run) => run.length === TRANSIT_TEXT_LIMIT)).toBe(true);
    expect(prompt.match(/x+/g)!.some((run) => run.length > TRANSIT_TEXT_LIMIT)).toBe(false);
  });
});
