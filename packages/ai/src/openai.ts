import { type AiModel, isModelName, normalizeModel, OTHER_WORK, sortModels } from './models.ts';
import type { AskOptions } from './providers.ts';
import { describeStatus } from './status.ts';
import { AiError, logFailure, send } from './transport.ts';

/** ChatGPT (OpenAI Chat Completions). */

const ENDPOINT = 'https://api.openai.com/v1';

/** Na samą listę modeli czekamy krócej: to jedno zdanie odpowiedzi, nie praca modelu. */
const LIST_TIMEOUT_MS = 20_000;

/** Formaty, które OpenAI przyjmuje jako obraz. */
const IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

type Reply = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; type?: string };
};

export async function askOpenAi(
  key: string,
  model: string,
  prompt: string,
  options: AskOptions = {},
): Promise<string> {
  const image = options.image;
  if (image != null && !IMAGES.includes(image.mimeType)) {
    throw new AiError('ChatGPT nie przyjmuje obrazów w tym formacie.');
  }

  // Obraz idzie przed tekstem, bo polecenie się do niego odwołuje — tak samo jak u pozostałych.
  const content: unknown[] = [];
  if (image != null) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    });
  }
  content.push({ type: 'text', text: prompt });

  const messages: unknown[] = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content });

  const response = await send(
    `${ENDPOINT}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      // Bez `temperature`, limitu długości i wymuszania formatu: nowsze rodziny modeli odrzucają te
      // pola całym zapytaniem (doświadczenie z FormaSync). O czysty JSON prosi polecenie, a każdą
      // odpowiedź i tak przepuszczamy przez wyłuskanie JSON-a i walidator.
      body: JSON.stringify({ model, messages }),
    },
    {
      provider: 'OPENAI',
      label: `ChatGPT ${model}${image ? ' z obrazem' : ''}`,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    },
  );

  const body = (await response.json().catch(() => null)) as Reply | null;
  if (!response.ok) {
    logFailure(`ChatGPT ${model}`, `HTTP ${response.status}: ${body?.error?.message ?? 'bez treści'}`);
    throw new AiError(describeStatus('OPENAI', response.status, body?.error?.message, model), {
      retryable: response.status >= 500,
      modelGone: response.status === 404,
    });
  }

  const choice = body?.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (text.trim() === '') {
    logFailure(`ChatGPT ${model}`, 'pusta odpowiedź');
    throw new AiError('ChatGPT zwrócił pustą odpowiedź.', { retryable: true });
  }
  if (choice?.finish_reason === 'length') {
    logFailure(`ChatGPT ${model}`, 'odpowiedź ucięta na limicie długości');
    throw new AiError('Odpowiedź ChatGPT urwała się na limicie długości. Podziel zadanie na mniejsze.');
  }
  return text;
}

type ModelRow = { id?: string | null };

export type OpenAiListReply = { data?: ModelRow[] | null } | null;

/**
 * Lista modeli z odpowiedzi OpenAI. Zwraca wszystko, co konto umie wywołać — razem z osadzaniem,
 * mową i obrazem — a spisu umiejętności przy modelu nie ma, więc zostaje odsiew po nazwie.
 */
export function parseOpenAiModels(body: OpenAiListReply): AiModel[] {
  const found = new Map<string, AiModel>();

  for (const row of body?.data ?? []) {
    const id = normalizeModel(row?.id ?? '');
    if (id === '' || !isModelName(id) || OTHER_WORK.test(id)) continue;
    if (!found.has(id)) found.set(id, { id, label: id });
  }

  return sortModels([...found.values()]);
}

export async function openAiModels(key: string): Promise<AiModel[]> {
  const response = await send(
    `${ENDPOINT}/models`,
    { headers: { Authorization: `Bearer ${key}` } },
    { provider: 'OPENAI', label: 'ChatGPT — lista modeli', timeoutMs: LIST_TIMEOUT_MS },
  );

  const body = (await response.json().catch(() => null)) as
    | (OpenAiListReply & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    logFailure('ChatGPT — lista modeli', `HTTP ${response.status}: ${body?.error?.message ?? 'bez treści'}`);
    throw new AiError(describeStatus('OPENAI', response.status, body?.error?.message, ''), {
      retryable: response.status >= 500,
    });
  }

  const models = parseOpenAiModels(body);
  if (models.length === 0) throw new AiError('OpenAI nie zwrócił ani jednego modelu do tekstu.');
  return models;
}
