import { pluralWith } from './plural.ts';
import { PROVIDER_COMPANIES, PROVIDER_LABELS, type Provider } from './providers.ts';

/**
 * Jedno zapytanie do dostawcy modelu i wszystko, co może pójść nie tak, zanim przyjdzie odpowiedź.
 */

export type ErrorOptions = {
  /**
   * Czy powtórzenie tego samego zapytania ma sens. Awaria sieci i cisza po stronie dostawcy mijają
   * same, odmowa z nazwy modelu albo z klucza — nie.
   */
  retryable?: boolean;
  /**
   * Czy odmowa dotyczy samego modelu, a nie zapytania: tego wariantu ten klucz nie obsłuży ani
   * teraz, ani później. Taki model zapamiętujemy i znika z listy do wyboru.
   */
  modelGone?: boolean;
  /** Czy model ma w tej chwili za dużo chętnych albo wyczerpany limit: inny model tego dostawcy może odpowiedzieć. */
  busy?: boolean;
};

export class AiError extends Error {
  readonly retryable: boolean;
  readonly modelGone: boolean;
  readonly busy: boolean;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = 'AiError';
    this.retryable = options.retryable ?? false;
    this.modelGone = options.modelGone ?? false;
    this.busy = options.busy ?? false;
  }
}

/**
 * Ile czekamy na odpowiedź. Generowanie dnia planu trwa dłużej niż odpowiedź w FormaSync, ale
 * Edge Function ma własny limit czasu — dłuższe czekanie i tak zostałoby ucięte z zewnątrz.
 */
export const TIMEOUT_MS = 120_000;

/**
 * Powód awarii do logu funkcji. Komunikat dla człowieka ma doradzić, co zrobić; tutaj zostaje to,
 * czego potrzeba do diagnozy. Nie zapisujemy ani klucza, ani treści zapytania.
 */
export function logFailure(label: string, detail: string): void {
  console.warn(`ExpeditionPlan AI: ${label} — ${detail}`);
}

const seconds = (ms: number): string =>
  pluralWith(Math.round(ms / 1000), 'sekundę', 'sekundy', 'sekund');

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Zapytanie z limitem czasu. Rozróżnia trzy rzeczy, które z zewnątrz wyglądają tak samo:
 * cisza po stronie dostawcy, brak drogi do niego i odpowiedź, która po prostu się nie spodobała —
 * ta ostatnia wraca do wołającego, bo tylko on wie, jak ją odczytać.
 */
export async function send(
  url: string,
  init: RequestInit,
  options: { provider: Provider; label: string; timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      logFailure(options.label, `cisza przez ${timeoutMs} ms`);
      throw new AiError(
        `${PROVIDER_LABELS[options.provider]} nie odpowiedział przez ${seconds(timeoutMs)}.`,
        { retryable: true },
      );
    }
    logFailure(options.label, describeError(error));
    throw new AiError(
      `Zapytanie nie dotarło do ${PROVIDER_COMPANIES[options.provider]} — sprawdź połączenie`
        + ' z internetem.',
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}
