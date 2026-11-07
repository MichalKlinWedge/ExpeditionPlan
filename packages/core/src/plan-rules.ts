import { moveToDay, type PlanItem } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Warianty, ograniczenia i notatki dnia w edytorze planu (MVP-3) jako czyste funkcje: nowy dokument,
 * zapisy elementów (grupy wariantów, warianty, ograniczenia, notatki) i punkty, które zmieniły się przy okazji
 * (przypisanie do wariantu, powrót do puli). Usuwanie nie zostawia wiszących odwołań: punkt,
 * który był tylko w usuwanym wariancie, wraca do puli, a nie trafia do wszystkich wariantów.
 */

type Doc = TripDocument;
type Item = PlanItem;
export type VariantGroup = Doc['variantGroups'][number];
export type Variant = Doc['variants'][number];
export type Constraint = Doc['constraints'][number];
export type Note = Doc['notes'][number];

export type RuleWrite =
  | { collection: 'days'; element: Doc['days'][number]; op: 'update' }
  | { collection: 'variantGroups'; element: VariantGroup; op: 'insert' | 'update' | 'remove' }
  | { collection: 'variants'; element: Variant; op: 'insert' | 'update' | 'remove' }
  | { collection: 'constraints'; element: Constraint & { ref: string }; op: 'insert' | 'update' | 'remove' }
  | { collection: 'notes'; element: Note & { ref: string }; op: 'insert' | 'update' | 'remove' };

export type RulesEdit = {
  doc: Doc;
  /** W kolejności zapisu: grupa przed wariantem, usunięcia na końcu. */
  writes: RuleWrite[];
  /** Punkty zmienione przy okazji (przypisanie do wariantu, powrót do puli). */
  changed: Item[];
};

/** Grupy, które edytuje się w planie dnia — porównania rezerwacji i układy wyjazdu mają własne strony. */
export const dayVariantGroups = (doc: Doc, dayRef: string) =>
  doc.variantGroups.filter((group) => group.dayRef === dayRef && group.scope !== 'trip' && group.scope !== 'booking');

export const groupVariants = (doc: Doc, groupRef: string) => doc.variants.filter((variant) => variant.groupRef === groupRef);

/** Puste napisy i `undefined` znikają z elementu — zapis w bazie dostaje NULL, dokument nie ma klucza. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined && each !== '')) as T;
}

function swap<T extends { ref?: string }>(list: T[], changed: T[]): T[] {
  const next = new Map(changed.map((each) => [each.ref, each]));
  return list.map((each) => next.get(each.ref) ?? each);
}

const withItems = (doc: Doc, items: Item[]): Doc => ({ ...doc, items: swap(doc.items, items) });

/** Punkt dnia bez wariantów liczy się tylko jako „w planie” — „alternatywa” z wariantu by zniknęła. */
const inPlan = (item: Item): Item => (item.dayRef !== undefined && item.variantRefs.length === 0 ? { ...item, planStatus: 'scheduled' } : item);

// --- Warianty --------------------------------------------------------------------------------

export type GroupFields = Pick<VariantGroup, 'title' | 'conditionKind'> & Partial<Pick<VariantGroup, 'conditionText' | 'decideBy' | 'rationale'>>;

/**
 * Plan B dnia: grupa z dwoma wariantami. Punkty dnia zostają w obu — dopiero przypisanie
 * (`setItemVariants`) robi z nich „tylko A” albo „tylko B”. Pierwszy wariant jest domyślny,
 * więc dzień liczy się tak jak przed dodaniem grupy.
 */
export function addDayVariantGroup(doc: Doc, dayRef: string, newId: () => string, fields: GroupFields, labels: [string, string]): RulesEdit {
  if (!doc.days.some((day) => day.ref === dayRef)) throw new Error(`Nie ma dnia „${dayRef}”.`);
  const group: VariantGroup = clean({ ...fields, ref: `id-${newId()}`, scope: 'day' as const, dayRef });
  const variants: Variant[] = labels.map((label) => ({ ref: `id-${newId()}`, groupRef: group.ref, label: label.trim(), pros: [], cons: [], excludesRefs: [] }));
  return {
    doc: { ...doc, variantGroups: [...doc.variantGroups, group], variants: [...doc.variants, ...variants] },
    writes: [{ collection: 'variantGroups', element: group, op: 'insert' }, ...variants.map((element) => ({ collection: 'variants' as const, element, op: 'insert' as const }))],
    changed: [],
  };
}

/** Nazwa, warunek, termin decyzji, uzasadnienie, wybrany wariant (`chosenRef` — decyzja zapadła). */
export function updateVariantGroup(doc: Doc, groupRef: string, patch: Partial<GroupFields & Pick<VariantGroup, 'chosenRef'>>): RulesEdit | null {
  const group = doc.variantGroups.find((each) => each.ref === groupRef);
  if (group === undefined) return null;
  const next = clean({ ...group, ...patch });
  return { doc: { ...doc, variantGroups: swap(doc.variantGroups, [next]) }, writes: [{ collection: 'variantGroups', element: next, op: 'update' }], changed: [] };
}

export function addVariant(doc: Doc, groupRef: string, newId: () => string, label: string): RulesEdit | null {
  if (!doc.variantGroups.some((group) => group.ref === groupRef)) return null;
  const variant: Variant = { ref: `id-${newId()}`, groupRef, label: label.trim(), pros: [], cons: [], excludesRefs: [] };
  return { doc: { ...doc, variants: [...doc.variants, variant] }, writes: [{ collection: 'variants', element: variant, op: 'insert' }], changed: [] };
}

/** Etykieta, opis, rekomendacja — rekomendowany jest najwyżej jeden w grupie. */
export function updateVariant(doc: Doc, ref: string, patch: Partial<Pick<Variant, 'label' | 'summary' | 'recommended'>>): RulesEdit | null {
  const variant = doc.variants.find((each) => each.ref === ref);
  if (variant === undefined) return null;
  const changed: Variant[] = [clean({ ...variant, ...patch, recommended: patch.recommended === false ? undefined : (patch.recommended ?? variant.recommended) })];
  if (patch.recommended) {
    for (const other of groupVariants(doc, variant.groupRef)) {
      if (other.ref !== ref && other.recommended) changed.push(clean({ ...other, recommended: undefined }));
    }
  }
  return {
    doc: { ...doc, variants: swap(doc.variants, changed) },
    writes: changed.map((element) => ({ collection: 'variants' as const, element, op: 'update' as const })),
    changed: [],
  };
}

/** Coś spoza planu dnia, co wskazuje grupę albo wariant — usunięcie by to zepsuło. */
function usesOf(doc: Doc, groupRef: string, variantRefs: string[]): string[] {
  return [
    ...doc.tasks.filter((task) => task.variantGroupRef === groupRef).map((task) => `zadanie „${task.title}”`),
    ...doc.bookings.filter((booking) => booking.variantGroupRef === groupRef || (booking.variantRef !== undefined && variantRefs.includes(booking.variantRef))).map((booking) => `rezerwacja „${booking.title}”`),
  ];
}

/** Punkty po zniknięciu wariantów `gone`: bez nich, a te, które były tylko w nich — do puli. */
function dropVariants(doc: Doc, gone: Set<string>, alsoToPool: Set<string> = new Set()): { doc: Doc; changed: Item[] } {
  let next = doc;
  const changed = new Map<string, Item>();
  for (const item of doc.items) {
    const own = item.variantRefs.filter((ref) => gone.has(ref));
    if (own.length === 0 && !alsoToPool.has(item.ref)) continue;
    const rest = item.variantRefs.filter((ref) => !gone.has(ref));
    const stripped: Item = { ...item, variantRefs: rest };
    next = withItems(next, [stripped]);
    if ((own.length > 0 && rest.length === 0) || alsoToPool.has(item.ref)) {
      const pooled = moveToDay(next, item.ref, null);
      if (pooled !== null) {
        next = pooled.doc;
        changed.set(item.ref, pooled.changed[0]!);
        continue;
      }
    }
    changed.set(item.ref, stripped);
  }
  return { doc: next, changed: [...changed.values()] };
}

/** Grupa musi mieć co najmniej dwa warianty — jeden to już nie wybór. */
export function removeVariant(doc: Doc, ref: string): RulesEdit | null {
  const variant = doc.variants.find((each) => each.ref === ref);
  if (variant === undefined) return null;
  if (groupVariants(doc, variant.groupRef).length <= 2) throw new Error('Grupa musi mieć co najmniej dwa warianty — usuń całą grupę i wybierz, który plan zostaje.');
  const uses = usesOf(doc, '', [ref]);
  if (uses.length > 0) throw new Error(`Wariant „${variant.label}” jest powiązany z: ${uses.join(', ')}.`);
  const group = doc.variantGroups.find((each) => each.ref === variant.groupRef)!;
  const nextGroup: VariantGroup = clean({
    ...group,
    chosenRef: group.chosenRef === ref ? undefined : group.chosenRef,
    comparison: group.comparison === undefined ? undefined : { ...group.comparison, rows: group.comparison.rows.filter((row) => row.variantRef !== ref) },
  });
  const dropped = dropVariants(doc, new Set([ref]));
  return {
    doc: { ...dropped.doc, variantGroups: swap(doc.variantGroups, [nextGroup]), variants: doc.variants.filter((each) => each.ref !== ref) },
    writes: [{ collection: 'variantGroups', element: nextGroup, op: 'update' }, { collection: 'variants', element: variant, op: 'remove' }],
    changed: dropped.changed,
  };
}

/**
 * Koniec wyboru: zostaje plan wariantu `keepRef`. Jego punkty są odtąd zwykłymi punktami dnia,
 * punkty pozostałych wariantów i to, co `keepRef` wyrzucał, wracają do puli.
 */
export function removeVariantGroup(doc: Doc, groupRef: string, keepRef: string): RulesEdit | null {
  const group = doc.variantGroups.find((each) => each.ref === groupRef);
  if (group === undefined) return null;
  const variants = groupVariants(doc, groupRef);
  const keep = variants.find((each) => each.ref === keepRef);
  if (keep === undefined) throw new Error('Wybierz wariant z tej grupy, który zostaje w planie.');
  const uses = usesOf(doc, groupRef, variants.map((each) => each.ref));
  if (uses.length > 0) throw new Error(`Grupa „${group.title}” jest powiązana z: ${uses.join(', ')}.`);
  // Punkty kept wariantu: bez odwołań do grupy (`gone` bez keepRef usunie resztę, keepRef zdejmujemy osobno).
  const others = new Set(variants.filter((each) => each.ref !== keepRef).map((each) => each.ref));
  const dropped = dropVariants(doc, others, new Set(keep.excludesRefs));
  let next = dropped.doc;
  const changed = new Map(dropped.changed.map((item) => [item.ref, item]));
  for (const item of next.items) {
    if (!item.variantRefs.includes(keepRef)) continue;
    const stripped = inPlan({ ...item, variantRefs: item.variantRefs.filter((ref) => ref !== keepRef) });
    next = withItems(next, [stripped]);
    changed.set(item.ref, stripped);
  }
  return {
    doc: { ...next, variantGroups: next.variantGroups.filter((each) => each.ref !== groupRef), variants: next.variants.filter((each) => each.groupRef !== groupRef) },
    writes: [
      ...variants.map((element) => ({ collection: 'variants' as const, element, op: 'remove' as const })),
      { collection: 'variantGroups', element: group, op: 'remove' },
    ],
    changed: [...changed.values()],
  };
}

/** Jedyny wariant grupy z punktem: `null` = we wszystkich albo w kilku (`itemVariants`). */
export function itemVariant(doc: Doc, itemRef: string, groupRef: string): string | null {
  const own = itemVariants(doc, itemRef, groupRef);
  return own?.length === 1 ? own[0]! : null;
}

/**
 * Warianty grupy, w których jest punkt (kolejność grupy), albo `null` = we wszystkich.
 * „Wariant B wyrzuca X” = X w pozostałych.
 */
export function itemVariants(doc: Doc, itemRef: string, groupRef: string): string[] | null {
  const variants = groupVariants(doc, groupRef);
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const own = variants.filter((variant) => item.variantRefs.includes(variant.ref));
  if (own.length > 0) return own.length < variants.length ? own.map((variant) => variant.ref) : null;
  const keeping = variants.filter((variant) => !variant.excludesRefs.includes(itemRef));
  return keeping.length > 0 && keeping.length < variants.length ? keeping.map((variant) => variant.ref) : null;
}

/** Punkt „tylko w wariancie X” albo we wszystkich (`variantRef: null`). */
export function setItemVariant(doc: Doc, itemRef: string, groupRef: string, variantRef: string | null): RulesEdit | null {
  return setItemVariants(doc, itemRef, groupRef, variantRef === null ? null : [variantRef]);
}

/**
 * Punkt w wybranych wariantach grupy albo we wszystkich (`null`, też gdy wybrano komplet).
 * Odwołania do innych grup zostają; „wyrzuca” w wariantach tej grupy jest czyszczone —
 * przynależność trzyma odtąd `variantRefs` punktu.
 */
export function setItemVariants(doc: Doc, itemRef: string, groupRef: string, variantRefs: string[] | null): RulesEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  const variants = groupVariants(doc, groupRef);
  if (item === undefined || variants.length === 0) return null;
  if (variantRefs !== null && (variantRefs.length === 0 || variantRefs.some((ref) => !variants.some((variant) => variant.ref === ref)))) return null;
  const chosen = variantRefs === null || variantRefs.length >= variants.length ? [] : variants.filter((variant) => variantRefs.includes(variant.ref)).map((variant) => variant.ref);
  const own = new Set(variants.map((variant) => variant.ref));
  const nextItem = inPlan({ ...item, variantRefs: [...item.variantRefs.filter((ref) => !own.has(ref)), ...chosen] });
  const nextVariants = variants.filter((variant) => variant.excludesRefs.includes(itemRef)).map((variant) => ({ ...variant, excludesRefs: variant.excludesRefs.filter((ref) => ref !== itemRef) }));
  const itemChanged = nextItem.variantRefs.join() !== item.variantRefs.join() || nextItem.planStatus !== item.planStatus;
  if (!itemChanged && nextVariants.length === 0) return null;
  return {
    doc: { ...withItems(doc, [nextItem]), variants: swap(doc.variants, nextVariants) },
    writes: nextVariants.map((element) => ({ collection: 'variants' as const, element, op: 'update' as const })),
    changed: itemChanged ? [nextItem] : [],
  };
}

// --- Ograniczenia ----------------------------------------------------------------------------

export type ConstraintFields = Omit<Constraint, 'ref'>;

/** Ograniczenia dnia: przypięte do dnia albo do jego punktu. */
export const dayConstraints = (doc: Doc, dayRef: string) => {
  const items = new Set(doc.items.filter((item) => item.dayRef === dayRef).map((item) => item.ref));
  return doc.constraints.flatMap((constraint, index) =>
    constraint.dayRef === dayRef || (constraint.itemRef !== undefined && items.has(constraint.itemRef)) ? [{ constraint, index }] : [],
  );
};

export function addConstraint(doc: Doc, newId: () => string, fields: ConstraintFields): RulesEdit {
  const constraint = clean({ ...fields, ref: `id-${newId()}` });
  return { doc: { ...doc, constraints: [...doc.constraints, constraint] }, writes: [{ collection: 'constraints', element: constraint, op: 'insert' }], changed: [] };
}

/** Pełna zamiana pól (formularz podaje wszystkie) — pole puste znika. */
export function updateConstraint(doc: Doc, ref: string, fields: ConstraintFields): RulesEdit | null {
  if (!doc.constraints.some((each) => each.ref === ref)) return null;
  const constraint = clean({ ...fields, ref });
  return { doc: { ...doc, constraints: swap(doc.constraints, [constraint]) }, writes: [{ collection: 'constraints', element: constraint, op: 'update' }], changed: [] };
}

export function removeConstraint(doc: Doc, ref: string): RulesEdit | null {
  const constraint = doc.constraints.find((each) => each.ref === ref);
  if (constraint === undefined) return null;
  return {
    doc: { ...doc, constraints: doc.constraints.filter((each) => each.ref !== ref) },
    writes: [{ collection: 'constraints', element: { ...constraint, ref }, op: 'remove' }],
    changed: [],
  };
}

// --- Koniec dnia ------------------------------------------------------------------------------

/** Planowany koniec dnia: późniejszy koniec ostatniego punktu daje ostrzeżenie, a brak godziny je wyłącza. */
export function setDayEnd(doc: Doc, dayRef: string, dayEnd: string | undefined): RulesEdit | null {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined || (day.dayEnd ?? '') === (dayEnd ?? '')) return null;
  const next = clean({ ...day, dayEnd });
  return { doc: { ...doc, days: swap(doc.days, [next]) }, writes: [{ collection: 'days', element: next, op: 'update' }], changed: [] };
}

// --- Scenariusze dnia -------------------------------------------------------------------------

/** Czy dzień ma scenariusze optymistyczny / pesymistyczny (domyślnie tak). */
export const hasScenarios = (day: Pick<Doc['days'][number], 'scenarios'> | undefined) => day?.scenarios !== false;

/** Włączenie lub wyłączenie scenariuszy dnia; włączone = brak pola, jak w dniach sprzed tej opcji. */
export function setDayScenarios(doc: Doc, dayRef: string, on: boolean): RulesEdit | null {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined || hasScenarios(day) === on) return null;
  const next = clean({ ...day, scenarios: on ? undefined : false });
  return { doc: { ...doc, days: swap(doc.days, [next]) }, writes: [{ collection: 'days', element: next, op: 'update' }], changed: [] };
}

// --- Notatki dnia ----------------------------------------------------------------------------

/** Treść notatki z formularza; zasięg i cel (dzień) dopisuje funkcja. */
export type NoteFields = { title?: string; body: string; kind: Note['kind'] };

/** Notatki dnia w kolejności z dokumentu (także ocena zapasu z planu wzorcowego). */
export const dayNotes = (doc: Doc, dayRef: string) => doc.notes.filter((note) => note.scope === 'day' && note.targetRef === dayRef);

export function addDayNote(doc: Doc, newId: () => string, dayRef: string, fields: NoteFields): RulesEdit {
  const note = clean({ ...fields, scope: 'day' as const, targetRef: dayRef, ref: `id-${newId()}` });
  return { doc: { ...doc, notes: [...doc.notes, note] }, writes: [{ collection: 'notes', element: note, op: 'insert' }], changed: [] };
}

/** Zmiana tytułu, treści i rodzaju — zasięg, cel i temat zostają. */
export function updateNote(doc: Doc, ref: string, fields: NoteFields): RulesEdit | null {
  const current = doc.notes.find((each) => each.ref === ref);
  if (current === undefined) return null;
  const { title: _, ...rest } = current;
  const note = clean({ ...rest, ...fields, ref });
  return { doc: { ...doc, notes: swap(doc.notes, [note]) }, writes: [{ collection: 'notes', element: note, op: 'update' }], changed: [] };
}

export function removeNote(doc: Doc, ref: string): RulesEdit | null {
  const note = doc.notes.find((each) => each.ref === ref);
  if (note === undefined) return null;
  return { doc: { ...doc, notes: doc.notes.filter((each) => each.ref !== ref) }, writes: [{ collection: 'notes', element: { ...note, ref }, op: 'remove' }], changed: [] };
}

/**
 * Kilka zmian jako jedna (formularz grupy: nazwa, termin, etykiety, rekomendacja). Kolejny krok
 * widzi dokument po poprzednich; zapis jednego elementu zostaje jeden — wstawienie wygrywa
 * z późniejszą zmianą, usunięcie z wszystkim. `null` = nic się nie zmieniło.
 */
export function chainRules(doc: Doc, steps: ((doc: Doc) => RulesEdit | null)[]): RulesEdit | null {
  let current = doc;
  const writes = new Map<string, RuleWrite>();
  const changed = new Map<string, Item>();
  for (const step of steps) {
    const edit = step(current);
    if (edit === null) continue;
    current = edit.doc;
    for (const write of edit.writes) {
      const key = `${write.collection}:${write.element.ref}`;
      const before = writes.get(key);
      const op = write.op === 'remove' ? 'remove' : before?.op === 'insert' ? 'insert' : write.op;
      if (op === 'remove' && before?.op === 'insert') writes.delete(key);
      else writes.set(key, { ...write, op } as RuleWrite);
    }
    for (const item of edit.changed) changed.set(item.ref, item);
  }
  if (writes.size === 0 && changed.size === 0) return null;
  // Usunięcia na koniec — zapis i tak je odkłada, ale kolejność wstawień zostaje jak w krokach.
  const ordered = [...writes.values()].sort((a, b) => Number(a.op === 'remove') - Number(b.op === 'remove'));
  return { doc: current, writes: ordered, changed: [...changed.values()] };
}
