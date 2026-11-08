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
  return speechModels(models)[0] ?? null;
}

/**
 * Modele mowy w kolejności użycia: najnowszy Flash-Lite TTS, potem najnowszy Flash TTS. Każdy ma u Google osobny
 * limit zapytań, więc gdy jeden go wyczerpie, drugi zwykle jeszcze nagra (`speakFirst`).
 */
export function speechModels(models: readonly AiModel[]): string[] {
  const version = (id: string) => Number(TTS.exec(id)?.[1] ?? 0);
  const found = models.map((model) => model.id).filter((id) => TTS.test(id)).sort((a, b) => version(b) - version(a));
  return [found.find((id) => id.endsWith('-lite-tts')), found.find((id) => !id.endsWith('-lite-tts'))].filter((id): id is string => id !== undefined);
}

/** Limit Google: dzienny (do jutra nic nie nagra) albo na minutę (`retryAfterS` = ile odczekać, jeśli Google podał). */
export type SpeechLimit = { daily: boolean; retryAfterS: number | null };

/** Odmowa z limitu zapytań (HTTP 429) z tym, co Google powiedział o limicie. */
export class SpeechLimitError extends AiError {
  readonly limit: SpeechLimit;
  constructor(message: string, limit: SpeechLimit) {
    super(message, { busy: true });
    this.name = 'SpeechLimitError';
    this.limit = limit;
  }
}

type ErrorBody = { error?: { message?: string; details?: { '@type'?: string; violations?: { quotaId?: string; quotaMetric?: string; quotaValue?: string }[]; retryDelay?: string }[] } };

/** Rodzaj limitu z odpowiedzi 429: `QuotaFailure` mówi, który (per day / per minute), `RetryInfo` ile czekać. */
export function speechLimit(body: unknown): SpeechLimit & { perDay: number | null } {
  const details = (body as ErrorBody | null)?.error?.details ?? [];
  const violations = details.flatMap((detail) => (detail['@type']?.endsWith('QuotaFailure') ? (detail.violations ?? []) : []));
  const dailyHit = violations.find((each) => /per ?day/i.test(`${each.quotaId ?? ''} ${each.quotaMetric ?? ''}`.replace(/_/g, ' ')));
  const delay = details.find((detail) => detail['@type']?.endsWith('RetryInfo'))?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  const said = /retry in ([\d.]+)\s*s/i.exec((body as ErrorBody | null)?.error?.message ?? '');
  const retryAfterS = Number.isFinite(seconds) ? Math.ceil(seconds) : said ? Math.ceil(Number(said[1])) : null;
  return { daily: dailyHit !== undefined, retryAfterS, perDay: dailyHit?.quotaValue ? Number(dailyHit.quotaValue) : null };
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
    if (response.status === 429) {
      const limit = speechLimit(body);
      throw new SpeechLimitError(
        limit.daily
          ? `Wyczerpany dzienny limit Gemini TTS dla modelu „${model}”${limit.perDay ? ` (${limit.perDay} nagrań na dobę na darmowym poziomie)` : ''}.`
          : `Limit zapytań na minutę Gemini TTS dla modelu „${model}”.`,
        { daily: limit.daily, retryAfterS: limit.retryAfterS },
      );
    }
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

/**
 * Nagranie pierwszym modelem, który przepuści zapytanie: limit jednego (`SpeechLimitError`) przechodzi do następnego.
 * Gdy wszystkie odmówią, błąd mówi, czy czekać (najkrótszy `retryAfterS` limitu minutowego), czy dziś już nic nie nagra.
 * `skip` pomija modele, o których wiadomo, że dziś wyczerpały limit; `onLimit` dostaje każdą odmowę.
 */
export async function speakFirst(
  key: string,
  models: readonly string[],
  text: string,
  voice: string,
  options: { skip?: (model: string) => boolean; onLimit?: (model: string, limit: SpeechLimit) => void } = {},
): Promise<{ speech: Speech; model: string }> {
  const limits: SpeechLimit[] = [];
  let last: SpeechLimitError | undefined;
  for (const model of models) {
    if (options.skip?.(model)) {
      limits.push({ daily: true, retryAfterS: null });
      continue;
    }
    try {
      return { speech: await speakGemini(key, model, text, voice), model };
    } catch (error) {
      if (!(error instanceof SpeechLimitError)) throw error;
      options.onLimit?.(model, error.limit);
      limits.push(error.limit);
      last = error;
    }
  }
  if (limits.length === 0) throw new AiError('Brak modelu do czytania tekstu (Gemini TTS).');
  if (limits.every((limit) => limit.daily)) {
    throw new SpeechLimitError(
      `${last?.message ?? 'Wyczerpany dzienny limit Gemini TTS.'} Pozostałe modele mowy też go dziś wyczerpały: nagrasz dalej jutro albo po włączeniu płatnego poziomu w Google AI Studio.`,
      { daily: true, retryAfterS: null },
    );
  }
  const waits = limits.filter((limit) => !limit.daily).map((limit) => limit.retryAfterS ?? 30);
  throw new SpeechLimitError(last?.message ?? 'Limit zapytań Gemini TTS.', { daily: false, retryAfterS: Math.min(...waits) });
}
