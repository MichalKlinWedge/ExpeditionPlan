import type { AiUsage } from '@expeditionplan/ai';

/**
 * Ceny API (USD za milion tokenów): Claude z https://platform.claude.com/docs/en/about-claude/pricing
 * (31.10.2026), Gemini — niżej. Domyślnie tanie modele; Opus tylko podany wprost w `--models`
 * (porównanie na życzenie właściciela), Fable nigdy.
 */
export const ALLOWED_MODELS: Record<string, { input: number; output: number; longInput?: number; longOutput?: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // Haiku 5.5: powyżej 100 tys. tokenów zapytania obowiązuje wyższa stawka.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20 },
  // Gemini, płatny poziom Standard, z https://ai.google.dev/gemini-api/docs/pricing (sprawdzone
  // 1.11.2026). 3.8 Flash: stawki do 31.12.2026; od 1.01.2027 dwa razy wyższe (1,50 / 7,50).
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
};

export const DEFAULT_RUN_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];

export function assertAllowed(model: string): void {
  if (!(model in ALLOWED_MODELS)) {
    throw new Error(`Model „${model}” nie jest na liście tanich modeli (${Object.keys(ALLOWED_MODELS).join(', ')}).`);
  }
}

/** Koszt jednego wywołania; `usage` to tokeny z odpowiedzi dostawcy. */
export function costUsd(model: string, usage: AiUsage): number {
  const price = ALLOWED_MODELS[model];
  if (price === undefined) return Number.NaN;
  const long = usage.inputTokens > 100_000 && price.longInput !== undefined;
  const input = long ? price.longInput! : price.input;
  const output = long ? (price.longOutput ?? price.output) : price.output;
  return (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000;
}
