import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiClient, NoApiKeyError, NoModelError } from '../client.ts';
import { contentParts } from '../gemini.ts';
import { memoryRejectedStore } from '../rejected.ts';
import { AiError } from '../transport.ts';

/**
 * Jedno wejście do trzech dostawców: wybór klucza i modelu z konfiguracji, zapamiętywanie
 * modeli, których klucz nie obsłuży.
 */

let urls: string[] = [];

const respond = (status: number, body: unknown) => {
  globalThis.fetch = ((url: string) => {
    urls.push(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }) as typeof globalThis.fetch;
};

beforeEach(() => {
  urls = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAiClient', () => {
  it('pyta domyślnego dostawcę i mówi, kto odpowiedział', async () => {
    respond(200, { content: [{ type: 'text', text: '{"ok":true}' }] });
    const client = createAiClient({ keys: { CLAUDE: 'sk-test' } });

    await expect(client.ask('Zaplanuj')).resolves.toEqual({
      text: '{"ok":true}',
      provider: 'CLAUDE',
      model: 'claude-sonnet-5-5',
    });
  });

  it('bez klucza nie wysyła niczego', async () => {
    respond(200, {});
    const client = createAiClient({ keys: {} });

    await expect(client.ask('Zaplanuj', { provider: 'GEMINI' })).rejects.toBeInstanceOf(NoApiKeyError);
    expect(urls).toHaveLength(0);
  });

  it('bez wskazanego modelu nie zgaduje nazwy', async () => {
    const client = createAiClient({ keys: { OPENAI: 'sk-test' } });

    await expect(client.ask('Zaplanuj', { provider: 'OPENAI' })).rejects.toBeInstanceOf(NoModelError);
  });

  it('nazwę ze strony dostawcy sprowadza do identyfikatora', async () => {
    respond(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    const client = createAiClient({
      keys: { GEMINI: 'g-test' },
      models: { GEMINI: 'Gemini 3.8 Flash' },
      defaultProvider: 'GEMINI',
    });

    const answer = await client.ask('Zaplanuj');

    expect(answer.model).toBe('gemini-3.8-flash');
    expect(urls[0]).toContain('/gemini-3.8-flash:generateContent');
  });

  it('model odrzucony przez dostawcę znika z listy do wyboru', async () => {
    const rejected = memoryRejectedStore();
    const client = createAiClient({ keys: { CLAUDE: 'sk-test' }, rejected });

    respond(404, { error: { message: 'model not found' } });
    const error = await client.ask('Zaplanuj').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);

    respond(200, { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }] });
    const models = await client.listModels('CLAUDE');

    expect(models.map((model) => model.id)).toEqual(['claude-haiku-5-5']);
  });
});

describe('contentParts (Gemini)', () => {
  it('obraz idzie przed tekstem, bo polecenie się do niego odwołuje', () => {
    expect(contentParts('Co to za rezerwacja?', { mimeType: 'image/png', data: 'QUJD' })).toEqual([
      { inline_data: { mime_type: 'image/png', data: 'QUJD' } },
      { text: 'Co to za rezerwacja?' },
    ]);
  });
});
