import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askClaude, parseClaudeModels } from '../claude.ts';
import { AiError } from '../transport.ts';

/**
 * Kształt zapytania do Anthropic i odczyt odpowiedzi.
 *
 * Tego nie sprawdzi nic poza testem: na telefonie widać tylko „nie udało się”, a pomyłka w nazwie
 * pola czy w nagłówku wraca jako odmowa, z której nie wynika, co jest nie tak.
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

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

const body = (call: Sent) => JSON.parse(String(call.init.body)) as Record<string, unknown>;

beforeEach(() => {
  sent = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('askClaude', () => {
  it('wysyła polecenie z kluczem w nagłówku i wersją API', async () => {
    respond(200, text('{"ok":true}'));

    await expect(askClaude('sk-test', 'claude-sonnet-5-5', 'Policz kalorie')).resolves.toBe(
      '{"ok":true}',
    );

    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = sent[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body(sent[0]!)).toMatchObject({ model: 'claude-sonnet-5-5' });
    // Anthropic wymaga limitu długości odpowiedzi — bez niego zapytanie w ogóle nie przejdzie.
    expect(body(sent[0]!).max_tokens).toEqual(expect.any(Number));
  });

  it('zdjęcie idzie przed tekstem, bo polecenie się do niego odwołuje', async () => {
    respond(200, text('{}'));

    await askClaude('sk-test', 'claude-sonnet-5-5', 'Na zdjęciu jest to samo jedzenie', { image: {
      mimeType: 'image/jpeg',
      data: 'QUJD',
    } });

    expect(body(sent[0]!).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
          { type: 'text', text: 'Na zdjęciu jest to samo jedzenie' },
        ],
      },
    ]);
  });

  it('formatu, którego Anthropic nie przyjmuje, nie wysyła wcale', async () => {
    respond(200, text('{}'));

    await expect(
      askClaude('sk-test', 'claude-sonnet-5-5', 'Co to', { image: { mimeType: 'image/heic', data: 'QUJD' } }),
    ).rejects.toThrow(AiError);
    expect(sent).toHaveLength(0);
  });

  it('tłumaczy odmowę na radę, co zrobić', async () => {
    respond(401, { error: { message: 'invalid x-api-key' } });

    await expect(askClaude('zły', 'claude-sonnet-5-5', 'Policz')).rejects.toThrow(
      'Klucz do Claude jest nieważny albo bez uprawnień.',
    );
  });

  it('przeciążenie po stronie Anthropic wolno powtórzyć', async () => {
    respond(529, { error: { message: 'overloaded' } });

    const error = (await askClaude('sk-test', 'claude-sonnet-5-5', 'Policz').then(
      () => null,
      (e: unknown) => e,
    )) as AiError;

    expect(error.message).toContain('przeciążony');
    expect(error.retryable).toBe(true);
  });

  it('pustą odpowiedź traktuje jak awarię, a nie jak wynik', async () => {
    respond(200, { content: [{ type: 'text', text: '   ' }] });

    await expect(askClaude('sk-test', 'claude-sonnet-5-5', 'Policz')).rejects.toThrow(
      'Claude zwrócił pustą odpowiedź.',
    );
  });

  it('skleja odpowiedź z kilku części i pomija to, co nie jest tekstem', async () => {
    respond(200, { content: [{ type: 'thinking' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] });

    await expect(askClaude('sk-test', 'claude-sonnet-5-5', 'Policz')).resolves.toBe('{"a":1}');
  });
});

describe('parseClaudeModels', () => {
  it('czyta listę i bierze nazwę po ludzku, gdy jest', () => {
    expect(
      parseClaudeModels({
        data: [
          { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
          { id: 'claude-haiku-5-5' },
        ],
      }),
    ).toEqual([
      { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    ]);
  });

  it('pustą odpowiedź oddaje jako pustą listę, zamiast się wywracać', () => {
    expect(parseClaudeModels(null)).toEqual([]);
    expect(parseClaudeModels({ data: null })).toEqual([]);
  });
});
