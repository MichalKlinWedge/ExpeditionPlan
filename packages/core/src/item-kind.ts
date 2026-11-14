import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Pozycje listy „Rodzaj”. Trekking i przejście pieszo to w danych przejazd (`transport`) z trybem
 * `hike` albo `walk`: dzięki temu mają czas drogi, punkty „skąd/dokąd” i przeliczanie trasy.
 * Transport publiczny to też przejazd, z konkretnym środkiem w `leg.mode`; tak samo przejazd z cudzym kierowcą
 * („taksówka / transfer”: taksówka albo bus z kierowcą). Pozostałe środki transportu zostają pod jedną pozycją „przejazd”.
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

/** Przejazd z cudzym kierowcą: jedzie drogą jak auto, ale prowadzi kto inny. */
const HIRED = { taxi: 'taksówka', hired_driver: 'bus / transfer z kierowcą' } as const;
export type HiredMode = keyof typeof HIRED;
export const HIRED_MODES = Object.entries(HIRED) as [HiredMode, string][];
const DEFAULT_HIRED: HiredMode = 'taxi';

/**
 * Samolot jest na liście „transportu publicznego”, ale nie jest komunikacją (`publicMode`, `isTransitItem`):
 * nie ma linku Google do komunikacji, wklejania połączenia ani linii z OSM.
 */
const FLIGHT = 'samolot';
const PUBLIC_VEHICLES: [PublicMode | 'flight', string][] = [...PUBLIC_MODES, ['flight', FLIGHT]];

/** Środek wybierany przy „transporcie publicznym” albo „taksówce / transferze”. */
export type VehicleMode = PublicMode | 'flight' | HiredMode;

export type KindChoice = Item['kind'] | FootMode | 'public' | 'hired';

/** Środki do wyboru przy pozycji listy (tylko „transport publiczny” i „taksówka / transfer” je mają). */
export function vehicleChoices(choice: KindChoice): [VehicleMode, string][] | undefined {
  return choice === 'public' ? PUBLIC_VEHICLES : choice === 'hired' ? HIRED_MODES : undefined;
}

/** Wybrany środek, jeśli pasuje do pozycji listy, inaczej pierwszy z jej listy. */
export function vehicleFor(choice: KindChoice, vehicle: VehicleMode | undefined): VehicleMode | undefined {
  const list = vehicleChoices(choice);
  return list === undefined ? undefined : (list.find(([key]) => key === vehicle) ?? list[0])![0];
}

const footMode = (value: string | undefined): FootMode | undefined => (value === 'hike' || value === 'walk' ? value : undefined);
const isPublic = (value: string | undefined): value is PublicMode => value !== undefined && value in PUBLIC;
const isHired = (value: string | undefined): value is HiredMode => value !== undefined && value in HIRED;
/** Środek z listy „transportu publicznego” (komunikacja albo samolot). */
const isPublicChoice = (value: string | undefined): value is PublicMode | 'flight' => value === 'flight' || isPublic(value);
const flies = (item: Pick<Item, 'kind' | 'leg'>) => item.kind === 'transport' && item.leg?.mode === 'flight';
/** Środki jadące drogą: zmiana między nimi zostawia policzoną trasę. */
const ROAD: ReadonlySet<string> = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);

/** Środek transportu publicznego punktu, jeśli nim jedzie. */
export const publicMode = (item: Pick<Item, 'kind' | 'leg'>): PublicMode | undefined => (item.kind === 'transport' && isPublic(item.leg?.mode) ? item.leg.mode : undefined);

/** Punkt jedzie komunikacją publiczną (autobus, tramwaj, metro, pociąg, prom, kolejka). */
export const isTransitItem = (item: Pick<Item, 'kind' | 'leg'>) => publicMode(item) !== undefined;

/** Taksówka albo transfer z kierowcą, jeśli punkt nim jedzie. */
export const hiredMode = (item: Pick<Item, 'kind' | 'leg'>): HiredMode | undefined => (item.kind === 'transport' && isHired(item.leg?.mode) ? item.leg.mode : undefined);

/** Środek z listy wyboru, którym punkt jedzie (komunikacja albo taksówka / transfer). */
export const vehicleMode = (item: Pick<Item, 'kind' | 'leg'>): VehicleMode | undefined => (flies(item) ? 'flight' : (publicMode(item) ?? hiredMode(item)));

/** Pozycje listy: etykiety rodzajów z aplikacji, a zaraz za przejazdem transport publiczny, taksówka / transfer, trekking i pieszo. */
export function kindChoices(labels: Record<string, string>): [KindChoice, string][] {
  return Object.entries(labels).flatMap(([key, name]): [KindChoice, string][] =>
    key === 'transport'
      ? [[key, name], ['public', 'transport publiczny'], ['hired', 'taksówka / transfer'], ['hike', FOOT.hike], ['walk', FOOT.walk]]
      : [[key as KindChoice, name]],
  );
}

/** Pozycja listy, którą punkt ma teraz. */
export function kindChoice(item: Pick<Item, 'kind' | 'leg'>): KindChoice {
  if (publicMode(item) !== undefined || flies(item)) return 'public';
  if (hiredMode(item) !== undefined) return 'hired';
  return (item.kind === 'transport' ? footMode(item.leg?.mode) : undefined) ?? item.kind;
}

/** Nazwa rodzaju do pokazania przy punkcie. */
export function itemKindLabel(item: Pick<Item, 'kind' | 'leg'>, labels: Record<string, string>): string | undefined {
  const vehicle = publicMode(item);
  if (vehicle !== undefined) return PUBLIC[vehicle];
  if (flies(item)) return FLIGHT;
  const hired = hiredMode(item);
  if (hired !== undefined) return hired === 'taxi' ? HIRED.taxi : 'transfer';
  const foot = item.kind === 'transport' ? footMode(item.leg?.mode) : undefined;
  return foot === undefined ? labels[item.kind] : FOOT[foot];
}

/**
 * Rodzaj i szczegóły przejazdu po wyborze z listy. Szczegóły przejazdu istnieją tylko przy punkcie `transport`.
 * `vehicle` to środek wybrany przy „transporcie publicznym” albo „taksówce / transferze”; bez niego (albo spoza tej
 * listy) zostaje dotychczasowy albo pierwszy z listy (autobus, taksówka).
 */
export function kindPatch(item: Pick<Item, 'kind' | 'leg'> | null, choice: KindChoice, vehicle?: VehicleMode): { kind: Item['kind']; leg: Leg | undefined } {
  const foot = footMode(choice);
  if (foot === undefined && choice !== 'transport' && choice !== 'public' && choice !== 'hired') return { kind: choice as Item['kind'], leg: undefined };
  const current = item?.kind === 'transport' ? item.leg : undefined;
  // „Przejazd” bez szczegółów albo z trekkingu, przejścia pieszo, transportu publicznego (z samolotem) i taksówki: domyślnie auto.
  const other = current === undefined || footMode(current.mode) !== undefined || isPublicChoice(current.mode) || isHired(current.mode) ? 'car' : current.mode;
  const mode =
    foot ??
    (choice === 'public'
      ? isPublicChoice(vehicle) ? vehicle : isPublicChoice(current?.mode) ? current!.mode as PublicMode | 'flight' : DEFAULT_PUBLIC
      : choice === 'hired'
        ? isHired(vehicle) ? vehicle : isHired(current?.mode) ? current!.mode as HiredMode : DEFAULT_HIRED
        : other);
  if (current === undefined) return { kind: 'transport', leg: { mode, links: [] } };
  if (current.mode === mode) return { kind: 'transport', leg: current };
  // Ta sama droga autem (auto ↔ taksówka ↔ transfer): trasa zostaje, zmienia się tylko środek.
  if (ROAD.has(current.mode) && ROAD.has(mode)) return { kind: 'transport', leg: { ...current, mode } };
  // Linia i czas z OpenRouteService dotyczyły poprzedniego środka transportu: zostaje sam szacunek.
  const { routed: _routed, geometry: _geometry, ...rest } = current;
  // Samolot leci po łuku: kilometry i czas drogi z ziemi (auto, pieszo, pociąg) do lotu nie pasują, i odwrotnie.
  if ((mode === 'flight') !== (current.mode === 'flight')) {
    const { distanceKm: _km, durationMin: _min, durationMaxMin: _max, ...ground } = rest;
    return { kind: 'transport', leg: { ...ground, mode } };
  }
  return { kind: 'transport', leg: { ...rest, mode } };
}
