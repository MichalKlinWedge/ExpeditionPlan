import type { ScheduleOptions } from './engine/schedule.ts';
import type { TripDocument } from './schemas/trip-document.ts';

type Doc = TripDocument;

/** Zdarzenia dnia z telefonu (`schedule_events`) w postaci, którą pokazuje web: kto co zrobił w terenie. */
export type FieldLog = {
  /** „Zostajemy dłużej” — suma minut na punkt. */
  delays: { itemRef: string; title: string; minutes: number }[];
  /** „Pomiń” — punkty wypadłe z dnia (silnik ich już nie liczy, więc nie ma ich na osi). */
  skipped: { itemRef: string; title: string }[];
  /** „✓ Zrobione” — chwila odhaczenia (UTC ms). */
  done: { itemRef: string; title: string; at: number }[];
  /** „Z puli w pobliżu” — punkty z puli wstawione w terenie do tego dnia. */
  pulled: { itemRef: string; title: string }[];
  /** Wariant wybrany na telefonie (`choose_variant`) w grupie tego dnia. */
  variants: { groupRef: string; group: string; variantRef: string; variant: string }[];
};

type FieldInputs = Pick<ScheduleOptions, 'delays' | 'skipRefs' | 'done' | 'pulled' | 'activeVariants'>;

/**
 * Przebieg dnia z terenu: opóźnienia, pominięcia, „zrobione”, punkty z puli i wybrane warianty —
 * tylko te, które dotyczą dnia `dayRef` (punkty dnia, punkty wstawione do niego z puli, grupy
 * wariantów dnia albo jego punktów). Wejście = `scheduleInputs` z `packages/sync`.
 */
export function fieldLog(doc: Doc, dayRef: string, inputs: FieldInputs): FieldLog {
  const pulledHere = (inputs.pulled ?? []).filter((each) => each.dayRef === dayRef).map((each) => each.itemRef);
  const items = new Map(doc.items.filter((item) => item.dayRef === dayRef || pulledHere.includes(item.ref)).map((item) => [item.ref, item]));
  const title = (ref: string) => items.get(ref)!.title;

  const minutes = new Map<string, number>();
  for (const delay of inputs.delays ?? []) if (items.has(delay.itemRef)) minutes.set(delay.itemRef, (minutes.get(delay.itemRef) ?? 0) + delay.minutes);

  const variantGroup = new Map(doc.variants.map((variant) => [variant.ref, variant.groupRef]));
  const dayGroups = new Set(doc.variantGroups.filter((group) => group.dayRef === dayRef).map((group) => group.ref));
  for (const item of items.values()) for (const variantRef of item.variantRefs) dayGroups.add(variantGroup.get(variantRef) ?? '');

  return {
    delays: [...minutes].filter(([, total]) => total !== 0).map(([itemRef, total]) => ({ itemRef, title: title(itemRef), minutes: total })),
    skipped: [...new Set(inputs.skipRefs ?? [])].filter((ref) => items.has(ref)).map((itemRef) => ({ itemRef, title: title(itemRef) })),
    done: (inputs.done ?? []).filter((each) => items.has(each.itemRef)).map((each) => ({ itemRef: each.itemRef, title: title(each.itemRef), at: each.at })),
    pulled: pulledHere.filter((ref) => items.has(ref)).map((itemRef) => ({ itemRef, title: title(itemRef) })),
    variants: Object.entries(inputs.activeVariants ?? {}).flatMap(([groupRef, variantRef]) => {
      const group = doc.variantGroups.find((each) => each.ref === groupRef);
      const variant = doc.variants.find((each) => each.ref === variantRef);
      return group && variant && dayGroups.has(groupRef) ? [{ groupRef, group: group.title, variantRef, variant: variant.label }] : [];
    }),
  };
}

/** Czy w dniu cokolwiek zdarzyło się w terenie. */
export const hasFieldLog = (log: FieldLog) => log.delays.length + log.skipped.length + log.done.length + log.pulled.length + log.variants.length > 0;
