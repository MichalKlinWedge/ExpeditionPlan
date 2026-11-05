import { PROVIDER_COMPANIES, PROVIDER_LABELS, type Provider } from './providers.ts';

/**
 * Odmowa dostawcy po ludzku.
 *
 * Komunikaty API mówią o formatach i polach, a nie o tym, co zrobić — a zrobić trzeba zwykle jedną
 * z trzech rzeczy: poprawić klucz, wybrać inny model albo poczekać. Tego się tu trzymamy, zamiast
 * pokazywać surową treść, z której nic nie wynika.
 */
export function describeStatus(
  provider: Provider,
  status: number,
  message: string | undefined,
  model: string,
): string {
  const who = PROVIDER_LABELS[provider];

  if (status === 400) {
    // Odmowa z nazwy modelu wraca jako surowy komunikat API — bez tłumaczenia nie mówi nic o tym,
    // gdzie tę nazwę zmienić.
    if ((message ?? '').toLowerCase().includes('model')) {
      return `${who} nie przyjął nazwy modelu „${model}”. Pobierz listę modeli`
        + ' i wybierz nazwę z niej.';
    }
    return message ?? `${who} odrzucił zapytanie jako nieprawidłowe.`;
  }

  if (status === 401 || status === 403) return `Klucz do ${who} jest nieważny albo bez uprawnień.`;
  if (status === 404) {
    // Wycofując wariant, dostawca zwykle podaje w odmowie następcę. Szkoda go wyrzucać: bez tego
    // zostaje wyprawa po listę, a odpowiedź leży w komunikacie, który właśnie przyszedł.
    const instead = suggested(message, model);
    if (instead !== null) {
      return `Model „${model}” nie jest już dostępny dla tego klucza. ${PROVIDER_COMPANIES[provider]}`
        + ` proponuje w zamian „${instead}” — wybierz go w konfiguracji albo z listy modeli.`;
    }
    return `Model „${model}” nie istnieje dla tego klucza. Pobierz listę modeli`
      + ' i wybierz nazwę z niej.';
  }
  if (status === 429) return `Wyczerpany limit zapytań do ${who}. Spróbuj później.`;
  // 503 u Google i 529 u Anthropic to zwykle przeciążenie jednego modelu, a nie awaria dostawcy —
  // i najczęściej dostaje się nim po najnowszym wariancie. Bez nazwy modelu w komunikacie wychodzi
  // na to, że zepsuła się cała funkcja, a wystarczy odczekać albo wybrać inny model.
  if (model !== '' && overloaded(status, message)) {
    return `Model „${model}” jest w tej chwili przeciążony po stronie ${PROVIDER_COMPANIES[provider]}.`
      + ' Spróbuj jeszcze raz za chwilę albo wybierz inny model.';
  }
  if (status >= 500) return `${who} chwilowo nie odpowiada. Spróbuj później.`;

  return message ?? `${who} odrzucił zapytanie (kod ${status}).`;
}

/** Nazwa następcy wyłuskana z odmowy — „models/gemini-3.8-flash” i tym podobne. */
const NAMED = /models\/([a-z0-9][a-z0-9.-]*)/gi;

/** Model podany przez dostawcę w zamian; null, gdy odmowa wymienia tylko ten, o który pytaliśmy. */
function suggested(message: string | undefined, model: string): string | null {
  for (const match of (message ?? '').matchAll(NAMED)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name !== model.toLowerCase()) return name;
  }
  return null;
}

/** Odmowa, po której warto spróbować ponownie albo innym modelem: przeciążenie lub wyczerpany limit tego modelu. */
export function isBusy(status: number, message: string | undefined): boolean {
  return status === 429 || overloaded(status, message);
}

/** Tak dostawcy mówią „za dużo chętnych na ten model”, każdy swoimi słowami. */
const OVERLOAD = /overload|high demand|capacity|busy|unavailable/i;

/** Przeciążenie modelu, a nie awaria: kod albo treść odpowiedzi. */
function overloaded(status: number, message: string | undefined): boolean {
  if (status === 503 || status === 529) return true;
  return status >= 500 && OVERLOAD.test(message ?? '');
}
