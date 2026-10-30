import { askClaude, claudeModels } from './claude.ts';
import { askGemini, geminiModels } from './gemini.ts';
import { type AiModel, isModelName, normalizeModel } from './models.ts';
import { askOpenAi, openAiModels } from './openai.ts';
import { type AskOptions, DEFAULT_MODELS, PROVIDER_LABELS, type Provider } from './providers.ts';
import { memoryRejectedStore, type RejectedStore, withoutRejected } from './rejected.ts';
import { AiError } from './transport.ts';

/**
 * Jedno wejście do wszystkich dostawców.
 *
 * Reszta systemu nie wie, czy odpowiada Claude, Gemini czy ChatGPT — pyta o tekst i dostaje tekst.
 * Klucze i nazwy modeli przychodzą z konfiguracji (sekrety Edge Function, zmienne środowiska
 * skryptu), a nie z magazynu telefonu jak w FormaSync.
 */

export class NoApiKeyError extends AiError {
  constructor(provider: Provider) {
    super(`Brak klucza do ${PROVIDER_LABELS[provider]} w konfiguracji.`);
    this.name = 'NoApiKeyError';
  }
}

export class NoModelError extends AiError {
  constructor(provider: Provider) {
    super(`Nie wiadomo, którego modelu ${PROVIDER_LABELS[provider]} użyć. Pobierz listę i wskaż model.`);
    this.name = 'NoModelError';
  }
}

export type AiClientConfig = {
  keys: Partial<Record<Provider, string | undefined>>;
  models?: Partial<Record<Provider, string | undefined>>;
  defaultProvider?: Provider;
  rejected?: RejectedStore;
};

export type AiRequest = AskOptions & { provider?: Provider };

export type AiAnswer = { text: string; provider: Provider; model: string };

export type AiClient = {
  readonly defaultProvider: Provider;
  ask(prompt: string, request?: AiRequest): Promise<AiAnswer>;
  listModels(provider: Provider): Promise<AiModel[]>;
};

export function createAiClient(config: AiClientConfig): AiClient {
  const rejected = config.rejected ?? memoryRejectedStore();
  const defaultProvider = config.defaultProvider ?? 'CLAUDE';

  const keyFor = (provider: Provider): string => {
    const key = config.keys[provider]?.trim() ?? '';
    if (key === '') throw new NoApiKeyError(provider);
    return key;
  };

  // Nazwę sprawdzamy u siebie: inaczej odpowiedzią na nazwę ze strony dostawcy jest komunikat API
  // o formacie, z którego nie wynika, co poprawić.
  const modelFor = (provider: Provider): string => {
    const raw = config.models?.[provider] ?? DEFAULT_MODELS[provider];
    const model = normalizeModel(raw);
    if (model === '') throw new NoModelError(provider);
    if (!isModelName(model)) {
      throw new AiError(`„${raw}” to nie jest nazwa modelu, tylko jej opis. Wskaż identyfikator z listy modeli.`);
    }
    return model;
  };

  return {
    defaultProvider,

    async ask(prompt, request = {}) {
      const { provider = defaultProvider, ...options } = request;
      const key = keyFor(provider);
      const model = modelFor(provider);

      try {
        const text = provider === 'CLAUDE'
          ? await askClaude(key, model, prompt, options)
          : provider === 'OPENAI'
            ? await askOpenAi(key, model, prompt, options)
            : await askGemini(key, model, prompt, options);
        return { text, provider, model };
      } catch (error) {
        // Odmowa z samego modelu nie minie: ten klucz tego wariantu nie dostanie.
        if (error instanceof AiError && error.modelGone) rejected.add(provider, model);
        throw error;
      }
    },

    async listModels(provider) {
      const key = keyFor(provider);
      const all = provider === 'CLAUDE'
        ? await claudeModels(key)
        : provider === 'OPENAI'
          ? await openAiModels(key)
          : await geminiModels(key);
      return withoutRejected(rejected, provider, all);
    },
  };
}
