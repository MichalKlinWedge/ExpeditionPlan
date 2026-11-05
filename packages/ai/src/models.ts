/**
 * Nazwa modelu.
 *
 * Nazwa przychodzi z konfiguracji jako wolny tekst, bo dostawcy wycofują i dokładają warianty szybciej, niż
 * wychodzą wersje aplikacji. API przyjmuje jednak identyfikator (`gemini-3.5-flash-lite`), a nie
 * nazwę ze strony („Gemini 3.5 Flash-Lite”) — wpisana wprost kończy się odmową „unexpected model
 * name format”. Nazwę sprowadzamy więc do identyfikatora sami, zamiast kazać ją przepisywać,
 * a listę dostępnych wariantów umiemy pobrać wprost od dostawcy, żeby nie trzeba jej było zgadywać.
 */

/** Identyfikator z tego, co ktoś wpisał albo wkleił. Puste znaczy: nie da się nic sensownego. */
export function normalizeModel(raw: string): string {
  return raw
    .trim()
    .replace(/^models\//i, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Czy identyfikator da się w ogóle wysłać: litery, cyfry, kropki i myślniki — nic poza tym. */
export function isModelName(value: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
}

export type AiModel = { id: string; label: string };

/**
 * Modele od innej roboty niż pisanie tekstu. Odsiew po nazwie — ostatnia deska ratunku tam, gdzie
 * dostawca nie mówi wprost, co model potrafi.
 */
export const OTHER_WORK =
  /embedding|aqa|imagen|veo|image|tts|audio|live|realtime|whisper|transcribe|dall-e|moderation|sora/;

/** Czy wariant jest zapowiedzią. Takie schodzą na dół listy, bo znikają bez uprzedzenia. */
const unstable = (id: string): boolean => /preview|exp\b|experimental/.test(id);

/** Stabilne najpierw, dalej alfabetycznie — lista ma prowadzić do wyboru, nie do zgadywania. */
export const sortModels = (models: AiModel[]): AiModel[] =>
  [...models].sort((a, b) => {
    if (unstable(a.id) !== unstable(b.id)) return unstable(a.id) ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

const FAST = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/;

/**
 * Modele na zastępstwo za przeciążony: z listy dostawcy, bo nazw nie zgadujemy, i tylko tanie, stabilne
 * warianty Flash (`-latest`, zapowiedzi i modele od obrazu czy mowy odpadają, Pro nigdy). Najnowszy
 * Flash-Lite, potem najnowszy Flash. Dla innych dostawców lista jest pusta.
 */
export function fallbackModels(models: AiModel[], current: string): string[] {
  const version = (id: string) => Number(FAST.exec(id)?.[1] ?? 0);
  const fast = models.map((model) => model.id).filter((id) => id !== current && FAST.test(id)).sort((a, b) => version(b) - version(a));
  const lite = fast.find((id) => id.endsWith('-lite'));
  const flash = fast.find((id) => !id.endsWith('-lite'));
  return [lite, flash].filter((id) => id !== undefined);
}
