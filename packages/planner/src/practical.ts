import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import { formatOffset, instantToZoned, offsetMinutes, PracticalInfo, sunTimes, type TripBrief, type TripDocument, zonedToInstant } from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Etap 5 — informacje praktyczne (SPECYFIKACJA §4): AI dostaje streszczenie planu (kraj, daty,
 * skład grupy, rodzaje aktywności, transport, to, co plan już ma) i oddaje notatki, kontakty
 * alarmowe, listę pakowania, zadania i źródła. Kod sprawdza źródła (adres odpowiada), a do planu
 * trafiają tylko elementy wybrane przez człowieka (`mergePractical`).
 */

type Doc = TripDocument;

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

/**
 * Strefa i słońce z kodu, nie z pamięci modelu (SPECYFIKACJA §4, zasada 3): przesunięcie strefy
 * wyjazdu w jego datach, różnica względem domu i wschód/zachód słońca w bazach dni.
 */
export function timeFacts(doc: Doc) {
  const at = zonedToInstant(doc.trip.startDate, '12:00', doc.trip.primaryTz);
  const trip = offsetMinutes(at, doc.trip.primaryTz);
  const home = offsetMinutes(at, doc.trip.homeTz);
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const sun = doc.days.flatMap((day) => {
    const base = day.baseRef === undefined ? undefined : places.get(day.baseRef);
    if (base?.lat === undefined || base.lng === undefined) return [];
    const times = sunTimes(day.date, base.lat, base.lng);
    const local = (instant: number | null) => (instant === null ? null : instantToZoned(instant, day.tz).time);
    return [{ date: day.date, place: base.name, sunrise: local(times.sunrise), sunset: local(times.sunset) }];
  });
  return { timeZone: doc.trip.primaryTz, utcOffset: formatOffset(trip), homeTimeZone: doc.trip.homeTz, differenceFromHomeMin: trip - home, sun };
}

/** Co AI musi wiedzieć o wyjeździe — bez całego dokumentu (taniej, a pakowanie i ryzyka zależą od tego). */
export function practicalContext(doc: Doc, brief: TripBrief | null) {
  const kinds = new Map<string, number>();
  for (const item of doc.items) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1);
  const modes = [...new Set(doc.items.flatMap((item) => (item.leg ? [item.leg.mode] : [])))];
  return {
    title: doc.trip.title,
    dates: { start: doc.trip.startDate, end: doc.trip.endDate },
    facts: timeFacts(doc),
    countries: brief?.location.countries ?? [],
    tripKind: brief?.location.kind,
    profiles: brief?.profiles,
    travelers: doc.travelers.map((each) => ({ name: each.name, age: each.age, driver: each.isDriver })),
    days: doc.days.map((day) => ({ date: day.date, title: day.title, base: doc.places.find((place) => place.ref === day.baseRef)?.name })),
    activities: doc.items
      .filter((item) => item.kind === 'activity' || item.kind === 'visit')
      .map((item) => item.title)
      .slice(0, 40),
    itemKinds: Object.fromEntries(kinds),
    transportModes: modes,
    bookings: doc.bookings.filter((each) => each.status !== 'idea' && each.status !== 'candidate').map((each) => `${each.kind}: ${each.title}`),
    alreadyInPlan: {
      packing: doc.packing.map((each) => each.title),
      tasks: doc.tasks.map((each) => each.title),
      notes: doc.notes.filter((each) => each.scope === 'trip').map((each) => each.title ?? each.body.slice(0, 60)),
      contacts: doc.contacts.map((each) => each.name),
    },
  };
}

export function practicalPrompt(doc: Doc, brief: TripBrief | null): string {
  return [
    'Etap 5 — informacje praktyczne do wyjazdu. Przygotuj to, czego plan dnia nie mówi, a co trzeba wiedzieć i zrobić.',
    '',
    'Zasady:',
    '1. `notes`: konkretne, sprawdzalne informacje dla TEGO wyjazdu (kraj, sezon, skład grupy, aktywności): dokumenty i wjazd, pieniądze i płatności, zdrowie i ubezpieczenie, bezpieczeństwo, zwyczaje, transport i ruch drogowy, pogoda w tych datach, strefa czasowa. Bez ogólników („warto się przygotować”). Nie powtarzaj tego, co plan już ma (`alreadyInPlan`).',
    '2. `contacts`: numery alarmowe kraju (policja, pogotowie, straż), ambasada lub konsulat RP, jeśli znasz pewny numer. Nie zmyślaj numerów — gdy nie jesteś pewien, pomiń kontakt.',
    '3. `packing`: lista pod warunki i aktywności tego wyjazdu (np. noc na pustyni, plaża zimą, szlak), z podziałem `personal` (każdy) i `shared` (jeden na grupę); dzieci w grupie = rzeczy dla dzieci. Bez rzeczy oczywistych (bielizna, szczoteczka), bez tego, co już jest w planie.',
    '4. `tasks`: co zrobić przed wyjazdem i kiedy (`daysBefore`: ile dni przed wyjazdem), np. ubezpieczenie, waluta, eSIM, potwierdzenia rezerwacji, odprawa online. Bez zadań, które plan już ma.',
    '5. `sources`: wyłącznie oficjalne albo bardzo wiarygodne strony (np. gov.pl „Polak za granicą”, ambasady, oficjalne strony turystyczne i przewoźników), pełne adresy URL, które istnieją. `sourceIndexes` w notatce wskazuje źródła, na których się opiera. Kod sprawdzi każdy adres i odrzuci martwe.',
    '6. Strefa czasowa, różnica względem domu, wschody i zachody słońca — WYŁĄCZNIE z `facts` (liczy je kod z aktualnej bazy stref); nie podawaj ich z pamięci, przepisy o czasie bywają zmieniane.',
    '7. Wszystko po polsku, zwięźle.',
    '',
    'JSON Schema:',
    schemaOf(PracticalInfo),
    '',
    'Wyjazd:',
    JSON.stringify(practicalContext(doc, brief), null, 1),
  ].join('\n');
}

export type SourceCheck = { title: string; url: string; ok: boolean; status?: number; error?: string };

/** Czy adres odpowiada (HEAD, a gdy serwer go nie obsługuje — GET); 2xx/3xx = żyje. */
export async function checkSource(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<{ ok: boolean; status?: number; error?: string }> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const response = await fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'ExpeditionPlan/0.1 (source check)' } });
    return response.status;
  };
  try {
    let status = await attempt('HEAD');
    if (status === 405 || status === 403 || status === 501) status = await attempt('GET');
    return { ok: status < 400, status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type PracticalDraft = { info: PracticalInfo; sources: SourceCheck[] };

/** Szkic etapu 5: odpowiedź AI + martwe źródła usunięte (indeksy w notatkach przeliczone). */
export async function practicalInfo(
  doc: Doc,
  brief: TripBrief | null,
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void; fetchImpl?: typeof fetch },
): Promise<PracticalDraft> {
  const answer = await askStructured(deps.client, PracticalInfo, practicalPrompt(doc, brief), {
    system: SYSTEM,
    maxTokens: 12_000,
    timeoutMs: deps.timeoutMs ?? 120_000,
    label: `${doc.trip.title} etap 5`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  const checks = await Promise.all(answer.data.sources.map(async (source) => ({ title: source.title, url: source.url, ...(await checkSource(source.url, deps.fetchImpl)) })));
  const keep = new Map<number, number>();
  checks.forEach((check, i) => {
    if (check.ok) keep.set(i, keep.size);
  });
  const info: PracticalInfo = {
    ...answer.data,
    sources: answer.data.sources.filter((_, i) => keep.has(i)),
    notes: answer.data.notes.map((note) => ({ ...note, sourceIndexes: note.sourceIndexes.flatMap((i) => (keep.has(i) ? [keep.get(i)!] : [])) })),
  };
  return { info, sources: checks };
}

export type PracticalPick = Partial<Record<'notes' | 'contacts' | 'packing' | 'tasks' | 'sources', number[]>>;
export type PracticalCreated =
  | { collection: 'notes'; element: Doc['notes'][number] & { ref: string } }
  | { collection: 'contacts'; element: Doc['contacts'][number] }
  | { collection: 'packing'; element: Doc['packing'][number] }
  | { collection: 'tasks'; element: Doc['tasks'][number] }
  | { collection: 'sources'; element: Doc['sources'][number] };

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

/**
 * Wybrane elementy szkicu → nowe elementy planu (klucze `id-<uuid>`). Pakowanie i zadania o tej
 * samej nazwie co już w planie są pomijane; notatka dostaje na końcu tytuły swoich źródeł.
 */
export function mergePractical(doc: Doc, info: PracticalInfo, pick: PracticalPick, newId: () => string, today: string): { doc: Doc; created: PracticalCreated[] } {
  const chosen = <T,>(list: T[], key: keyof PracticalPick) => (pick[key] ?? []).flatMap((i) => (list[i] === undefined ? [] : [list[i]!]));
  const ref = () => `id-${newId()}`;
  const created: PracticalCreated[] = [];
  for (const source of chosen(info.sources, 'sources')) {
    created.push({ collection: 'sources', element: { ref: ref(), title: source.title, url: source.url, checkedAt: today, ...(source.note ? { note: source.note } : {}), appliesToRefs: [] } });
  }
  for (const note of chosen(info.notes, 'notes')) {
    const cited = note.sourceIndexes.flatMap((i) => (info.sources[i] ? [info.sources[i]!.title] : []));
    created.push({
      collection: 'notes',
      element: { ref: ref(), scope: 'trip', kind: note.kind, topic: note.topic, title: note.title, body: cited.length > 0 ? `${note.body}\n\nŹródła: ${cited.join('; ')}` : note.body },
    });
  }
  for (const contact of chosen(info.contacts, 'contacts')) {
    if (doc.contacts.some((each) => same(each.name, contact.name))) continue;
    created.push({ collection: 'contacts', element: { ref: ref(), name: contact.name, role: contact.role, ...(contact.phone ? { phone: contact.phone } : {}), ...(contact.notes ? { notes: contact.notes } : {}) } });
  }
  for (const item of chosen(info.packing, 'packing')) {
    if (doc.packing.some((each) => same(each.title, item.title))) continue;
    created.push({ collection: 'packing', element: { ref: ref(), category: item.category, title: item.title, scope: item.scope, ...(item.quantity ? { quantity: item.quantity } : {}), ...(item.unit ? { unit: item.unit } : {}), ...(item.note ? { note: item.note } : {}) } });
  }
  for (const task of chosen(info.tasks, 'tasks')) {
    if (doc.tasks.some((each) => same(each.title, task.title))) continue;
    created.push({
      collection: 'tasks',
      element: {
        ref: ref(),
        kind: task.kind,
        title: task.title,
        status: 'open',
        assigneeRefs: [],
        ...(task.body ? { body: task.body } : {}),
        ...(task.priority ? { priority: task.priority } : {}),
        ...(task.daysBefore !== undefined ? { due: { kind: 'before_trip' as const, days: task.daysBefore } } : {}),
      },
    });
  }
  const of = (collection: PracticalCreated['collection']) => created.filter((entry) => entry.collection === collection).map((entry) => entry.element);
  return {
    doc: {
      ...doc,
      sources: [...doc.sources, ...(of('sources') as Doc['sources'])],
      notes: [...doc.notes, ...(of('notes') as Doc['notes'])],
      contacts: [...doc.contacts, ...(of('contacts') as Doc['contacts'])],
      packing: [...doc.packing, ...(of('packing') as Doc['packing'])],
      tasks: [...doc.tasks, ...(of('tasks') as Doc['tasks'])],
    },
    created,
  };
}
