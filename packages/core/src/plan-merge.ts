import { dayItems, ItemInUseError, type PlanEdit, type PlanItem, removeItem } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { keyBetween, renumber } from './sort-key.ts';

/**
 * Szkic AI → plan (MVP-2, SPECYFIKACJA §4: AI daje szkic, decyduje człowiek). Szkic to osobny
 * wyjazd; tu porównuje się go z planem dzień po dniu (po dacie) i przenosi wybrane punkty albo
 * zastępuje cały dzień. Czyste funkcje na dokumentach, jak `plan-edits`: zwracają nowy plan
 * i listę zmian do zapisania.
 *
 * Kopiowanie: punkt dostaje nowy `ref` (`id-<uuid>`, jak punkty z edytora), miejsce szkicu trafia
 * do planu, chyba że plan ma już to samo (nazwa albo współrzędne w promieniu ~100 m), a dnia,
 * którego plan nie ma, przybywa. Odwołania do rzeczy, które istnieją tylko w szkicu (rezerwacja,
 * wariant, uczestnicy, ślad), są pomijane — plan ich nie zna.
 */

type Doc = TripDocument;
type Day = Doc['days'][number];
type Place = Doc['places'][number];

export type MergeCreated =
  | { collection: 'places'; element: Place }
  | { collection: 'days'; element: Day }
  | { collection: 'variantGroups'; element: Doc['variantGroups'][number] }
  | { collection: 'variants'; element: Doc['variants'][number] }
  | { collection: 'items'; element: PlanItem };

export type MergeEdit = {
  doc: Doc;
  /** Nowe elementy w kolejności zapisu: miejsca, dni, grupy wariantów, warianty, punkty. */
  created: MergeCreated[];
  /** Punkty poprawione przy usuwaniu innych (blok, „zamiast”). */
  changed: PlanItem[];
  others: NonNullable<PlanEdit['others']>;
  /** Punkty usunięte (miękko) przy zastępowaniu dnia. */
  removed: string[];
  /** Punkty planu, które zostały mimo zastąpienia dnia — z powodem. */
  kept: { ref: string; title: string; reason: string }[];
  /** Punkt szkicu → nowy punkt planu (żeby widok wiedział, co już przeniesiono). */
  copied: Record<string, string>;
};

/**
 * Punkt wspólny dla wszystkich wariantów szkicu. Punkt jednego wariantu („cięcie radykalne”)
 * bez tego wariantu stałby się zwykłym punktem i zdublował dzień — zbiorczo się go nie przenosi,
 * pojedynczo tak (wtedy decyduje człowiek).
 */
export const inAllVariants = (item: PlanItem) => item.variantRefs.length === 0;

export type DayPair = { date: string; planDay?: Day; draftDay?: Day; plan: PlanItem[]; draft: PlanItem[] };

/** Dni obu dokumentów połączone po dacie, w kolejności dat. */
export function pairDays(plan: Doc, draft: Doc): DayPair[] {
  const dates = [...new Set([...plan.days, ...draft.days].map((day) => day.date))].sort();
  return dates.map((date) => {
    const planDay = plan.days.find((day) => day.date === date);
    const draftDay = draft.days.find((day) => day.date === date);
    return {
      date,
      ...(planDay ? { planDay } : {}),
      ...(draftDay ? { draftDay } : {}),
      plan: planDay ? dayItems(plan, planDay.ref) : [],
      draft: draftDay ? dayItems(draft, draftDay.ref) : [],
    };
  });
}

const sameTitle = (name: string) => name.trim().toLocaleLowerCase('pl');
const sameName = (a: string, b: string) => sameTitle(a) === sameTitle(b);

/** Odległość w metrach (równoprostokątna — wystarcza do „to samo miejsce”). */
function metres(a: Place, b: Place): number {
  if (a.lat === undefined || a.lng === undefined || b.lat === undefined || b.lng === undefined) return Infinity;
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/** Stan kopiowania: rosnący plan i mapy ref szkicu → ref planu. */
class Merger {
  doc: Doc;
  readonly created: MergeCreated[] = [];
  readonly placeMap = new Map<string, string>();
  readonly copied: Record<string, string> = {};
  private readonly draft: Doc;
  private readonly newId: () => string;

  // Bez skrótu `private readonly` w parametrach — Node (usuwanie typów) go nie obsługuje.
  constructor(plan: Doc, draft: Doc, newId: () => string) {
    this.doc = plan;
    this.draft = draft;
    this.newId = newId;
  }

  place(draftRef: string | undefined): string | undefined {
    if (draftRef === undefined) return undefined;
    const known = this.placeMap.get(draftRef);
    if (known !== undefined) return known;
    const source = this.draft.places.find((each) => each.ref === draftRef);
    if (source === undefined) return undefined;
    const match = this.doc.places.find((each) => sameName(each.name, source.name) || metres(each, source) < 100);
    if (match !== undefined) {
      this.placeMap.set(draftRef, match.ref);
      return match.ref;
    }
    const element: Place = { ...source, ref: `id-${this.newId()}` };
    this.doc = { ...this.doc, places: [...this.doc.places, element] };
    this.created.push({ collection: 'places', element });
    this.placeMap.set(draftRef, element.ref);
    return element.ref;
  }

  /** Dzień planu dla daty; brak — nowy dzień z danymi dnia szkicu. */
  day(date: string): string {
    const existing = this.doc.days.find((each) => each.date === date);
    if (existing !== undefined) return existing.ref;
    const source = this.draft.days.find((each) => each.date === date);
    if (source === undefined) throw new Error(`Szkic nie ma dnia ${date}.`);
    const baseRef = this.place(source.baseRef);
    const element: Day = {
      ref: `id-${this.newId()}`,
      date: source.date,
      tz: source.tz,
      ...(source.title ? { title: source.title } : {}),
      ...(source.summary ? { summary: source.summary } : {}),
      ...(baseRef ? { baseRef } : {}),
      ...(source.anchorTime ? { anchorTime: source.anchorTime } : {}),
      ...(source.dayStart ? { dayStart: source.dayStart } : {}),
      ...(source.dayEnd ? { dayEnd: source.dayEnd } : {}),
    };
    const days = [...this.doc.days, element].sort((a, b) => a.date.localeCompare(b.date));
    this.doc = { ...this.doc, days };
    this.created.push({ collection: 'days', element });
    return element.ref;
  }

  /** Punkty szkicu na koniec dnia planu (`dayRef` null = do puli), w kolejności szkicu. */
  items(draftItems: PlanItem[], dayRef: string | null) {
    const refs = new Map(draftItems.map((item) => [item.ref, `id-${this.newId()}`]));
    let last = dayRef === null ? undefined : dayItems(this.doc, dayRef).at(-1)?.sortKey;
    const added: PlanItem[] = [];
    for (const source of draftItems) {
      const ref = refs.get(source.ref)!;
      const leg = source.leg && {
        ...source.leg,
        fromPlaceRef: this.place(source.leg.fromPlaceRef),
        toPlaceRef: this.place(source.leg.toPlaceRef),
        ticketBookingRef: undefined,
      };
      const activity = source.activity && { ...source.activity, trackRef: undefined };
      const sortKey = dayRef === null ? undefined : keyBetween(last);
      if (sortKey !== undefined) last = sortKey;
      const item: PlanItem = {
        ...source,
        ref,
        dayRef: dayRef ?? undefined,
        sortKey,
        planStatus: dayRef === null ? (source.planStatus === 'scheduled' ? 'candidate' : source.planStatus) : 'scheduled',
        placeRef: this.place(source.placeRef),
        // Blok i „zamiast” zostają tylko wtedy, gdy przenosi się też punkt, na który wskazują.
        parentRef: source.parentRef === undefined ? undefined : refs.get(source.parentRef),
        replacesRefs: source.replacesRefs.flatMap((each) => (refs.has(each) ? [refs.get(each)!] : [])),
        variantRefs: [],
        bookingRef: undefined,
        participantRefs: undefined,
        time: dayRef === null && source.time?.precision === 'relative' ? undefined : source.time,
        ...(leg ? { leg } : {}),
        ...(activity ? { activity } : {}),
      };
      added.push(item);
      this.copied[source.ref] = ref;
    }
    this.doc = { ...this.doc, items: [...this.doc.items, ...added] };
    for (const element of added) this.created.push({ collection: 'items', element });
  }

  result(extra: Partial<MergeEdit> = {}): MergeEdit {
    return { doc: this.doc, created: this.created, changed: [], others: [], removed: [], kept: [], copied: this.copied, ...extra };
  }
}

/** Wybrane punkty szkicu (`draftRefs`) na koniec dnia `date` w planie albo do puli (`null`). */
export function copyFromDraft(plan: Doc, draft: Doc, draftRefs: string[], date: string | null, newId: () => string): MergeEdit {
  const merger = new Merger(plan, draft, newId);
  const wanted = new Set(draftRefs);
  const order = draft.items.filter((item) => wanted.has(item.ref)).sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
  merger.items(order, date === null ? null : merger.day(date));
  return merger.result();
}

/**
 * Dzień planu zastąpiony dniem szkicu (punkty wspólne dla wariantów). Zostają punkty edytowane ręcznie (`locked`, kolumna
 * `user_locked`) i te, na które wskazuje coś, czego tu się nie zmienia (budżet, zadanie,
 * ograniczenie) — trafiają przed punkty szkicu, a `kept` mówi dlaczego.
 */
export function replaceDayFromDraft(plan: Doc, draft: Doc, date: string, locked: ReadonlySet<string>, newId: () => string): MergeEdit {
  const kept: MergeEdit['kept'] = [];
  const removed: string[] = [];
  const changed = new Map<string, PlanItem>();
  const others: MergeEdit['others'] = [];
  let doc = plan;
  const planDay = plan.days.find((day) => day.date === date);
  for (const item of planDay ? dayItems(plan, planDay.ref) : []) {
    if (locked.has(item.ref)) {
      kept.push({ ref: item.ref, title: item.title, reason: 'zmieniony ręcznie' });
      continue;
    }
    try {
      const edit = removeItem(doc, item.ref);
      if (edit === null) continue;
      doc = edit.doc;
      removed.push(item.ref);
      for (const each of edit.changed) changed.set(each.ref, each);
      others.push(...(edit.others ?? []));
    } catch (error) {
      if (!(error instanceof ItemInUseError)) throw error;
      kept.push({ ref: item.ref, title: item.title, reason: `powiązany: ${error.uses.join(', ')}` });
    }
  }
  const merger = new Merger(doc, draft, newId);
  const draftDay = draft.days.find((day) => day.date === date);
  if (draftDay !== undefined) {
    // Punkt, który został, i jego odpowiednik ze szkicu (ta sama nazwa) to jedno — bez dubla,
    // a punkt planu staje w miejscu odpowiednika. Zostałe bez odpowiednika idą na koniec dnia.
    const keptByTitle = new Map(kept.map((each) => [sameTitle(each.title), each.ref]));
    const draftItems = dayItems(draft, draftDay.ref);
    const dayRef = merger.day(date);
    merger.items(
      draftItems.filter((item) => inAllVariants(item) && !keptByTitle.has(sameTitle(item.title))),
      dayRef,
    );
    // Kolejność ze szkicu, także dla punktu wariantu, który został w planie.
    const order = draftItems.flatMap((item) => {
      const ref = keptByTitle.get(sameTitle(item.title)) ?? merger.copied[item.ref];
      return ref === undefined ? [] : [ref];
    });
    order.push(...kept.map((each) => each.ref).filter((ref) => !order.includes(ref)));
    // Świeży przedrostek: nowe klucze nie zderzą się w bazie ze starymi (unikalne w dniu), zanim te się zmienią.
    const fresh = renumber(order.length, Date.now().toString(36));
    const keys = new Map(order.map((ref, index) => [ref, fresh[index]!]));
    const rekey = (item: PlanItem) => (keys.has(item.ref) ? { ...item, sortKey: keys.get(item.ref)! } : item);
    merger.doc = { ...merger.doc, items: merger.doc.items.map(rekey) };
    for (const entry of merger.created) if (entry.collection === 'items') entry.element = rekey(entry.element);
    for (const each of kept) changed.set(each.ref, merger.doc.items.find((item) => item.ref === each.ref)!);
  }
  const gone = new Set(removed);
  return merger.result({
    changed: [...changed.values()].filter((item) => !gone.has(item.ref)).map((item) => merger.doc.items.find((each) => each.ref === item.ref) ?? item),
    others,
    removed,
    kept,
  });
}
