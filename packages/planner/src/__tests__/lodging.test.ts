import type { AiClient } from '@expeditionplan/ai';
import { describe, expect, it } from 'vitest';

import { LODGING_TEXT_LIMIT, lodgingPrompt, readLodgingText } from '../lodging.ts';

const answering = (reply: unknown): AiClient => ({
  defaultProvider: 'GEMINI',
  ask: async () => ({ text: JSON.stringify(reply), provider: 'GEMINI', model: 'test' }),
  listModels: async () => [],
});

const READING = { isLodging: true, description: ' Apartament przy porcie. ', address: 'Carrer Ample 12', checkInFrom: '15:00', checkOutUntil: '11:00', breakfast: null, beds: null, rooms: 2, amenities: ['Wi-Fi'], confirmationCode: 'ABC123', hostName: null, phone: '+34 600', email: null };

describe('nocleg z wklejonego tekstu', () => {
  it('oczyszczony szkic; tekst o czymś innym daje null', async () => {
    expect(await readLodgingText(answering(READING), 'tekst')).toMatchObject({ description: 'Apartament przy porcie.', rooms: 2, confirmationCode: 'ABC123' });
    expect(await readLodgingText(answering({ ...READING, isLodging: false }), 'przepis na pizzę')).toBeNull();
  });

  it('tekst idzie w znaczniku, jako dane, przycięty do limitu', () => {
    const prompt = lodgingPrompt('x'.repeat(LODGING_TEXT_LIMIT + 50));
    expect(prompt).toContain('<tekst>');
    expect(prompt.match(/x+/g)!.some((run) => run.length === LODGING_TEXT_LIMIT)).toBe(true);
    expect(prompt.match(/x+/g)!.some((run) => run.length > LODGING_TEXT_LIMIT)).toBe(false);
  });
});
