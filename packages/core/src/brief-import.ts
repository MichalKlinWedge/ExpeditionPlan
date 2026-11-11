import { z } from 'zod';

import { BRIEF_BUDGET, BRIEF_FIXED_KIND, BRIEF_LOCATION, BRIEF_PACE, BRIEF_PROFILE, BRIEF_TRANSPORT } from './labels.ts';

/**
 * Brief z dokumentu przygotowanego poza aplikacją (plan w Wordzie, PDF, notatki): AI odczytuje pola briefu, a człowiek
 * w podglądzie wybiera, co wstawić do formularza. Listy tylko dopisują nowe pozycje, pola pojedyncze zastępują wartość
 * (zmiana wpisanej już wartości jest domyślnie odznaczona). Nic nie zapisuje się bez „Zapisz brief”.
 */

/** Element już ustalony w formularzu briefu (pola tekstowe, puste = brak). */
export type BriefDraftFixed = {
  kind: string;
  title: string;
  status?: string;
  reference?: string;
  startLocal?: string;
  startTz?: string;
  endLocal?: string;
  from?: string;
  to?: string;
  note?: string;
};

/** Stan formularza briefu (kreator na webie); walidację robi `TripBrief` przy zapisie. */
export type BriefDraft = {
  goal: string;
  location: { kind: string; countries: string[]; places: string[] };
  profiles: string[];
  transport: string[];
  budget: { level: string; currency: string; capMinor?: number };
  constraints: {
    pace: string;
    dayStart?: string;
    dayEnd?: string;
    maxDrivingMinPerDay?: number;
    noDrivingAfterDark: boolean;
    diet: string[];
    allergies: string[];
    accessibility: string[];
    notes: string[];
  };
  fixed: BriefDraftFixed[];
  mustSee: string[];
  avoid: string[];
  notes: string[];
};

const list = z.array(z.string()).default([]);

/** Odczyt AI: czego dokument nie mówi, to `null` albo pusta lista. Wartości spoza słowników odpadają przy podglądzie. */
export const BriefImport = z.object({
  goal: z.string().nullable().default(null),
  locationKind: z.string().nullable().default(null),
  countries: list,
  places: list,
  profiles: list,
  transport: list,
  budgetLevel: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  /** Pułap całości w jednostkach głównych waluty. */
  budgetCap: z.number().nullable().default(null),
  mustSee: list,
  avoid: list,
  pace: z.string().nullable().default(null),
  dayStart: z.string().nullable().default(null),
  dayEnd: z.string().nullable().default(null),
  maxDrivingMinPerDay: z.number().nullable().default(null),
  noDrivingAfterDark: z.boolean().nullable().default(null),
  diet: list,
  allergies: list,
  accessibility: list,
  constraintNotes: list,
  fixed: z
    .array(
      z.object({
        kind: z.string(),
        title: z.string(),
        reference: z.string().nullable().default(null),
        startLocal: z.string().nullable().default(null),
        endLocal: z.string().nullable().default(null),
        from: z.string().nullable().default(null),
        to: z.string().nullable().default(null),
        note: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /** Reszta tego, co przyda się przy planowaniu (godziny, ceny, pomysły na dni, kontakty do obiektów). */
  notes: list,
});
export type BriefImport = z.infer<typeof BriefImport>;

export const BRIEF_IMPORT_FIELDS = [
  'goal',
  'locationKind',
  'countries',
  'places',
  'profiles',
  'transport',
  'budgetLevel',
  'currency',
  'budgetCap',
  'mustSee',
  'avoid',
  'pace',
  'dayStart',
  'dayEnd',
  'maxDriving',
  'noDrivingAfterDark',
  'diet',
  'allergies',
  'accessibility',
  'constraintNotes',
  'fixed',
  'notes',
] as const;
export type BriefImportField = (typeof BRIEF_IMPORT_FIELDS)[number];

/** Wiersz podglądu: co AI odczytało, a przy zmianie wpisanej wartości — co jest teraz (wtedy domyślnie odznaczony). */
export type BriefImportRow = { key: BriefImportField; label: string; value: string; current?: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const clean = (text: string | null | undefined) => text?.trim() ?? '';
const same = (a: string, b: string) => a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

/** Nowe pozycje listy: bez pustych, bez powtórek i bez tych, które już są. */
function fresh(current: readonly string[], found: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of found) {
    const item = raw.trim();
    if (item !== '' && ![...current, ...out].some((each) => same(each, item))) out.push(item);
  }
  return out;
}

const known = (dictionary: Record<string, string>, values: readonly string[]) => values.filter((value, at) => value in dictionary && values.indexOf(value) === at);
const time = (text: string | null) => (text !== null && TIME.test(text.trim()) ? text.trim() : undefined);
const dateTime = (text: string | null) => {
  const value = text?.trim().replace(' ', 'T').slice(0, 16);
  return value !== undefined && LOCAL_DATE_TIME.test(value) ? value : undefined;
};

/** Odczyt oczyszczony do pól formularza: tylko znane wartości słowników, poprawne godziny, nowe pozycje list. */
function normalized(current: BriefDraft, found: BriefImport, tripTz: string) {
  const countries = fresh(
    current.location.countries,
    found.countries.map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)),
  );
  const currency = clean(found.currency).toUpperCase();
  const cap = found.budgetCap !== null && found.budgetCap > 0 ? Math.round(found.budgetCap * 100) : undefined;
  const driving = found.maxDrivingMinPerDay !== null && found.maxDrivingMinPerDay > 0 ? Math.round(found.maxDrivingMinPerDay) : undefined;
  const fixed: BriefDraftFixed[] = found.fixed
    .filter((each) => clean(each.title) !== '' && !current.fixed.some((have) => same(have.title, each.title)))
    .map((each) => {
      const start = dateTime(each.startLocal);
      const end = dateTime(each.endLocal);
      return {
        kind: each.kind in BRIEF_FIXED_KIND ? each.kind : 'other',
        title: each.title.trim(),
        startTz: tripTz,
        ...(start ? { startLocal: start } : {}),
        ...(end ? { endLocal: end } : {}),
        ...(clean(each.reference) ? { reference: clean(each.reference) } : {}),
        ...(clean(each.from) ? { from: clean(each.from) } : {}),
        ...(clean(each.to) ? { to: clean(each.to) } : {}),
        ...(clean(each.note) ? { note: clean(each.note) } : {}),
      };
    });
  return {
    goal: clean(found.goal),
    locationKind: found.locationKind !== null && found.locationKind in BRIEF_LOCATION ? found.locationKind : undefined,
    countries,
    places: fresh(current.location.places, found.places),
    profiles: known(BRIEF_PROFILE, found.profiles).filter((each) => !current.profiles.includes(each)),
    transport: known(BRIEF_TRANSPORT, found.transport).filter((each) => !current.transport.includes(each)),
    budgetLevel: found.budgetLevel !== null && found.budgetLevel in BRIEF_BUDGET ? found.budgetLevel : undefined,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    budgetCap: cap,
    mustSee: fresh(current.mustSee, found.mustSee),
    avoid: fresh(current.avoid, found.avoid),
    pace: found.pace !== null && found.pace in BRIEF_PACE ? found.pace : undefined,
    dayStart: time(found.dayStart),
    dayEnd: time(found.dayEnd),
    maxDriving: driving,
    noDrivingAfterDark: found.noDrivingAfterDark === true ? true : undefined,
    diet: fresh(current.constraints.diet, found.diet),
    allergies: fresh(current.constraints.allergies, found.allergies),
    accessibility: fresh(current.constraints.accessibility, found.accessibility),
    constraintNotes: fresh(current.constraints.notes, found.constraintNotes),
    fixed,
    notes: fresh(current.notes, found.notes),
  };
}

const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString('pl-PL')} ${currency}`;
const fixedLine = (each: BriefDraftFixed) =>
  [`${BRIEF_FIXED_KIND[each.kind] ?? each.kind}: ${each.title}`, each.startLocal?.replace('T', ' '), each.reference].filter(Boolean).join(' · ');

/**
 * Wiersze podglądu: tylko to, co dokument wnosi. Domyślne wartości formularza (miasto, tempo normalne, budżet średni)
 * nie liczą się jako wpisane, więc ich zmiana nie jest „teraz w briefie”.
 */
export function briefImportRows(current: BriefDraft, found: BriefImport, tripTz: string): BriefImportRow[] {
  const next = normalized(current, found, tripTz);
  const rows: BriefImportRow[] = [];
  const single = (key: BriefImportField, label: string, value: string | undefined, now: string | undefined, isDefault = false) => {
    if (value === undefined || value === '' || (now !== undefined && same(value, now))) return;
    rows.push({ key, label, value, ...(now !== undefined && now !== '' && !isDefault ? { current: now } : {}) });
  };
  const many = (key: BriefImportField, label: string, values: string[]) => {
    if (values.length > 0) rows.push({ key, label, value: values.join(' · ') });
  };
  const currency = current.budget.currency;
  single('goal', 'Cel', next.goal, current.goal);
  single('locationKind', 'Rodzaj', next.locationKind && BRIEF_LOCATION[next.locationKind], BRIEF_LOCATION[current.location.kind], current.location.kind === 'city');
  many('countries', 'Kraje', next.countries);
  many('places', 'Miejsca', next.places);
  many('profiles', 'Charakter', next.profiles.map((each) => BRIEF_PROFILE[each]!));
  many('transport', 'Transport', next.transport.map((each) => BRIEF_TRANSPORT[each]!));
  single('budgetLevel', 'Budżet', next.budgetLevel && BRIEF_BUDGET[next.budgetLevel], BRIEF_BUDGET[current.budget.level], current.budget.level === 'medium');
  single('currency', 'Waluta', next.currency, currency);
  single('budgetCap', 'Pułap całości', next.budgetCap === undefined ? undefined : money(next.budgetCap, next.currency ?? currency), current.budget.capMinor === undefined ? undefined : money(current.budget.capMinor, currency));
  many('mustSee', 'Koniecznie zobaczyć', next.mustSee);
  many('avoid', 'Czego unikać', next.avoid);
  single('pace', 'Tempo', next.pace && BRIEF_PACE[next.pace], BRIEF_PACE[current.constraints.pace], current.constraints.pace === 'normal');
  single('dayStart', 'Dzień od', next.dayStart, current.constraints.dayStart);
  single('dayEnd', 'Dzień do', next.dayEnd, current.constraints.dayEnd);
  single('maxDriving', 'Najdłuższa jazda dziennie', next.maxDriving === undefined ? undefined : `${next.maxDriving} min`, current.constraints.maxDrivingMinPerDay === undefined ? undefined : `${current.constraints.maxDrivingMinPerDay} min`);
  if (next.noDrivingAfterDark && !current.constraints.noDrivingAfterDark) rows.push({ key: 'noDrivingAfterDark', label: 'Jazda', value: 'bez jazdy po zmroku' });
  many('diet', 'Dieta', next.diet);
  many('allergies', 'Alergie', next.allergies);
  many('accessibility', 'Dostępność', next.accessibility);
  many('constraintNotes', 'Inne ograniczenia', next.constraintNotes);
  if (next.fixed.length > 0) rows.push({ key: 'fixed', label: 'Już ustalone', value: next.fixed.map(fixedLine).join('\n') });
  if (next.notes.length > 0) rows.push({ key: 'notes', label: 'Dla AI (wszystko inne)', value: next.notes.join('\n') });
  return rows;
}

/** Formularz po wstawieniu wybranych wierszy podglądu. */
export function applyBriefImport(current: BriefDraft, found: BriefImport, tripTz: string, fields: readonly BriefImportField[]): BriefDraft {
  const next = normalized(current, found, tripTz);
  const on = (key: BriefImportField) => fields.includes(key);
  const draft: BriefDraft = structuredClone(current);
  if (on('goal') && next.goal !== '') draft.goal = next.goal;
  if (on('locationKind') && next.locationKind) draft.location.kind = next.locationKind;
  if (on('countries')) draft.location.countries.push(...next.countries);
  if (on('places')) draft.location.places.push(...next.places);
  if (on('profiles')) draft.profiles.push(...next.profiles);
  if (on('transport')) draft.transport.push(...next.transport);
  if (on('budgetLevel') && next.budgetLevel) draft.budget.level = next.budgetLevel;
  if (on('currency') && next.currency) draft.budget.currency = next.currency;
  if (on('budgetCap') && next.budgetCap !== undefined) draft.budget.capMinor = next.budgetCap;
  if (on('mustSee')) draft.mustSee.push(...next.mustSee);
  if (on('avoid')) draft.avoid.push(...next.avoid);
  if (on('pace') && next.pace) draft.constraints.pace = next.pace;
  if (on('dayStart') && next.dayStart) draft.constraints.dayStart = next.dayStart;
  if (on('dayEnd') && next.dayEnd) draft.constraints.dayEnd = next.dayEnd;
  if (on('maxDriving') && next.maxDriving !== undefined) draft.constraints.maxDrivingMinPerDay = next.maxDriving;
  if (on('noDrivingAfterDark') && next.noDrivingAfterDark) draft.constraints.noDrivingAfterDark = true;
  if (on('diet')) draft.constraints.diet.push(...next.diet);
  if (on('allergies')) draft.constraints.allergies.push(...next.allergies);
  if (on('accessibility')) draft.constraints.accessibility.push(...next.accessibility);
  if (on('constraintNotes')) draft.constraints.notes.push(...next.constraintNotes);
  if (on('fixed')) draft.fixed.push(...next.fixed);
  if (on('notes')) draft.notes.push(...next.notes);
  return draft;
}
