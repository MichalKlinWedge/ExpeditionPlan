import type { AiModel } from './models.ts';
import { describeStatus, isBusy } from './status.ts';
import { AiError, logFailure, send } from './transport.ts';

/**
 * Mowa z tekstu (Gemini TTS, `generateContent` z odpowiedzią AUDIO). Tekst jest czytany dosłownie:
 * polecenie o sposobie czytania doklejone do tekstu zostałoby przeczytane na głos. Odpowiedź to WAV
 * (24 kHz, mono, 16 bit), więc zapisujemy ją bez przekodowania. Model wybieramy z listy dostawcy
 * (`speechModel`), nazw nie zgadujemy. Warunki i ceny: docs/USLUGI.md („Gemini TTS”).
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Jedna scena pokazu to kilka zdań; dłuższy tekst czytany jest kilkadziesiąt sekund. */
const SPEECH_TIMEOUT_MS = 90_000;

/** Granica wejścia modeli TTS to 8192 tokeny; z zapasem na polskie znaki. */
export const SPEECH_TEXT_LIMIT = 5_000;

/** Głosy gotowe Gemini z opisem, który podaje Google (po polsku). */
export const SPEECH_VOICES: readonly { name: string; label: string }[] = [
  { name: 'Sulafat', label: 'ciepły' },
  { name: 'Charon', label: 'rzeczowy' },
  { name: 'Achird', label: 'przyjazny' },
  { name: 'Vindemiatrix', label: 'łagodny' },
  { name: 'Sadaltager', label: 'jak przewodnik' },
  { name: 'Iapetus', label: 'wyraźny' },
  { name: 'Gacrux', label: 'dojrzały' },
  { name: 'Algieba', label: 'gładki' },
  { name: 'Despina', label: 'gładki' },
  { name: 'Aoede', label: 'swobodny' },
  { name: 'Callirrhoe', label: 'spokojny' },
  { name: 'Umbriel', label: 'spokojny' },
  { name: 'Schedar', label: 'równy' },
  { name: 'Achernar', label: 'miękki' },
  { name: 'Kore', label: 'stanowczy' },
  { name: 'Orus', label: 'stanowczy' },
  { name: 'Alnilam', label: 'stanowczy' },
  { name: 'Rasalgethi', label: 'rzeczowy' },
  { name: 'Erinome', label: 'wyraźny' },
  { name: 'Zephyr', label: 'jasny' },
  { name: 'Autonoe', label: 'jasny' },
  { name: 'Puck', label: 'pogodny' },
  { name: 'Laomedeia', label: 'pogodny' },
  { name: 'Sadachbia', label: 'żywy' },
  { name: 'Leda', label: 'młodzieńczy' },
  { name: 'Fenrir', label: 'rozemocjonowany' },
  { name: 'Pulcherrima', label: 'śmiały' },
  { name: 'Zubenelgenubi', label: 'luźny' },
  { name: 'Enceladus', label: 'z oddechem' },
  { name: 'Algenib', label: 'chropowaty' },
];

export const DEFAULT_VOICE = 'Sulafat';

export const isSpeechVoice = (name: string): boolean => SPEECH_VOICES.some((voice) => voice.name === name);

const TTS = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?-tts$/;

/**
 * Model mowy z listy dostawcy: najnowszy stabilny Flash-Lite TTS (najtańszy), potem najnowszy Flash TTS.
 * Zapowiedzi (`-preview`) odpadają, bo znikają bez uprzedzenia. `null`, gdy na liście nie ma żadnego.
 */
export function speechModel(models: readonly AiModel[]): string | null {
  const version = (id: string) => Number(TTS.exec(id)?.[1] ?? 0);
  const found = models.map((model) => model.id).filter((id) => TTS.test(id)).sort((a, b) => version(b) - version(a));
  return found.find((id) => id.endsWith('-lite-tts')) ?? found[0] ?? null;
}

/** Długość nagrania WAV (PCM) z nagłówka: rozmiar fragmentu `data` przez liczbę bajtów na sekundę. */
export function wavDurationMs(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!);
  if (wav.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new AiError('Nagranie nie jest plikiem WAV.');
  let byteRate = 0;
  for (let at = 12; at + 8 <= wav.byteLength;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') byteRate = view.getUint32(at + 16, true);
    if (tag(at) === 'data') {
      if (byteRate === 0) break;
      // Strumień bywa zapisany z rozmiarem „do końca pliku” (0xFFFFFFFF); wtedy liczy się to, co faktycznie jest.
      const bytes = Math.min(size, wav.byteLength - at - 8);
      return Math.round((bytes / byteRate) * 1000);
    }
    at += 8 + size + (size % 2);
  }
  throw new AiError('Nagranie WAV nie ma danych dźwięku.');
}

const fromBase64 = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

type SpeechReply = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

export type Speech = { audio: Uint8Array; mimeType: 'audio/wav'; durationMs: number; inputTokens: number; outputTokens: number };

export async function speakGemini(key: string, model: string, text: string, voice: string = DEFAULT_VOICE): Promise<Speech> {
  const said = text.trim();
  if (said === '') throw new AiError('Brak tekstu do przeczytania.');
  if (said.length > SPEECH_TEXT_LIMIT) throw new AiError(`Tekst do przeczytania jest za długi (najwyżej ${SPEECH_TEXT_LIMIT} znaków).`);
  if (!isSpeechVoice(voice)) throw new AiError(`Nie ma głosu „${voice}”.`);

  const response = await send(
    `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: said }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    },
    { provider: 'GEMINI', label: `Gemini ${model} (mowa)`, timeoutMs: SPEECH_TIMEOUT_MS },
  );

  const body = (await response.json().catch(() => null)) as SpeechReply | null;
  if (!response.ok) {
    logFailure(`Gemini ${model} (mowa)`, `HTTP ${response.status}: ${body?.error?.message ?? 'bez treści'}`);
    throw new AiError(describeStatus('GEMINI', response.status, body?.error?.message, model), {
      retryable: response.status >= 500,
      modelGone: response.status === 404,
      busy: isBusy(response.status, body?.error?.message),
    });
  }
  const blocked = body?.promptFeedback?.blockReason;
  if (blocked !== undefined) throw new AiError(`Gemini odmówił przeczytania tekstu (${blocked}).`);

  const inline = body?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (inline?.data === undefined) {
    logFailure(`Gemini ${model} (mowa)`, 'odpowiedź bez dźwięku');
    throw new AiError('Gemini nie zwrócił nagrania.', { retryable: true });
  }
  if (inline.mimeType !== undefined && !/^audio\/(wav|x-wav|wave)/.test(inline.mimeType)) {
    throw new AiError(`Gemini zwrócił dźwięk w nieobsługiwanym formacie (${inline.mimeType}).`);
  }
  const audio = fromBase64(inline.data);
  return {
    audio,
    mimeType: 'audio/wav',
    durationMs: wavDurationMs(audio),
    inputTokens: body?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: body?.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
