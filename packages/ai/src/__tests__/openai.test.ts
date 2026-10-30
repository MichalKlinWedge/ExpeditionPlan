import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askOpenAi, parseOpenAiModels } from '../openai.ts';
import { AiError } from '../transport.ts';

/**
 * Kształt zapytania do OpenAI i odczyt odpowiedzi.
 *
 * Osobno pilnujemy tego, czego *nie* wysyłamy: nowsze rodziny modeli odrzucają całe zapytanie za
 * pole, którego nie znają, a o czysty JSON prosi samo polecenie.
 */

type Sent = { url: string; init: RequestInit };

let sent: Sent[] = [];

const respond = (status: number, body: unknown) => {
  globalThis.fetch = ((url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }) as typeof globalThis.fetch;
};

const text = (value: string) => ({ choices: [{ message: { content: value } }] });

const body = (call: Sent) => JSON.parse(String(call.init.body)) as Record<string, unknown>;

beforeEach(() => {
  sent = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('askOpenAi', () => {
  it('wysyła polecenie z kluczem w nagłówku autoryzacji', async () => {
    respond(200, text('{"ok":true}'));

    await expect(askOpenAi('sk-test', 'gpt-test', 'Policz kalorie')).resolves.toBe('{"ok":true}');

    expect(sent[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((sent[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(body(sent[0]!)).toMatchObject({ model: 'gpt-test' });
  });

  it('nie dokłada pól, za które nowsze modele odrzucają całe zapytanie', () => {
    respond(200, text('{}'));

    return askOpenAi('sk-test', 'gpt-test', 'Policz').then(() => {
      expect(body(sent[0]!)).not.toHaveProperty('temperature');
      expect(body(sent[0]!)).not.toHaveProperty('response_format');
      expect(body(sent[0]!)).not.toHaveProperty('max_tokens');
    });
  });

  it('zdjęcie idzie przed tekstem, jako dane w adresie', async () => {
    respond(200, text('{}'));

    await askOpenAi('sk-test', 'gpt-test', 'Na zdjęciu jest to samo jedzenie', { image: {
      mimeType: 'image/jpeg',
      data: 'QUJD',
    } });

    expect(body(sent[0]!).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
          { type: 'text', text: 'Na zdjęciu jest to samo jedzenie' },
        ],
      },
    ]);
  });

  it('formatu, którego OpenAI nie przyjmuje, nie wysyła wcale', async () => {
    respond(200, text('{}'));

    await expect(
      askOpenAi('sk-test', 'gpt-test', 'Co to', { image: { mimeType: 'image/heic', data: 'QUJD' } }),
    ).rejects.toThrow(AiError);
    expect(sent).toHaveLength(0);
  });

  it('wyczerpany limit mówi o limicie, a nie kodem błędu', async () => {
    respond(429, { error: { message: 'rate limit' } });

    await expect(askOpenAi('sk-test', 'gpt-test', 'Policz')).rejects.toThrow(
      'Wyczerpany limit zapytań do ChatGPT. Spróbuj później.',
    );
  });

  it('pustą odpowiedź traktuje jak awarię, a nie jak wynik', async () => {
    respond(200, { choices: [{ message: { content: null } }] });

    await expect(askOpenAi('sk-test', 'gpt-test', 'Policz')).rejects.toThrow(
      'ChatGPT zwrócił pustą odpowiedź.',
    );
  });
});

describe('parseOpenAiModels', () => {
  it('odsiewa modele od innej roboty niż pisanie tekstu', () => {
    const models = parseOpenAiModels({
      data: [
        { id: 'gpt-test' },
        { id: 'text-embedding-3-large' },
        { id: 'dall-e-3' },
        { id: 'whisper-1' },
        { id: 'gpt-test-audio' },
      ],
    });

    expect(models.map((model) => model.id)).toEqual(['gpt-test']);
  });

  it('zapowiedzi schodzą na dół listy, bo znikają bez uprzedzenia', () => {
    const models = parseOpenAiModels({ data: [{ id: 'gpt-b-preview' }, { id: 'gpt-a' }] });

    expect(models.map((model) => model.id)).toEqual(['gpt-a', 'gpt-b-preview']);
  });

  it('pustą odpowiedź oddaje jako pustą listę, zamiast się wywracać', () => {
    expect(parseOpenAiModels(null)).toEqual([]);
  });
});
