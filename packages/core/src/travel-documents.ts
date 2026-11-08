import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Formalności przed wyjazdem. Przy osobie zapisuje się tylko data ważności paszportu i dowodu (bez
 * numerów); ostrzeżenia trafiają do „Gotowości do wyjazdu”. Paszport powinien być ważny jeszcze co
 * najmniej 6 miesięcy po powrocie (wymóg wielu krajów spoza UE), dowód — do powrotu. Zadania
 * formalności (EKUZ, ubezpieczenie, międzynarodowe prawo jazdy, Odyseusz) to zwykłe zadania wyjazdu
 * z linkiem do usługi na gov.pl — aplikacja nie pobiera tych stron.
 */

type Doc = TripDocument;

/** Ile miesięcy po powrocie paszport ma być jeszcze ważny. */
export const PASSPORT_MARGIN_MONTHS = 6;

export type IdDocument = 'passport' | 'id_card';
export const ID_DOCUMENT: Record<IdDocument, string> = { passport: 'paszport', id_card: 'dowód' };

export type DocumentProblem = 'expired' | 'before_return' | 'short_margin';

export type DocumentWarning = {
  travelerRef: string;
  name: string;
  document: IdDocument;
  until: string;
  problem: DocumentProblem;
  /** „paszport ważny do 12.03.2027 — krócej niż 6 miesięcy po powrocie”. */
  text: string;
};

/** Ta sama data `months` miesięcy później (31 sierpnia + 6 → 28/29 lutego). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

const polishDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** Ocena jednego dokumentu: `back` = dzień powrotu osoby; `null` = wystarczy. */
export function idDocumentProblem(document: IdDocument, until: string, back: string, today: string): { problem: DocumentProblem; text: string } | null {
  const problem: DocumentProblem | null =
    until < today ? 'expired' : until < back ? 'before_return' : document === 'passport' && until < addMonths(back, PASSPORT_MARGIN_MONTHS) ? 'short_margin' : null;
  if (problem === null) return null;
  const why = problem === 'expired' ? 'już nieważny' : problem === 'before_return' ? 'traci ważność przed powrotem' : `krócej niż ${PASSPORT_MARGIN_MONTHS} miesięcy po powrocie`;
  return { problem, text: `${ID_DOCUMENT[document]} ważny do ${polishDate(until)} — ${why}` };
}

/** Dokumenty, które nie wystarczą na wyjazd: nieważne już dziś, tracące ważność przed powrotem osoby, paszport bez 6 miesięcy zapasu. */
export function documentWarnings(doc: Doc, today: string): DocumentWarning[] {
  const out: DocumentWarning[] = [];
  for (const person of doc.travelers) {
    const back = person.toDate ?? doc.trip.endDate;
    const check = (document: IdDocument, until: string | undefined) => {
      if (until === undefined) return;
      const found = idDocumentProblem(document, until, back, today);
      if (found !== null) out.push({ travelerRef: person.ref, name: person.name, document, until, ...found });
    };
    check('passport', person.passportUntil);
    check('id_card', person.idCardUntil);
  }
  return out;
}

export type FormalityKey = 'ekuz' | 'insurance' | 'driving_permit' | 'odyseusz';

export type Formality = {
  key: FormalityKey;
  title: string;
  /** Kiedy to potrzebne — podpowiedź przy wyborze. */
  when: string;
  /** Treść zadania; link do usługi na gov.pl, gdy jest. */
  body: string;
  url?: string;
  /** Termin zadania: tyle dni przed wyjazdem. */
  daysBefore: number;
};

export const FORMALITIES: Formality[] = [
  {
    key: 'ekuz',
    title: 'EKUZ — Europejska Karta Ubezpieczenia Zdrowotnego',
    when: 'wyjazd do UE, EOG, Szwajcarii lub Wielkiej Brytanii; każda osoba, także dzieci',
    body: 'Karta dla każdej osoby (wniosek online, NFZ). Pokrywa leczenie w publicznej służbie zdrowia, nie ratownictwo ani transport do Polski.',
    url: 'https://www.gov.pl/web/gov/uzyskaj-europejska-karte-ubezpieczenia-zdrowotnego-ekuz',
    daysBefore: 21,
  },
  {
    key: 'insurance',
    title: 'Ubezpieczenie podróżne',
    when: 'każdy wyjazd za granicę; w górach z ratownictwem',
    body: 'Koszty leczenia, ratownictwo (w górach i na nartach osobno!), transport do Polski, OC w życiu prywatnym. Numer polisy i telefon assistance dopisz w kontaktach albo w sejfie.',
    daysBefore: 7,
  },
  {
    key: 'driving_permit',
    title: 'Międzynarodowe prawo jazdy',
    when: 'kierowcy poza UE i EOG, jeśli kraj go wymaga (sprawdź też wypożyczalnię)',
    body: 'Wniosek w wydziale komunikacji starostwa; wydanie trwa do kilku tygodni.',
    url: 'https://www.gov.pl/web/gov/uzyskaj-miedzynarodowe-prawo-jazdy',
    daysBefore: 30,
  },
  {
    key: 'odyseusz',
    title: 'Rejestracja podróży w Odyseuszu (MSZ)',
    when: 'każdy wyjazd za granicę',
    body: 'Zgłoszenie pobytu za granicą: konsul wie, że tam jesteście, i może się skontaktować w razie zagrożenia.',
    url: 'https://www.gov.pl/web/gov/zglos-pobyt-za-granica-system-odyseusz',
    daysBefore: 3,
  },
];

/** Formalność już jest wśród zadań wyjazdu (po tytule). */
export const hasFormality = (doc: Doc, formality: Formality) => doc.tasks.some((task) => task.title === formality.title);

/** Nowe zadania wybranych formalności (bez tych, które już są); `newRef` daje klucz zadania. */
export function formalityTasks(doc: Doc, keys: readonly FormalityKey[], newRef: () => string): Doc['tasks'] {
  return FORMALITIES.filter((formality) => keys.includes(formality.key) && !hasFormality(doc, formality)).map((formality) => ({
    ref: newRef(),
    kind: 'todo',
    title: formality.title,
    body: formality.url ? `${formality.body}\n${formality.url}` : formality.body,
    status: 'open',
    due: { kind: 'before_trip', days: formality.daysBefore },
    assigneeRefs: [],
  }));
}
