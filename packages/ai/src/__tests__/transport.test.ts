import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiError, send } from '../transport.ts';

/**
 * Milczenie serwera i zerwane połączenie. Obie awarie wyglądają na ekranie tak samo — „nie
 * działa” — a zdarzają się częściej niż cokolwiek innego i nie da się ich odtworzyć na żądanie,
 * więc jedyne miejsce, gdzie można je sprawdzić, jest tutaj.
 */

type Fetch = typeof globalThis.fetch;

const OK = { ok: true, status: 200 } as Response;

let signals: (AbortSignal | null | undefined)[] = [];
let warnings: string[] = [];

/** Zapytanie, które nigdy nie odpowiada — czyli dokładnie to, przed czym broni limit czasu. */
const silent: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    signals.push(init?.signal);
    init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });

const useFetch = (impl: Fetch) => {
  globalThis.fetch = impl;
};

beforeEach(() => {
  vi.useFakeTimers();
  signals = [];
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('send', () => {
  it('oddaje odpowiedź i nie przerywa jej po czasie', async () => {
    useFetch(((_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      return Promise.resolve(OK);
    }) as Fetch);

    const response = await send('https://example.test', {}, { provider: 'GEMINI', label: 'test', timeoutMs: 1000 });
    expect(response).toBe(OK);

    // Zegar po udanej odpowiedzi musi być skasowany — inaczej przerwałby następne zapytanie.
    vi.advanceTimersByTime(5000);
    expect(signals[0]?.aborted).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it('przerywa ciszę i mówi, ile czekał', async () => {
    useFetch(silent);

    const promise = send('https://example.test', {}, { provider: 'GEMINI', label: 'test', timeoutMs: 60_000 });
    await Promise.resolve();
    vi.advanceTimersByTime(60_000);

    // Liczba trzyma się jednostki twardą spacją, jak wszędzie w aplikacji — stąd \s zamiast spacji.
    await expect(promise).rejects.toThrow(/^Gemini nie odpowiedział przez 60\ssekund\.$/);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('po ciszy proponuje powtórzenie, bo taka awaria mija sama', async () => {
    useFetch(silent);

    const promise = send('https://example.test', {}, { provider: 'GEMINI', label: 'test', timeoutMs: 1000 });
    await Promise.resolve();
    vi.advanceTimersByTime(1000);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).retryable).toBe(true);
  });

  it('odróżnia brak drogi do Google od ciszy po jego stronie', async () => {
    useFetch((() => Promise.reject(new TypeError('Network request failed'))) as Fetch);

    await expect(
      send('https://example.test', {}, { provider: 'GEMINI', label: 'test', timeoutMs: 1000 }),
    ).rejects.toThrow('Zapytanie nie dotarło do Google — sprawdź połączenie z internetem.');
  });

  it('zostawia powód w logu telefonu, bo komunikat na ekranie go nie niesie', async () => {
    useFetch((() => Promise.reject(new TypeError('Network request failed'))) as Fetch);

    await send('https://example.test', {}, { provider: 'GEMINI', label: 'lista modeli', timeoutMs: 1000 }).catch(
      () => {},
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('lista modeli');
    expect(warnings[0]).toContain('Network request failed');
  });
});
