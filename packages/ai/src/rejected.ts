import { type AiModel, normalizeModel } from './models.ts';
import type { Provider } from './providers.ts';

/**
 * Modele, których ten klucz nie obsłuży.
 *
 * Lista od dostawcy jest szersza niż to, czym można zapytać: wariant wycofany „dla nowych
 * użytkowników” nadal się na niej pokazuje, a odpowiada dopiero odmową przy pierwszym zapytaniu.
 * Uczymy się więc z odmów (FormaSync). Gdzie tę pamięć trzymać, decyduje wołający: w testach
 * i skryptach wystarczy pamięć procesu, w Edge Function — tabela w bazie.
 */
export interface RejectedStore {
  list(provider: Provider): string[];
  add(provider: Provider, model: string): void;
}

export function memoryRejectedStore(): RejectedStore {
  const gone = new Map<Provider, Set<string>>();
  return {
    list: (provider) => [...(gone.get(provider) ?? [])],
    add: (provider, model) => {
      const id = normalizeModel(model);
      if (id === '') return;
      const set = gone.get(provider) ?? new Set<string>();
      set.add(id);
      gone.set(provider, set);
    },
  };
}

/** Lista bez tego, co ten klucz już odrzucił. */
export function withoutRejected(store: RejectedStore, provider: Provider, models: AiModel[]): AiModel[] {
  const gone = store.list(provider);
  return models.filter((model) => !gone.includes(model.id));
}
