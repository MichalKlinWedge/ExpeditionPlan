import { type AiModel, isModelName, normalizeModel, OTHER_WORK, sortModels } from './models.ts';
import type { AiImage, AskOptions } from './providers.ts';
import { describeStatus } from './status.ts';
import { AiError, logFailure, send } from './transport.ts';

/** Gemini (Google Generative Language API). */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Na samą listę modeli czekamy krócej: to jedno zdanie odpowiedzi, nie praca modelu. */
const LIST_TIMEOUT_MS = 20_000;

/** Formaty, które Google przyjmuje jako obraz. */
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

/**
 * Części wiadomości. Obraz idzie **przed** tekstem: model czyta części po kolei, więc polecenie
 * odwołujące się do obrazu musi mieć go już za sobą. Nazwy pól w stylu REST API Google
 * (`inline_data`, `mime_type`), a nie w camelCase.
 */
export function contentParts(prompt: string, image?: AiImage | null): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (image != null) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }
  parts.push({ text: prompt });
  return parts;
}

/** Odpowiedź w postaci, jakiej potrzebujemy. Każde pole może nie przyjść. */
type Reply = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

export async function askGemini(
  key: string,
  model: string,
  prompt: string,
  options: AskOptions = {},
): Promise<string> {
  const image = options.image;
  if (image != null && !IMAGES.includes(image.mimeType)) {
    throw new AiError('Gemini nie przyjmuje obrazów w tym formacie.');
  }

  const generationConfig: Record<string, unknown> = {
    // Prosimy o JSON wprost; sam kształt opisuje polecenie, a odpowiedź i tak przechodzi przez
    // walidator Zod — schemat Gemini to osobna składnia, a jeden błąd w niej wywraca zapytanie.
    responseMimeType: 'application/json',
    temperature: 0.4,
  };
  if (options.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;

  const response = await send(
    `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
        contents: [{ parts: contentParts(prompt, image) }],
        generationConfig,
      }),
    },
    {
      provider: 'GEMINI',
      label: `Gemini ${model}${image ? ' z obrazem' : ''}`,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    },
  );

  const body = (await response.json().catch(() => null)) as Reply | null;
  if (!response.ok) {
    logFailure(`Gemini ${model}`, `HTTP ${response.status}: ${body?.error?.message ?? 'bez treści'}`);
    // Awarię po stronie Google warto powtórzyć; odmowę z klucza albo z nazwy modelu — nie.
    throw new AiError(describeStatus('GEMINI', response.status, body?.error?.message, model), {
      retryable: response.status >= 500,
      modelGone: response.status === 404,
    });
  }

  const blocked = body?.promptFeedback?.blockReason;
  if (blocked !== undefined) {
    logFailure(`Gemini ${model}`, `odmowa: ${blocked}`);
    throw new AiError(`Gemini odmówił odpowiedzi (${blocked}).`);
  }

  const candidate = body?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim() === '') {
    logFailure(`Gemini ${model}`, 'pusta odpowiedź');
    throw new AiError('Gemini zwrócił pustą odpowiedź.', { retryable: true });
  }
  if (candidate?.finishReason === 'MAX_TOKENS') {
    logFailure(`Gemini ${model}`, 'odpowiedź ucięta na limicie długości');
    throw new AiError('Odpowiedź Gemini urwała się na limicie długości. Podnieś maxTokens albo podziel zadanie.');
  }
  return text;
}

type ModelRow = {
  name?: string | null;
  displayName?: string | null;
  supportedGenerationMethods?: string[] | null;
};

export type ModelListReply = { models?: ModelRow[] | null } | null;

/** Lista modeli z odpowiedzi Google, zawężona do tych, które potrafią napisać tekst. */
export function parseModelList(body: ModelListReply): AiModel[] {
  const found = new Map<string, AiModel>();

  for (const row of body?.models ?? []) {
    const id = normalizeModel(row?.name ?? '');
    if (id === '' || !isModelName(id)) continue;

    const methods = row?.supportedGenerationMethods;
    if (Array.isArray(methods) && methods.length > 0) {
      if (!methods.includes('generateContent')) continue;
    } else if (OTHER_WORK.test(id)) {
      // Spis metod bywa pusty — wtedy zostaje nazwa. Lepiej pokazać model za dużo niż pustą listę.
      continue;
    }

    if (!found.has(id)) found.set(id, { id, label: row?.displayName?.trim() || id });
  }

  return sortModels([...found.values()]);
}

export async function geminiModels(key: string): Promise<AiModel[]> {
  const response = await send(
    `${ENDPOINT}?key=${encodeURIComponent(key)}&pageSize=200`,
    {},
    { provider: 'GEMINI', label: 'Gemini — lista modeli', timeoutMs: LIST_TIMEOUT_MS },
  );

  const body = (await response.json().catch(() => null)) as
    | (ModelListReply & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    logFailure('Gemini — lista modeli', `HTTP ${response.status}: ${body?.error?.message ?? 'bez treści'}`);
    throw new AiError(describeStatus('GEMINI', response.status, body?.error?.message, ''), {
      retryable: response.status >= 500,
    });
  }

  const models = parseModelList(body);
  if (models.length === 0) throw new AiError('Google nie zwrócił ani jednego modelu do tekstu.');
  return models;
}
