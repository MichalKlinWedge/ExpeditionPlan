import type { z } from 'zod';

import type { AiAnswer, AiClient, AiRequest } from './client.ts';
import { AiError, logFailure } from './transport.ts';

/**
 * Odpowiedź modelu jako dane zgodne ze schematem (SPECYFIKACJA §4, zasada 2).
 *
 * Model dostaje polecenie z opisem kształtu, odpowiedź przechodzi przez wyłuskanie JSON-a
 * i walidator Zod. Niezgodna dostaje **jedną** próbę naprawy z listą błędów — druga porażka
 * kończy się błędem, a nie zgadywaniem, bo zgadnięty plan jest gorszy niż żaden.
 */

/**
 * Wyłuskanie JSON-a z odpowiedzi modelu. Prosimy o czysty JSON i zwykle taki przychodzi, ale
 * „zwykle” nie jest kontraktem: raz dojdzie znacznik kodu, raz zdanie wstępu.
 */
export function unwrapJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced === null ? text : (fenced[1] ?? '')).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  // Pierwsza domknięta wartość, z pominięciem nawiasów w napisach. Model potrafi dopisać po JSON-ie
  // drugi obiekt albo zdanie z klamrą — „ostatnia klamra w tekście” sklejała wtedy dwa obiekty.
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const char = body[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export class AiValidationError extends AiError {
  readonly issues: string[];
  readonly raw: string;

  constructor(issues: string[], raw: string) {
    super('Odpowiedź modelu nie zgadza się ze schematem, także po próbie naprawy.', { retryable: true });
    this.name = 'AiValidationError';
    this.issues = issues;
    this.raw = raw;
  }
}

export type StructuredAnswer<T> = AiAnswer & { data: T; attempts: number };

type Checked<T> = { ok: true; data: T } | { ok: false; issues: string[] };

function check<T>(schema: z.ZodType<T>, text: string): Checked<T> {
  const json = unwrapJson(text);
  if (json === null) return { ok: false, issues: ['W odpowiedzi nie ma obiektu JSON.'] };

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, issues: [`JSON nie daje się odczytać: ${(error as Error).message}`] };
  }

  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(korzeń)'}: ${issue.message}`),
  };
}

/** Ile błędów walidacji pokazujemy modelowi przy naprawie — reszta to zwykle skutki tych samych. */
const MAX_ISSUES = 30;

function repairPrompt(prompt: string, previous: string, issues: string[]): string {
  return [
    prompt,
    '',
    'Twoja poprzednia odpowiedź nie przeszła walidacji. Błędy (ścieżka: problem):',
    ...issues.slice(0, MAX_ISSUES).map((issue) => `- ${issue}`),
    '',
    'Poprzednia odpowiedź:',
    previous,
    '',
    'Zwróć poprawiony, kompletny JSON — sam JSON, bez komentarza.',
  ].join('\n');
}

export async function askStructured<T>(
  client: AiClient,
  schema: z.ZodType<T>,
  prompt: string,
  request: AiRequest & { label?: string } = {},
): Promise<StructuredAnswer<T>> {
  const { label = 'zapytanie', ...ask } = request;

  const first = await client.ask(prompt, ask);
  const firstCheck = check(schema, first.text);
  if (firstCheck.ok) return { ...first, data: firstCheck.data, attempts: 1 };

  logFailure(`${label} (${first.provider} ${first.model})`, `walidacja: ${firstCheck.issues.length} błędów`);
  const second = await client.ask(repairPrompt(prompt, first.text, firstCheck.issues), {
    ...ask,
    provider: first.provider,
  });
  const secondCheck = check(schema, second.text);
  if (secondCheck.ok) return { ...second, data: secondCheck.data, attempts: 2 };

  logFailure(`${label} (${second.provider} ${second.model})`, `naprawa nieudana: ${secondCheck.issues.length} błędów`);
  throw new AiValidationError(secondCheck.issues, second.text);
}
