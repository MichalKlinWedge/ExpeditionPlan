import type { AiClient } from '@expeditionplan/ai';
import { describe, expect, it } from 'vitest';

import { readReceipt, receiptPrompt } from '../receipt.ts';

const answering = (reply: unknown, seen?: { prompt?: string; image?: unknown }): AiClient => ({
  defaultProvider: 'GEMINI',
  ask: async (prompt, request) => {
    if (seen) Object.assign(seen, { prompt, image: request?.image });
    return { text: JSON.stringify(reply), provider: 'GEMINI', model: 'test' };
  },
  listModels: async () => [],
});

const image = { mimeType: 'image/jpeg', data: 'AAAA' };

describe('paragon ze zdjęcia', () => {
  it('kwota w groszach, obraz i waluty wyjazdu idą do modelu', async () => {
    const seen: { prompt?: string; image?: unknown } = {};
    const reply = { isReceipt: true, total: 45.5, currency: 'MAD', date: '2026-11-02', merchant: ' Café Clock ', category: 'food' };
    const draft = await readReceipt(answering(reply, seen), image, { currencies: ['PLN', 'MAD'] });
    expect(draft).toEqual({ amountMinor: 4550, currency: 'MAD', date: '2026-11-02', merchant: 'Café Clock', category: 'food' });
    expect(seen.image).toEqual(image);
    expect(seen.prompt).toContain('PLN, MAD');
  });

  it('nie paragon → null; nieodczytane pola zostają puste', async () => {
    expect(await readReceipt(answering({ isReceipt: false, total: null, currency: null, date: null, merchant: null, category: null }), image, { currencies: [] })).toBeNull();
    const partial = await readReceipt(answering({ isReceipt: true, total: null, currency: 'EUR', date: null, merchant: null, category: null }), image, { currencies: ['EUR'] });
    expect(partial).toEqual({ amountMinor: null, currency: 'EUR', date: null, merchant: null, category: null });
  });

  it('kategorie z budżetu i schemat w poleceniu', () => {
    const prompt = receiptPrompt(['EUR']);
    expect(prompt).toContain('tolls_parking (opłaty, parkingi)');
    expect(prompt).toContain('"isReceipt"');
  });
});
