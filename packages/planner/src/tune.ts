import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import {
  addItem,
  dayItems,
  documentProblem,
  ItemInUseError,
  type MergeEdit,
  moveAfter,
  moveToDay,
  type PatchOp,
  PlanPatch,
  type PlanItem,
  removeItemClosingGap,
  TripDocument,
  updateItem,
} from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Etap 3 — dostrajanie planu czatem (SPECYFIKACJA §4): polecenie człowieka → łatka (operacje na
 * punktach) → podgląd → zastosowanie po akceptacji. Łatka zamiast całego planu: tańsza, czytelna
 * i nie rusza reszty. Punkty zmienione ręcznie (`user_locked`) są nietykalne — operacja na nich
 * jest odrzucana z powodem, a nie wykonywana po cichu.
 */

type Doc = TripDocument;
type Item = PlanItem;
type PatchItemInput = Extract<PatchOp, { op: 'add_item' }>['item'];
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

const timeLabel = (item: Item) => {
  const time = item.time;
  if (time === undefined) return undefined;
  if (time.precision === 'exact' || time.precision === 'approx' || time.precision === 'range') return `${time.precision === 'exact' ? '' : 'ok. '}${time.start}`;
  if (time.precision === 'part_of_day') return time.partOfDay;
  if (time.precision === 'relative') return `+${time.offsetMin} min`;
  return 'cały dzień';
};

/** Zwięzły plan dla modelu: dni z punktami (klucze, godziny, czas, miejsce, blokada) i pula. */
export function tuneContext(doc: Doc, locked: ReadonlySet<string>) {
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  const describe = (item: Item) => ({
    ref: item.ref,
    title: item.title,
    kind: item.kind,
    time: timeLabel(item),
    durationMin: item.durationMin ?? item.leg?.durationMin,
    place: item.placeRef === undefined ? undefined : places.get(item.placeRef),
    ...(locked.has(item.ref) ? { locked: true } : {}),
    ...(item.variantRefs.length > 0 ? { variantOnly: true } : {}),
  });
  const variantsOf = (dayRef: string) =>
    doc.variantGroups
      .filter((group) => group.dayRef === dayRef && group.scope !== 'booking')
      .map((group) => ({ title: group.title, options: doc.variants.filter((variant) => variant.groupRef === group.ref).map((variant) => variant.label) }));
  return {
    title: doc.trip.title,
    travelers: doc.travelers.map((each) => ({ name: each.name, age: each.age })),
    days: doc.days.map((day) => {
      const variants = variantsOf(day.ref);
      return { ref: day.ref, date: day.date, title: day.title, items: dayItems(doc, day.ref).map(describe), ...(variants.length > 0 ? { variants } : {}) };
    }),
    pool: doc.items.filter((item) => item.dayRef === undefined).map(describe),
  };
}

export function tunePrompt(doc: Doc, locked: ReadonlySet<string>, history: ChatTurn[], command: string): string {
  return [
    'Etap 3 — dostrajanie planu. Człowiek prosi o zmianę; odpowiedz ŁATKĄ: listą operacji na istniejącym planie i krótką wiadomością.',
    '',
    'Zasady:',
    '1. Zmieniaj tylko to, o co prosi polecenie — reszta planu zostaje. Najmniej operacji, które to załatwiają.',
    '2. Punkty i dni wskazuj kluczami z planu (`itemRef`, `dayRef`, `afterItemRef`). Nie wymyślaj kluczy.',
    '3. Punkty z `locked: true` zmienił człowiek — NIE ruszaj ich; jeśli polecenie tego wymaga, napisz to w `message`.',
    '4. `remove_item` domyślnie przenosi punkt do puli (`toPool: true`); `toPool: false` tylko, gdy człowiek wprost każe usunąć.',
    '5. `add_item`/`replace_item`: realny czas trwania, godzina tylko gdy ważna (otwarcie, zachód, rezerwacja); `place` po polsku i `searchName` z OpenStreetMap dla konkretnego miejsca.',
    '6. Plan B / alternatywa „jeśli pada”, „jeśli zamknięte”, „jeśli dzieci zmęczone” → `add_variant`: obecny plan dnia zostaje wariantem A (`mainLabel`), wariant B zastępuje `replacesItemRefs` punktami `items`. Nie usuwaj punktów, żeby zrobić alternatywę; nie dubluj wariantu, który dzień już ma (`variants`).',
    '7. Jeśli czegoś nie da się zrobić albo dzień się nie zmieści — powiedz to w `message` zamiast udawać. Piszesz po polsku.',
    '',
    'JSON Schema:',
    schemaOf(PlanPatch),
    '',
    'Plan:',
    JSON.stringify(tuneContext(doc, locked), null, 1),
    '',
    history.length > 0 ? `Wcześniejsza rozmowa:\n${history.map((turn) => `${turn.role === 'user' ? 'Człowiek' : 'Ty'}: ${turn.content}`).join('\n')}\n` : '',
    `Polecenie: ${command}`,
  ].join('\n');
}

export async function tunePlan(
  doc: Doc,
  locked: ReadonlySet<string>,
  history: ChatTurn[],
  command: string,
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void },
): Promise<PlanPatch> {
  const answer = await askStructured(deps.client, PlanPatch, tunePrompt(doc, locked, history, command), {
    system: SYSTEM,
    maxTokens: 8_000,
    timeoutMs: deps.timeoutMs ?? 90_000,
    label: `${doc.trip.title} etap 3`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  return answer.data;
}

export type OpResult = { op: PatchOp['op']; ok: boolean; text: string };

/** Miejsce o tej nazwie z planu albo nowe (bez współrzędnych — dołoży je ugruntowanie). */
function placeFor(doc: Doc, input: PatchItemInput, newId: () => string): { doc: Doc; ref?: string } {
  if (!input.place) return { doc };
  const existing = doc.places.find((place) => place.name.trim().toLocaleLowerCase('pl') === input.place!.trim().toLocaleLowerCase('pl'));
  if (existing) return { doc, ref: existing.ref };
  const ref = `id-${newId()}`;
  return { doc: { ...doc, places: [...doc.places, { ref, name: input.place, ...(input.searchName ? { searchName: input.searchName } : {}), provider: 'unknown', links: [] }] }, ref };
}

const timeOf = (input: PatchItemInput): Item['time'] => (input.start ? { precision: input.precision ?? 'approx', start: input.start } : undefined);

/**
 * Łatka na dokumencie, operacja po operacji. Każda musi zostawić poprawny dokument; zła albo na
 * punkcie zablokowanym jest pomijana z powodem (podgląd pokazuje ✓/✗). Nic się tu nie zapisuje.
 */
export function applyPatch(doc: Doc, patch: PlanPatch, locked: ReadonlySet<string>, newId: () => string): { doc: Doc; results: OpResult[] } {
  let current = doc;
  const results: OpResult[] = [];
  const title = (ref: string) => current.items.find((item) => item.ref === ref)?.title;
  const dayName = (ref: string) => {
    const day = current.days.find((each) => each.ref === ref);
    return day ? `${day.date}${day.title ? ` (${day.title})` : ''}` : undefined;
  };
  for (const op of patch.ops) {
    const fail = (text: string) => results.push({ op: op.op, ok: false, text });
    const target = 'itemRef' in op ? current.items.find((item) => item.ref === op.itemRef) : undefined;
    if ('itemRef' in op && target === undefined) {
      fail(`Nie ma punktu „${op.itemRef}”.`);
      continue;
    }
    if (target !== undefined && locked.has(target.ref)) {
      fail(`„${target.title}” zmieniłeś ręcznie — AI go nie rusza.`);
      continue;
    }
    let next: Doc | null = null;
    let text = '';
    try {
      switch (op.op) {
        case 'remove_item': {
          const edit = op.toPool ? moveToDay(current, op.itemRef, null) : removeItemClosingGap(current, op.itemRef);
          next = edit?.doc ?? null;
          text = `${op.toPool ? 'Do puli' : 'Usuń'}: „${target!.title}”${op.reason ? ` — ${op.reason}` : ''}`;
          break;
        }
        case 'move_item': {
          if (!current.days.some((day) => day.ref === op.toDayRef)) {
            fail(`Nie ma dnia „${op.toDayRef}”.`);
            continue;
          }
          next = moveAfter(current, op.itemRef, op.toDayRef, op.afterItemRef ?? dayItems(current, op.toDayRef).filter((each) => each.ref !== op.itemRef).at(-1)?.ref ?? null)?.doc ?? null;
          text = `Przenieś „${target!.title}” na ${dayName(op.toDayRef)}${op.afterItemRef ? `, po „${title(op.afterItemRef)}”` : ''}`;
          break;
        }
        case 'add_item': {
          if (!current.days.some((day) => day.ref === op.dayRef)) {
            fail(`Nie ma dnia „${op.dayRef}”.`);
            continue;
          }
          const placed = placeFor(current, op.item, newId);
          const time = timeOf(op.item);
          const added = addItem(placed.doc, op.dayRef, newId(), {
            title: op.item.title,
            kind: op.item.kind,
            ...(op.item.durationMin !== undefined ? { durationMin: op.item.durationMin } : {}),
            ...(time ? { time } : {}),
            ...(placed.ref ? { placeRef: placed.ref } : {}),
            ...(op.item.description ? { description: op.item.description } : {}),
          });
          const created = added.created!;
          next = op.afterItemRef ? (moveAfter(added.doc, created.ref, op.dayRef, op.afterItemRef)?.doc ?? null) : added.doc;
          text = `Dodaj na ${dayName(op.dayRef)}: „${op.item.title}”${op.item.start ? ` ok. ${op.item.start}` : ''}${op.item.durationMin ? `, ${op.item.durationMin} min` : ''}${op.afterItemRef ? `, po „${title(op.afterItemRef)}”` : ''}`;
          break;
        }
        case 'replace_item': {
          const placed = placeFor(current, op.with, newId);
          const time = timeOf(op.with);
          next =
            updateItem(placed.doc, op.itemRef, {
              title: op.with.title,
              kind: op.with.kind,
              durationMin: op.with.durationMin,
              time: time ?? target!.time,
              placeRef: placed.ref,
              description: op.with.description,
            })?.doc ?? null;
          text = `Zamień „${target!.title}” na „${op.with.title}”`;
          break;
        }
        case 'add_variant': {
          if (!current.days.some((day) => day.ref === op.dayRef)) {
            fail(`Nie ma dnia „${op.dayRef}”.`);
            continue;
          }
          const list = dayItems(current, op.dayRef);
          const missing = op.replacesItemRefs.filter((ref) => !list.some((item) => item.ref === ref));
          if (missing.length > 0) {
            fail(`Wariant „${op.label}”: punktów ${missing.join(', ')} nie ma w tym dniu.`);
            continue;
          }
          const groupRef = `id-${newId()}`;
          const mainRef = `id-${newId()}`;
          const altRef = `id-${newId()}`;
          let draft: Doc = {
            ...current,
            variantGroups: [
              ...current.variantGroups,
              { ref: groupRef, scope: 'day', dayRef: op.dayRef, title: op.title, conditionKind: op.conditionKind, ...(op.conditionText ? { conditionText: op.conditionText } : {}) },
            ],
            // A pierwszy: bez wyboru silnik liczy dzień tak jak dotąd.
            variants: [
              ...current.variants,
              { ref: mainRef, groupRef, label: op.mainLabel, pros: [], cons: [], excludesRefs: [] },
              { ref: altRef, groupRef, label: op.label, pros: [], cons: [], excludesRefs: op.replacesItemRefs },
            ],
          };
          // Nowe punkty w miejsce pierwszego zastępowanego (bez zastępowanych — na koniec dnia).
          const first = list.findIndex((item) => op.replacesItemRefs.includes(item.ref));
          let after: string | null = first === -1 ? (list.at(-1)?.ref ?? null) : first === 0 ? null : list[first - 1]!.ref;
          for (const input of op.items) {
            const placed = placeFor(draft, input, newId);
            const time = timeOf(input);
            const added = addItem(placed.doc, op.dayRef, newId(), {
              title: input.title,
              kind: input.kind,
              variantRefs: [altRef],
              ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
              ...(time ? { time } : {}),
              ...(placed.ref ? { placeRef: placed.ref } : {}),
              ...(input.description ? { description: input.description } : {}),
            });
            const moved = moveAfter(added.doc, added.created!.ref, op.dayRef, after);
            if (moved === null) throw new Error('nie da się wstawić punktu wariantu');
            draft = moved.doc;
            after = added.created!.ref;
          }
          next = draft;
          const replaced = op.replacesItemRefs.map((ref) => `„${title(ref)}”`).join(', ');
          text = `Wariant na ${dayName(op.dayRef)} — ${op.title}: „${op.mainLabel}” albo „${op.label}” (${op.items.map((each) => `„${each.title}”`).join(', ')}${replaced ? ` zamiast ${replaced}` : ''})`;
          break;
        }
        case 'set_field': {
          const patchFields: Partial<Item> =
            op.field === 'durationMin'
              ? { durationMin: Number(op.value) }
              : op.field === 'start'
                ? { time: { precision: target!.time?.precision === 'exact' ? 'exact' : 'approx', start: String(op.value) } }
                : { [op.field]: String(op.value) };
          next = updateItem(current, op.itemRef, patchFields)?.doc ?? null;
          text = `„${target!.title}”: ${op.field === 'durationMin' ? 'czas' : op.field === 'start' ? 'godzina' : op.field === 'title' ? 'nazwa' : 'opis'} → ${op.value}${op.field === 'durationMin' ? ' min' : ''}`;
          break;
        }
      }
    } catch (error) {
      fail(error instanceof ItemInUseError ? error.message : `${op.op}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (next === null) {
      fail(`${text || op.op}: nie da się wykonać.`);
      continue;
    }
    const problem = documentProblem(next);
    if (problem !== null) {
      fail(`${text}: plan przestałby się składać (${problem}).`);
      continue;
    }
    current = next;
    results.push({ op: op.op, ok: true, text });
  }
  return { doc: current, results };
}

/** Różnica dwóch dokumentów jako zapis (`saveMergeEdit`): nowe miejsca, warianty i punkty, zmienione punkty, usunięte, poprawione warianty/źródła. */
export function patchDiff(before: Doc, after: Doc): MergeEdit {
  const old = new Map(before.items.map((item) => [item.ref, item]));
  const now = new Map(after.items.map((item) => [item.ref, item]));
  const oldPlaces = new Set(before.places.map((place) => place.ref));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changedOthers = <T extends { ref: string }>(collection: 'variants' | 'sources', a: T[], b: T[]) =>
    b.filter((element) => {
      const was = a.find((each) => each.ref === element.ref);
      return was !== undefined && !same(was, element);
    }).map((element) => ({ collection, element }));
  return {
    doc: after,
    created: [
      ...after.places.filter((place) => !oldPlaces.has(place.ref)).map((element) => ({ collection: 'places' as const, element })),
      ...after.variantGroups.filter((group) => !before.variantGroups.some((each) => each.ref === group.ref)).map((element) => ({ collection: 'variantGroups' as const, element })),
      ...after.variants.filter((variant) => !before.variants.some((each) => each.ref === variant.ref)).map((element) => ({ collection: 'variants' as const, element })),
      ...after.items.filter((item) => !old.has(item.ref)).map((element) => ({ collection: 'items' as const, element })),
    ],
    changed: after.items.filter((item) => old.has(item.ref) && !same(old.get(item.ref), item)),
    others: [...changedOthers('variants', before.variants, after.variants), ...changedOthers('sources', before.sources, after.sources)] as MergeEdit['others'],
    removed: before.items.filter((item) => !now.has(item.ref)).map((item) => item.ref),
    kept: [],
    copied: {},
  };
}
