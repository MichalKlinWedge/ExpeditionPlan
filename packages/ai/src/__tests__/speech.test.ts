import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { speakFirst, speakGemini, SpeechLimitError, speechLimit, speechModel, speechModels, wavDurationMs } from '../speech.ts';
import { AiError } from '../transport.ts';

/** Mowa z Gemini: wybór modelu z listy, długość nagrania z nagłówka WAV, kształt zapytania i odpowiedzi. */

/** WAV PCM 24 kHz mono 16 bit z `samples` próbkami ciszy. */
function wav(samples: number): Uint8Array {
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => [...text].forEach((char, index) => (bytes[at + index] = char.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

let requests: { url: string; body: unknown }[] = [];
const respond = (status: number, body: unknown) => {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response);
  }) as typeof globalThis.fetch;
};

const realFetch = globalThis.fetch;
beforeEach(() => {
  requests = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('speechModel', () => {
  const list = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

  it('bierze najnowszy stabilny Flash-Lite TTS, bez zapowiedzi', () => {
    expect(speechModel(list('gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.5-flash-lite'))).toBe('gemini-3.8-flash-lite-tts');
  });

  it('bez Flash-Lite bierze Flash TTS, bez żadnego zwraca null', () => {
    expect(speechModel(list('gemini-3.8-flash-tts', 'gemini-2.5-pro-preview-tts'))).toBe('gemini-3.8-flash-tts');
    expect(speechModel(list('gemini-3.5-flash-lite', 'gemini-2.5-flash-preview-tts'))).toBeNull();
  });
});

describe('wavDurationMs', () => {
  it('liczy długość z fragmentu data', () => {
    expect(wavDurationMs(wav(36_000))).toBe(1500);
  });

  it('odrzuca plik, który nie jest WAV-em', () => {
    expect(() => wavDurationMs(new Uint8Array(20))).toThrow(AiError);
  });
});

describe('speakGemini', () => {
  it('wysyła tekst z głosem i zwraca nagranie z długością', async () => {
    respond(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: base64(wav(24_000)) } }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 25 } });
    const speech = await speakGemini('klucz', 'gemini-3.8-flash-lite-tts', '  Dzień pierwszy.  ', 'Charon');
    expect(speech.durationMs).toBe(1000);
    expect(speech.outputTokens).toBe(25);
    expect(requests[0]!.url).toContain('/gemini-3.8-flash-lite-tts:generateContent');
    expect(requests[0]!.body).toEqual({
      contents: [{ parts: [{ text: 'Dzień pierwszy.' }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } },
    });
  });

  it('nie wysyła pustego tekstu ani nieznanego głosu', async () => {
    respond(200, {});
    await expect(speakGemini('klucz', 'm', '   ')).rejects.toThrow('Brak tekstu');
    await expect(speakGemini('klucz', 'm', 'Tekst', 'Nikt')).rejects.toThrow('Nie ma głosu');
    expect(requests).toHaveLength(0);
  });

  it('odpowiedź bez dźwięku to błąd do powtórzenia', async () => {
    respond(200, { candidates: [{ content: { parts: [{ text: 'nie umiem' }] } }] });
    await expect(speakGemini('klucz', 'm', 'Tekst')).rejects.toMatchObject({ retryable: true });
  });
});

const quota = (quotaId: string, retryDelay?: string) => ({
  error: {
    code: 429,
    message: 'You exceeded your current quota.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue: '15' }] },
      ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
    ],
  },
});

describe('limity Gemini TTS', () => {
  it('rozpoznaje limit dzienny i minutowy z czasem do odczekania', () => {
    expect(speechLimit(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '37s'))).toEqual({ daily: true, retryAfterS: 37, perDay: 15 });
    expect(speechLimit(quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '12.4s'))).toEqual({ daily: false, retryAfterS: 13, perDay: null });
    expect(speechLimit({ error: { message: 'Please retry in 8.2s.' } })).toEqual({ daily: false, retryAfterS: 9, perDay: null });
  });

  it('modele mowy: najpierw Flash-Lite, potem Flash, każdy najnowszy', () => {
    const list = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
    expect(speechModels(list('gemini-3.5-flash-tts', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.5-flash-lite-tts'))).toEqual(['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']);
  });

  it('limit dzienny jednego modelu przechodzi do drugiego', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      return url.includes('-lite-tts')
        ? new Response(JSON.stringify(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')), { status: 429 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: base64(wav(24_000)) } }] } }] }), { status: 200 });
    }) as typeof fetch;
    const limits: string[] = [];
    const result = await speakFirst('klucz', ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'], 'Tekst', 'Sulafat', { onLimit: (model, limit) => limits.push(`${model}:${limit.daily}`) });
    expect(result.model).toBe('gemini-3.8-flash-tts');
    expect(limits).toEqual(['gemini-3.8-flash-lite-tts:true']);
  });

  it('wszystkie dzienne: bez czekania; któryś minutowy: najkrótsze czekanie', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')), { status: 429 })) as typeof fetch;
    const daily = await speakFirst('klucz', ['a-tts', 'b-tts'], 'Tekst', 'Sulafat').catch((e: unknown) => e);
    expect(daily).toBeInstanceOf(SpeechLimitError);
    expect((daily as SpeechLimitError).limit).toEqual({ daily: true, retryAfterS: null });
    expect((daily as SpeechLimitError).message).toContain('jutro');

    globalThis.fetch = (async (url: string) =>
      new Response(JSON.stringify(url.includes('a-tts') ? quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier') : quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '20s')), { status: 429 })) as typeof fetch;
    const minute = await speakFirst('klucz', ['a-tts', 'b-tts'], 'Tekst', 'Sulafat').catch((e: unknown) => e);
    expect((minute as SpeechLimitError).limit).toEqual({ daily: false, retryAfterS: 20 });
  });

  it('model pominięty (wiadomo, że dziś wyczerpał limit) nie dostaje zapytania', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: base64(wav(24_000)) } }] } }] }), { status: 200 });
    }) as typeof fetch;
    const result = await speakFirst('klucz', ['a-tts', 'b-tts'], 'Tekst', 'Sulafat', { skip: (model) => model === 'a-tts' });
    expect(result.model).toBe('b-tts');
    expect(seen).toHaveLength(1);
  });
});
