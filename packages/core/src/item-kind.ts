import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Pozycje listy „Rodzaj”. Trekking i przejście pieszo to w danych przejazd (`transport`) z trybem
 * `hike` albo `walk`: dzięki temu mają czas drogi, punkty „skąd/dokąd” i przeliczanie trasy.
 * Transport publiczny to też przejazd, z konkretnym środkiem w `leg.mode`. Pozostałe środki transportu
 * zostają pod jedną pozycją „przejazd”.
 */

type Item = TripDocument['items'][number];
type Leg = NonNullable<Item['leg']>;

const FOOT = { hike: 'trekking', walk: 'pieszo' } as const;
type FootMode = keyof typeof FOOT;

/** Środki transportu publicznego z nazwą przy punkcie, w kolejności listy wyboru. */
const PUBLIC = { bus: 'autobus', tram: 'tramwaj', metro: 'metro', train: 'pociąg', ferry: 'prom', cable_car: 'kolejka' } as const;
export type PublicMode = keyof typeof PUBLIC;
export const PUBLIC_MODES = Object.entries(PUBLIC) as [PublicMode, string][];
const DEFAULT_PUBLIC: PublicMode = 'bus';

export type KindChoice = Item['kind'] | FootMode | 'public';

const footMode = (value: string | undefined): FootMode | undefined => (value === 'hike' || value === 'walk' ? value : undefined);
const isPublic = (value: string | undefined): value is PublicMode => value !== undefined && value in PUBLIC;

/** Środek transportu publicznego punktu, jeśli nim jedzie. */
export const publicMode = (item: Pick<Item, 'kind' | 'leg'>): PublicMode | undefined => (item.kind === 'transport' && isPublic(item.leg?.mode) ? item.leg.mode : undefined);

/** Punkt jedzie komunikacją publiczną (autobus, tramwaj, metro, pociąg, prom, kolejka). */
export const isTransitItem = (item: Pick<Item, 'kind' | 'leg'>) => publicMode(item) !== undefined;

/** Pozycje listy: etykiety rodzajów z aplikacji, a zaraz za przejazdem transport publiczny, trekking i pieszo. */
export function kindChoices(labels: Record<string, string>): [KindChoice, string][] {
  return Object.entries(labels).flatMap(([key, name]): [KindChoice, string][] =>
    key === 'transport' ? [[key, name], ['public', 'transport publiczny'], ['hike', FOOT.hike], ['walk', FOOT.walk]] : [[key as KindChoice, name]],
  );
}

/** Pozycja listy, którą punkt ma teraz. */
export function kindChoice(item: Pick<Item, 'kind' | 'leg'>): KindChoice {
  if (publicMode(item) !== undefined) return 'public';
  return (item.kind === 'transport' ? footMode(item.leg?.mode) : undefined) ?? item.kind;
}

/** Nazwa rodzaju do pokazania przy punkcie. */
export function itemKindLabel(item: Pick<Item, 'kind' | 'leg'>, labels: Record<string, string>): string | undefined {
  const vehicle = publicMode(item);
  if (vehicle !== undefined) return PUBLIC[vehicle];
  const foot = item.kind === 'transport' ? footMode(item.leg?.mode) : undefined;
  return foot === undefined ? labels[item.kind] : FOOT[foot];
}

/**
 * Rodzaj i szczegóły przejazdu po wyborze z listy. Szczegóły przejazdu istnieją tylko przy punkcie `transport`.
 * `vehicle` to środek wybrany przy „transporcie publicznym”; bez niego zostaje dotychczasowy albo autobus.
 */
export function kindPatch(item: Pick<Item, 'kind' | 'leg'> | null, choice: KindChoice, vehicle?: PublicMode): { kind: Item['kind']; leg: Leg | undefined } {
  const foot = footMode(choice);
  if (foot === undefined && choice !== 'transport' && choice !== 'public') return { kind: choice as Item['kind'], leg: undefined };
  const current = item?.kind === 'transport' ? item.leg : undefined;
  // „Przejazd” bez szczegółów albo z trekkingu, przejścia pieszo i transportu publicznego: domyślnie auto.
  const other = current === undefined || footMode(current.mode) !== undefined || isPublic(current.mode) ? 'car' : current.mode;
  const mode = foot ?? (choice === 'public' ? (vehicle ?? (isPublic(current?.mode) ? current!.mode as PublicMode : DEFAULT_PUBLIC)) : other);
  if (current === undefined) return { kind: 'transport', leg: { mode, links: [] } };
  if (current.mode === mode) return { kind: 'transport', leg: current };
  // Linia i czas z OpenRouteService dotyczyły poprzedniego środka transportu: zostaje sam szacunek.
  const { routed: _routed, geometry: _geometry, ...rest } = current;
  return { kind: 'transport', leg: { ...rest, mode } };
}
