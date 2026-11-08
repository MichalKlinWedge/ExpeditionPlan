import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { speakGemini, speechModel, wavDurationMs } from '../speech.ts';
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
