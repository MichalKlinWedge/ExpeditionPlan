import type { AiClient } from '@expeditionplan/ai';
import { describe, expect, it } from 'vitest';

import { readVenueText, VENUE_TEXT_LIMIT, venuePrompt } from '../venue.ts';

const empty = { points: [], address: null, openingHours: null, website: null, prices: [], rating: null };

function clientAnswering(...answers: unknown[]) {
  const prompts: string[] = [];
  const client: AiClient = {
    defaultProvider: 'GEMINI',
    ask: async (prompt: string) => {
      prompts.push(prompt);
      return { text: JSON.stringify(answers.shift()), provider: 'GEMINI', model: 'test' };
    },
    listModels: async () => [],
  };
  return { client, prompts };
}

describe('dane lokalu z wklejonego tekstu', () => {
  it('prompt: tekst w ramce, przycięty, bez uzupełniania z własnej wiedzy', () => {
    const prompt = venuePrompt('Pizzeria', `${'x'.repeat(VENUE_TEXT_LIMIT)}KONIEC`);
    expect(prompt).toContain('„Pizzeria”');
    expect(prompt).toContain('Nie zgaduj i nie uzupełniaj z własnej wiedzy.');
    expect(prompt).toContain('<tekst>');
    expect(prompt).not.toContain('KONIEC');
  });

  it('zapisane punkty idą do promptu, żeby kolejny odczyt ich nie powtarzał', () => {
    expect(venuePrompt('Pizzeria', 'tekst', ['Mała pizzeria.'])).toContain('nie powtarzaj ich');
    expect(venuePrompt('Pizzeria', 'tekst', ['Mała pizzeria.'])).toContain('Mała pizzeria.');
    expect(venuePrompt('Pizzeria', 'tekst')).not.toContain('nie powtarzaj ich');
  });

  it('zwraca szkic z punktami, oceną i cenami', async () => {
    const answer = { ...empty, isVenue: true, points: ['Mała pizzeria.', 'Płatność gotówką.'], rating: { value: 4.6, scale: 5, count: 1240, source: 'Google Maps' }, prices: [{ name: 'Margherita', currency: 'PLN', minMinor: 3200, maxMinor: 3200 }] };
    const { client } = clientAnswering(answer);
    expect(await readVenueText(client, 'Pizzeria', 'tekst')).toEqual(answer);
  });

  it('tekst nie o lokalu: nic', async () => {
    const { client } = clientAnswering({ ...empty, isVenue: false });
    expect(await readVenueText(client, 'Pizzeria', 'przepis na chleb')).toBeNull();
  });

  it('ocena ponad skalę nie przechodzi: jedna próba naprawy, potem poprawna odpowiedź', async () => {
    const good = { ...empty, isVenue: true, rating: { value: 4.5, scale: 5, count: null, source: null } };
    const { client, prompts } = clientAnswering({ ...empty, isVenue: true, rating: { value: 45, scale: 5, count: null, source: null } }, good);
    expect(await readVenueText(client, 'Pizzeria', 'tekst')).toEqual(good);
    expect(prompts).toHaveLength(2);
  });
});
