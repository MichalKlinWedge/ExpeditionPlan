import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiClient, NoApiKeyError, NoModelError } from '../client.ts';
import { contentParts } from '../gemini.ts';
import { fallbackModels } from '../models.ts';
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

describe('failover: przeciążony model', () => {
  const OK = { candidates: [{ content: { parts: [{ text: '{}' }] } }] };
  const LIST = {
    models: [
      { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-pro-latest', supportedGenerationMethods: ['generateContent'] },
    ],
  };
  /** Odpowiedź według modelu z adresu: każdy model odmawia, dopóki nie wskaże się go w `working`. */
  const serve = (working: string[], status = 503) => {
    globalThis.fetch = ((url: string) => {
      urls.push(url);
      const answer = (code: number, body: unknown) => Promise.resolve({ ok: code === 200, status: code, json: () => Promise.resolve(body) } as unknown as Response);
      if (!url.includes(':generateContent')) return answer(200, LIST);
      return working.some((name) => url.includes(`/${name}:`)) ? answer(200, OK) : answer(status, { error: { message: 'The model is overloaded.' } });
    }) as typeof globalThis.fetch;
  };
  const client = () => createAiClient({ keys: { GEMINI: 'g-test' }, models: { GEMINI: 'gemini-3.5-flash-lite' }, defaultProvider: 'GEMINI', failover: { retryDelayMs: 0 } });
  const asked = () => urls.filter((url) => url.includes(':generateContent')).map((url) => /models\/([^:]+):/.exec(url)?.[1]);

  it('ponawia raz ten sam model, a gdy minie, nie szuka zastępcy', async () => {
    let calls = 0;
    globalThis.fetch = ((url: string) => {
      urls.push(url);
      calls += 1;
      const code = calls === 1 ? 503 : 200;
      return Promise.resolve({ ok: code === 200, status: code, json: () => Promise.resolve(code === 200 ? OK : { error: { message: 'overloaded' } }) } as unknown as Response);
    }) as typeof globalThis.fetch;
    await expect(client().ask('Zaplanuj')).resolves.toMatchObject({ model: 'gemini-3.5-flash-lite' });
    expect(urls).toHaveLength(2);
  });

  it('po drugiej odmowie bierze tani model z listy i zostaje przy nim', async () => {
    serve(['gemini-3.1-flash-lite']);
    const each = client();
    await expect(each.ask('Zaplanuj')).resolves.toMatchObject({ model: 'gemini-3.1-flash-lite' });
    expect(asked()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    urls = [];
    await expect(each.ask('Dalej')).resolves.toMatchObject({ model: 'gemini-3.1-flash-lite' });
    expect(asked()).toEqual(['gemini-3.1-flash-lite']);
  });

  it('wyczerpany limit też przełącza, a gdy nikt nie odpowie, zostaje pierwsza odmowa', async () => {
    serve(['gemini-3.8-flash'], 429);
    await expect(client().ask('Zaplanuj')).resolves.toMatchObject({ model: 'gemini-3.8-flash' });
    urls = [];
    serve([]);
    await expect(client().ask('Zaplanuj')).rejects.toThrow('„gemini-3.5-flash-lite” jest w tej chwili przeciążony');
    expect(asked()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']);
  });

  it('błędny klucz nie przełącza, a bez `failover` nie ma żadnego powtórzenia', async () => {
    serve([], 403);
    await expect(client().ask('Zaplanuj')).rejects.toThrow('nieważny');
    expect(asked()).toHaveLength(1);
    urls = [];
    serve([]);
    await expect(createAiClient({ keys: { GEMINI: 'g-test' }, models: { GEMINI: 'gemini-3.5-flash-lite' }, defaultProvider: 'GEMINI' }).ask('Zaplanuj')).rejects.toBeInstanceOf(AiError);
    expect(asked()).toHaveLength(1);
  });
});

describe('fallbackModels', () => {
  const names = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

  it('najnowszy Flash-Lite, potem najnowszy Flash; bez Pro, zapowiedzi, `-latest` i modeli od mowy', () => {
    const all = names('gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.8-flash-tts', 'gemini-flash-latest', 'gemini-pro-latest');
    expect(fallbackModels(all, 'gemini-3.5-flash-lite')).toEqual(['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
    expect(fallbackModels(all, 'gemini-3.8-flash')).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  });

  it('dla innych dostawców nie ma zastępców', () => {
    expect(fallbackModels(names('claude-sonnet-5-5', 'claude-haiku-5-5'), 'claude-sonnet-5-5')).toEqual([]);
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
