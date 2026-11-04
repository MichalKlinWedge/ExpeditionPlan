import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Pozycje listy „Rodzaj”. Trekking i przejście pieszo to w danych przejazd (`transport`) z trybem
 * `hike` albo `walk`: dzięki temu mają czas drogi, punkty „skąd/dokąd” i przeliczanie trasy.
 * Inne środki transportu zostają pod jedną pozycją „przejazd”.
 */

type Item = TripDocument['items'][number];
type Leg = NonNullable<Item['leg']>;

const FOOT = { hike: 'trekking', walk: 'pieszo' } as const;
type FootMode = keyof typeof FOOT;

export type KindChoice = Item['kind'] | FootMode;

const footMode = (value: string | undefined): FootMode | undefined => (value === 'hike' || value === 'walk' ? value : undefined);

/** Pozycje listy: etykiety rodzajów z aplikacji, a zaraz za przejazdem trekking i pieszo. */
export function kindChoices(labels: Record<string, string>): [KindChoice, string][] {
  return Object.entries(labels).flatMap(([key, name]): [KindChoice, string][] =>
    key === 'transport' ? [[key, name], ['hike', FOOT.hike], ['walk', FOOT.walk]] : [[key as KindChoice, name]],
  );
}

/** Pozycja listy, którą punkt ma teraz. */
export function kindChoice(item: Pick<Item, 'kind' | 'leg'>): KindChoice {
  return (item.kind === 'transport' ? footMode(item.leg?.mode) : undefined) ?? item.kind;
}

/** Nazwa rodzaju do pokazania przy punkcie. */
export function itemKindLabel(item: Pick<Item, 'kind' | 'leg'>, labels: Record<string, string>): string | undefined {
  const foot = item.kind === 'transport' ? footMode(item.leg?.mode) : undefined;
  return foot === undefined ? labels[item.kind] : FOOT[foot];
}

/** Rodzaj i szczegóły przejazdu po wyborze z listy. Szczegóły przejazdu istnieją tylko przy punkcie `transport`. */
export function kindPatch(item: Pick<Item, 'kind' | 'leg'> | null, choice: KindChoice): { kind: Item['kind']; leg: Leg | undefined } {
  const foot = footMode(choice);
  if (foot === undefined && choice !== 'transport') return { kind: choice as Item['kind'], leg: undefined };
  const current = item?.kind === 'transport' ? item.leg : undefined;
  // „Przejazd” z trekkingu albo przejścia pieszo: bez trybu pieszego, więc domyślnie auto.
  const mode = foot ?? (footMode(current?.mode) === undefined ? current?.mode : 'car');
  if (mode === undefined) return { kind: 'transport', leg: current };
  if (current === undefined) return { kind: 'transport', leg: { mode, links: [] } };
  if (current.mode === mode) return { kind: 'transport', leg: current };
  // Linia i czas z OpenRouteService dotyczyły poprzedniego środka transportu: zostaje sam szacunek.
  const { routed: _routed, geometry: _geometry, ...rest } = current;
  return { kind: 'transport', leg: { ...rest, mode } };
}
