/**
 * Dostawcy modeli, z których korzysta planista.
 *
 * Przeniesione z FormaSync. Różnica jest jedna, ale zasadnicza: tam zapytanie szło wprost
 * z telefonu na klucz właściciela telefonu, tutaj idzie z Edge Function na klucz projektu —
 * plan oglądają i zmieniają różne osoby, a klucza nie wolno trzymać w przeglądarce.
 */

export const providers = ['CLAUDE', 'GEMINI', 'OPENAI'] as const;
export type Provider = (typeof providers)[number];

/** Nazwa modelu po ludzku — tak, jak mówi o nim użytkownik. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  CLAUDE: 'Claude',
  GEMINI: 'Gemini',
  OPENAI: 'ChatGPT',
};

/** Kto stoi za modelem. Przy zdaniu „dane idą do…” liczy się firma, nie nazwa modelu. */
export const PROVIDER_COMPANIES: Record<Provider, string> = {
  CLAUDE: 'Anthropic',
  GEMINI: 'Google',
  OPENAI: 'OpenAI',
};

/**
 * Wariant domyślny, gdy konfiguracja nie wskazuje innego. Pusto znaczy „nie zgadujemy”: nazwy
 * modeli wycofują się szybciej niż wychodzą wersje aplikacji, a jedyne pewne źródło to lista
 * pobrana od dostawcy (`listModels`).
 */
export const DEFAULT_MODELS: Record<Provider, string> = {
  CLAUDE: 'claude-sonnet-5-5',
  GEMINI: 'gemini-3.8-flash',
  OPENAI: '',
};

/**
 * Obraz doklejony do zapytania: typ MIME i zawartość w base64. Potrzebny przy imporcie
 * rezerwacji ze zrzutu ekranu i planu ze skanu. Każdy dostawca przyjmuje swój zestaw formatów,
 * więc sprawdza to jego moduł.
 */
export type AiImage = { mimeType: string; data: string };

export type AskOptions = {
  image?: AiImage | null;
  /** Instrukcja systemowa: rola i reguły, osobno od treści zadania. */
  system?: string;
  /** Najdłuższa odpowiedź. Plan na kilkanaście dni bywa długi — za ciasno i JSON urwie się w połowie. */
  maxTokens?: number;
  timeoutMs?: number;
  /** Zużycie tokenów z odpowiedzi dostawcy — do kosztu w `ai_runs` i raportu PoC-1. */
  onUsage?: (usage: AiUsage) => void;
};

export type AiUsage = { inputTokens: number; outputTokens: number };
