import { activeVariants, type ScheduleOptions, scheduleDay, type ScheduledItem, type ScheduleWarning } from './engine/schedule.ts';
import { itemFacts } from './item-facts.ts';
import { formatMinutes } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Karta punktu na webie: co plan wie o punkcie (godziny z silnika, wariant, cena, kto, ostrzeżenia)
 * i sąsiednie punkty w kolejności planu dla wybranych wariantów — „Poprzedni” / „Następny”.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type PlanStep = { ref: string; title: string; dayRef: string };

/** Punkty planu po kolei: dni po kolei, w dniu kolejność silnika (jak w widoku planu), z podpunktami. */
export function planSequence(doc: Doc, options: ScheduleOptions = {}): PlanStep[] {
  return doc.days.flatMap((day) => {
    try {
      return scheduleDay(doc, day.ref, options).items.map((item) => ({ ref: item.ref, title: item.title, dayRef: day.ref }));
    } catch {
      // Dzień, którego silnik nie policzy, pokazuje błąd w planie; tu po prostu go nie ma.
      return [];
    }
  });
}

/**
 * Wybór wariantów, w którym punkt jest w planie: wybrany, a gdy punkt należy do innego wariantu —
 * z pierwszym jego wariantem. `switched` = wariant punktu nie jest tym wybranym.
 */
export function variantsForItem(doc: Doc, item: Item, chosen: Record<string, string> = {}): { variants: Record<string, string>; switched?: { groupRef: string; variantRef: string } } {
  const active = activeVariants(doc, chosen);
  if (item.variantRefs.length === 0 || item.variantRefs.some((ref) => active.has(ref))) return { variants: chosen };
  const variant = doc.variants.find((each) => each.ref === item.variantRefs[0]);
  if (variant === undefined) return { variants: chosen };
  return { variants: { ...chosen, [variant.groupRef]: variant.ref }, switched: { groupRef: variant.groupRef, variantRef: variant.ref } };
}

export type ItemInPlan = {
  /** Punkt policzony przez silnik; brak = punkt poza wyliczeniami (pula, wycięty, kandydat). */
  scheduled?: ScheduledItem;
  warnings: ScheduleWarning[];
  previous?: PlanStep;
  next?: PlanStep;
  /** Który to punkt planu i ile ich jest. */
  position?: { index: number; total: number };
};

/** Godziny, ostrzeżenia i sąsiedzi punktu przy tych opcjach silnika. */
export function itemInPlan(doc: Doc, itemRef: string, options: ScheduleOptions = {}): ItemInPlan {
  const steps = planSequence(doc, options);
  const index = steps.findIndex((step) => step.ref === itemRef);
  const dayRef = doc.items.find((each) => each.ref === itemRef)?.dayRef;
  let scheduled: ScheduledItem | undefined;
  let warnings: ScheduleWarning[] = [];
  if (dayRef !== undefined && index >= 0) {
    try {
      const day = scheduleDay(doc, dayRef, options);
      scheduled = day.items.find((each) => each.ref === itemRef);
      warnings = day.warnings.filter((warning) => warning.itemRef === itemRef);
    } catch {
      // Jak wyżej: błąd dnia widać w planie.
    }
  }
  return {
    ...(scheduled ? { scheduled } : {}),
    warnings,
    ...(index > 0 ? { previous: steps[index - 1]! } : {}),
    ...(index >= 0 && index < steps.length - 1 ? { next: steps[index + 1]! } : {}),
    ...(index >= 0 ? { position: { index: index + 1, total: steps.length } } : {}),
  };
}

const PRIORITY: Record<NonNullable<Item['priority']>, string> = { must: 'obowiązkowo', should: 'warto', optional: 'opcjonalnie' };
const STATUS: Partial<Record<Item['planStatus'], string>> = { candidate: 'kandydat — jeszcze nie w planie', alternative: 'alternatywa', does_not_fit: 'nie mieści się w planie', rejected: 'odrzucony' };
const WEATHER: Record<NonNullable<Item['weather']>, string> = { outdoor: 'pod gołym niebem', indoor: 'pod dachem', any: 'przy każdej pogodzie' };

export type ItemPlanFact = { label: string; text: string; refs?: { ref: string; title: string }[] };

/** Szczegóły punktu z planu, których karta nie pokazuje gdzie indziej. Pusto = nic do dodania. */
export function itemPlanFacts(doc: Doc, item: Item): ItemPlanFact[] {
  const facts: ItemPlanFact[] = [];
  const titled = (refs: readonly string[]) => refs.flatMap((ref) => doc.items.filter((each) => each.ref === ref).map((each) => ({ ref: each.ref, title: each.title })));
  const status = STATUS[item.planStatus];
  if (status) facts.push({ label: 'Status', text: status });
  for (const ref of item.variantRefs) {
    const variant = doc.variants.find((each) => each.ref === ref);
    const group = variant === undefined ? undefined : doc.variantGroups.find((each) => each.ref === variant.groupRef);
    if (variant) facts.push({ label: 'Wariant', text: group ? `${group.title}: „${variant.label}”` : `„${variant.label}”` });
  }
  const parent = item.parentRef === undefined ? undefined : doc.items.find((each) => each.ref === item.parentRef);
  if (parent) facts.push({ label: parent.kind === 'transport' ? 'Postój w trasie' : 'Część bloku', text: '', refs: [{ ref: parent.ref, title: parent.title }] });
  const children = doc.items.filter((each) => each.parentRef === item.ref);
  if (children.length > 0) facts.push({ label: item.kind === 'transport' ? 'Postoje w trasie' : 'W bloku', text: '', refs: children.map((each) => ({ ref: each.ref, title: each.title })) });
  const replaces = titled(item.replacesRefs);
  if (replaces.length > 0) facts.push({ label: 'Zamiast', text: '', refs: replaces });
  if (item.priority) facts.push({ label: 'Priorytet', text: PRIORITY[item.priority] });
  if (item.time && 'start' in item.time && item.isFixed) facts.push({ label: 'Godzina', text: 'stała — przesunięcia jej nie ruszają' });
  // Przy przejeździe czas jest w opisie przejazdu (`legLabel`).
  if (item.kind !== 'transport' && item.durationMin !== undefined) {
    const max = item.durationMaxMin !== undefined && item.durationMaxMin > item.durationMin ? `–${formatMinutes(item.durationMaxMin)}` : '';
    facts.push({ label: 'Czas trwania', text: `${formatMinutes(item.durationMin)}${max}` });
  }
  if (item.stopsMin) facts.push({ label: 'Postoje i przerwy', text: formatMinutes(item.stopsMin) });
  if (item.bufferAfterMin) facts.push({ label: 'Zapas po', text: formatMinutes(item.bufferAfterMin) });
  const money = itemFacts(doc, item);
  if (money.price) facts.push({ label: 'Cena', text: money.priceNote ? `${money.price} · ${money.priceNote}` : money.price });
  else if (money.priceNote) facts.push({ label: 'Cena', text: money.priceNote });
  if (money.payment) facts.push({ label: 'Płatność', text: money.payment });
  if (item.weather) facts.push({ label: 'Pogoda', text: WEATHER[item.weather] });
  if (item.selfCooked) facts.push({ label: 'Posiłek', text: 'gotujemy sami' });
  if (item.participantRefs !== undefined && item.participantRefs.length > 0) {
    const names = doc.travelers.filter((traveler) => item.participantRefs!.includes(traveler.ref)).map((traveler) => traveler.name);
    if (names.length > 0) facts.push({ label: 'Kto', text: names.join(', ') });
  }
  if (item.area && item.dayRef === undefined) facts.push({ label: 'Obszar', text: item.area });
  return facts;
}
