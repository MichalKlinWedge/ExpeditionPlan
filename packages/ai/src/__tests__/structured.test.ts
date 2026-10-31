import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AiClient, AiRequest } from '../client.ts';
import { AiValidationError, askStructured, unwrapJson } from '../structured.ts';

/**
 * Odpowiedź modelu jako dane zgodne ze schematem. Tu ląduje cały plan wyjazdu, więc
 * przepuszczenie odpowiedzi niezgodnej ze schematem byłoby gorsze niż jej odrzucenie.
 */

const Day = z.object({ date: z.string(), items: z.array(z.object({ title: z.string() })).min(1) });

/** Klient, który odpowiada po kolei z listy i zapisuje, o co go pytano. */
function scripted(answers: string[]) {
  const prompts: { prompt: string; request: AiRequest | undefined }[] = [];
  const client: AiClient = {
    defaultProvider: 'CLAUDE',
    async ask(prompt, request) {
      prompts.push({ prompt, request });
      const text = answers.shift();
      if (text === undefined) throw new Error('Nie ma więcej odpowiedzi');
      return { text, provider: request?.provider ?? 'CLAUDE', model: 'model-testowy' };
    },
    async listModels() {
      return [];
    },
  };
  return { client, prompts };
}

describe('unwrapJson', () => {
  it('wyjmuje JSON ze znaczników kodu i zdań wokół', () => {
    expect(unwrapJson('Oto plan:\n```json\n{"a":1}\n```\nMiłej podróży!')).toBe('{"a":1}');
  });

  it('przyjmuje tablicę na najwyższym poziomie', () => {
    expect(unwrapJson('[{"a":1},{"a":2}]')).toBe('[{"a":1},{"a":2}]');
  });

  it('bez JSON-a oddaje null, zamiast zgadywać', () => {
    expect(unwrapJson('Nie mogę tego zrobić.')).toBeNull();
  });

  it('bierze pierwszy domknięty obiekt, nawet gdy po nim model dopisał drugi albo klamrę w zdaniu', () => {
    expect(unwrapJson('{"a":"}{"}\n{"b":2}')).toBe('{"a":"}{"}');
    expect(unwrapJson('{"a":{"b":[1,2]}} — gotowe {tak}')).toBe('{"a":{"b":[1,2]}}');
    expect(unwrapJson('{"a":"cudzysłów \\" w środku"}')).toBe('{"a":"cudzysłów \\" w środku"}');
  });
});

describe('askStructured', () => {
  it('zgodną odpowiedź oddaje od razu jako dane', async () => {
    const { client, prompts } = scripted(['{"date":"2026-12-26","items":[{"title":"Dżami al-Fna"}]}']);

    const answer = await askStructured(client, Day, 'Zaplanuj dzień');

    expect(answer.data.items[0]?.title).toBe('Dżami al-Fna');
    expect(answer.attempts).toBe(1);
    expect(prompts).toHaveLength(1);
  });

  it('niezgodną naprawia raz, pokazując modelowi błędy i jego poprzednią odpowiedź', async () => {
    const { client, prompts } = scripted([
      '{"date":"2026-12-26","items":[]}',
      '{"date":"2026-12-26","items":[{"title":"Medersa Ben Youssefa"}]}',
    ]);

    const answer = await askStructured(client, Day, 'Zaplanuj dzień', { provider: 'GEMINI' });

    expect(answer.attempts).toBe(2);
    expect(prompts[1]?.prompt).toContain('items');
    expect(prompts[1]?.prompt).toContain('{"date":"2026-12-26","items":[]}');
    // Naprawa idzie do tego samego dostawcy — inny model nie zna kontekstu pierwszej odpowiedzi.
    expect(prompts[1]?.request?.provider).toBe('GEMINI');
  });

  it('po nieudanej naprawie rzuca błąd z listą problemów, a nie zgadnięte dane', async () => {
    const { client } = scripted(['nie JSON', '{"date":1}']);

    const error = await askStructured(client, Day, 'Zaplanuj dzień').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiValidationError);
    expect((error as AiValidationError).issues.join(' ')).toContain('date');
    expect((error as AiValidationError).retryable).toBe(true);
  });
});
