import {
  addEatOutChoices,
  cuisineOptions,
  DEFAULT_EATERY_FILTER,
  EATERY_KINDS,
  type EateryFilter,
  type EateryResult,
  type EatOutEdit,
  filterEateries,
  formatDistance,
  googleMapsSearchUrl,
  type PlanItem as Item,
} from '@expeditionplan/core';
import { type CachedTrip, uuidv7 } from '@expeditionplan/sync';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type EateryAnswer, type EateryDiet, type EateryKind, findEateriesNearby } from '@/lib/web-api';

/**
 * „Knajpy w pobliżu” przy posiłku (z siecią): wyszukiwanie przez Planner Hub (`/api/eateries`,
 * Geoapify na kluczu serwera) wokół miejsca posiłku z planu albo — po „Wokół mnie” — wokół
 * telefonu. Pozycja idzie na serwer tylko wtedy, zaokrąglona do ~100 m, i nie jest zapisywana
 * (SPECYFIKACJA §8). Wybrane knajpy zapisuje plan (`addEatOutChoices` → `saveElements`): jedna =
 * miejsce posiłku, kilka = „gdzie jemy?” do wyboru chipami nad dniem, także offline. Kolejna knajpa dołącza do wyboru.
 * Filtry (zamknięte, sieciówki, kuchnia, tylko polecane) jak na webie (`filterEateries`); „Opinie” otwiera Mapy Google.
 */

const RADII = [500, 1000, 2000, 5000];
const DIETS: [EateryDiet | '', string][] = [
  ['', 'bez filtra'],
  ['vegetarian', 'wege'],
  ['vegan', 'wegańskie'],
  ['gluten_free', 'bez glutenu'],
  ['halal', 'halal'],
];
const OPEN = {
  open: { label: '✓ otwarte w porze posiłku', color: 'accent' },
  partly: { label: '◐ otwarte tylko część posiłku', color: 'primary' },
  closed: { label: '✕ zamknięte w porze posiłku', color: 'textSecondary' },
  unknown: { label: 'godziny nieznane', color: 'textSecondary' },
} as const;

/** Tyle wyników naraz, reszta po „Pokaż więcej”. */
const PAGE = 15;

/** ≈ 100 m — wystarczy do knajp w promieniu, a nie mówi dokładnie, gdzie jesteś. */
const round = (value: number) => Math.round(value * 1000) / 1000;

type Props = {
  trip: CachedTrip;
  tripId: string;
  item: Item;
  /** Zapis wybranych w planie; bez — sama lista (brak prawa edycji). */
  onSave?: (edit: EatOutEdit) => Promise<void>;
};

export function EateriesCard({ trip, tripId, item, onSave }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<EateryKind[]>(['restaurant', 'fast_food', 'hut']);
  const [radiusM, setRadiusM] = useState(1000);
  const [diet, setDiet] = useState<EateryDiet | ''>('');
  const [answer, setAnswer] = useState<EateryAnswer | null>(null);
  const [picked, setPicked] = useState<Set<EateryResult>>(new Set());
  const [filter, setFilter] = useState<EateryFilter>(DEFAULT_EATERY_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<'search' | 'locate' | 'save' | null>(null);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');

  if (!open) return <Button small label="🍽 Knajpy w pobliżu" onPress={() => setOpen(true)} />;

  const search = async (aroundMe: boolean) => {
    setBusy(aroundMe ? 'locate' : 'search');
    setProblem('');
    setSaved('');
    setPicked(new Set());
    setLimit(PAGE);
    setFilter((current) => ({ ...current, cuisines: [] }));
    try {
      let position: { lat: number; lng: number } | undefined;
      if (aroundMe) {
        if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Brak zgody na lokalizację — szukam przy posiłku z planu.');
        const here = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        position = { lat: round(here.coords.latitude), lng: round(here.coords.longitude) };
      }
      setBusy('search');
      setAnswer(await findEateriesNearby({ tripId, itemRef: item.ref, kinds, radiusM, ...(diet ? { diet } : {}), ...(position ? { position } : {}) }));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (answer === null || onSave === undefined) return;
    const picks = answer.results.filter((result) => picked.has(result));
    const edit = addEatOutChoices(trip.state.doc, item.ref, picks.map((result) => ({ eatery: result, summary: result.summary })), () => `id-${uuidv7()}`);
    if (edit === null) return;
    setBusy('save');
    setProblem('');
    try {
      await onSave(edit);
      setPicked(new Set());
      setSaved(`Przypięto i zapisano: ${picks.map((each) => each.name).join(', ')}.`);
    } catch (e) {
      setProblem(`Nie zapisano: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleKind = (kind: EateryKind) => setKinds((current) => (current.includes(kind) ? current.filter((each) => each !== kind) : [...current, kind]));
  const togglePick = (result: EateryResult) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(result)) next.delete(result);
      else next.add(result);
      return next;
    });
  const results = answer?.results ?? [];
  const shown = filterEateries(results, filter);
  const cuisines = cuisineOptions(results).slice(0, 8);
  const flip = (key: 'hideClosed' | 'noChains' | 'onlyRecommended') => setFilter((current) => ({ ...current, [key]: !current[key] }));

  return (
    <View style={[styles.box, { borderColor: theme.backgroundSelected }]}>
      <View style={styles.row}>
        <ThemedText type="smallBold" themeColor="accent" style={styles.grow}>
          KNAJPY W POBLIŻU
        </ThemedText>
        <Pressable onPress={() => setOpen(false)} hitSlop={10}>
          <ThemedText type="small" themeColor="textSecondary">
            Zwiń
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.wrap}>
        {(Object.keys(EATERY_KINDS) as EateryKind[]).map((kind) => (
          <Chip key={kind} compact active={kinds.includes(kind)} label={EATERY_KINDS[kind]} onPress={() => toggleKind(kind)} />
        ))}
      </View>
      <View style={styles.wrap}>
        {RADII.map((radius) => (
          <Chip key={radius} compact active={radiusM === radius} label={formatDistance(radius)} onPress={() => setRadiusM(radius)} />
        ))}
      </View>
      <View style={styles.wrap}>
        {DIETS.map(([value, label]) => (
          <Chip key={label} compact active={diet === value} label={label} onPress={() => setDiet(value)} />
        ))}
      </View>
      <View style={styles.row}>
        <Button small variant="primary" label={busy === 'search' ? 'Szukam…' : 'Szukaj przy posiłku'} disabled={busy !== null} onPress={() => void search(false)} />
        <Button small label={busy === 'locate' ? 'Ustalam pozycję…' : '📍 Wokół mnie'} disabled={busy !== null} onPress={() => void search(true)} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        „Wokół mnie” wysyła serwerowi pozycję zaokrągloną do ok. 100 m — tylko do tego wyszukiwania, bez zapisu.
      </ThemedText>
      {problem !== '' && (
        <ThemedText type="small" style={styles.problem}>
          {problem}
        </ThemedText>
      )}
      {saved !== '' && (
        <ThemedText type="small" themeColor="accent">
          {saved}
        </ThemedText>
      )}

      {answer !== null && (
        <View style={styles.list}>
          <ThemedText type="small" themeColor="textSecondary">
            {results.length === 0
              ? `Nic w promieniu ${formatDistance(radiusM)} od: ${answer.center.near}.`
              : `${answer.route ? `Po drodze: ${answer.route.from} → ${answer.route.to}` : `Wokół: ${answer.center.near}`} · ${shown.length} z ${results.length} po filtrach`}
          </ThemedText>
          {results.length > 0 && (
            <View style={styles.wrap}>
              <Chip compact active={filter.hideClosed} label="bez zamkniętych" onPress={() => flip('hideClosed')} />
              <Chip compact active={filter.noChains} label="bez sieciówek" onPress={() => flip('noChains')} />
              <Chip compact active={filter.onlyRecommended} label="tylko polecane" onPress={() => flip('onlyRecommended')} />
            </View>
          )}
          {cuisines.length > 1 && (
            <View style={styles.wrap}>
              {cuisines.map((each) => (
                <Chip key={each.key} compact active={filter.cuisines.includes(each.key)} label={`${each.label} (${each.count})`} onPress={() => setFilter((current) => ({ ...current, cuisines: current.cuisines.includes(each.key) ? current.cuisines.filter((key) => key !== each.key) : [...current.cuisines, each.key] }))} />
              ))}
            </View>
          )}
          {shown.slice(0, limit).map((result) => {
            const chosen = picked.has(result);
            const status = OPEN[result.open.state];
            return (
              <Pressable
                key={`${result.name}-${result.lat}-${result.lng}`}
                disabled={onSave === undefined}
                onPress={() => togglePick(result)}
                style={[styles.result, { borderColor: chosen ? theme.accent : theme.backgroundSelected }]}>
                <View style={styles.row}>
                  <ThemedText type="smallBold" style={styles.grow}>
                    {onSave !== undefined ? (chosen ? '☑ ' : '☐ ') : ''}
                    {result.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDistance(result.distanceM)}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {result.summary}
                  {result.chain ? ' · sieć' : ''}
                </ThemedText>
                {result.memory && (
                  <ThemedText type="small" themeColor="accent">
                    {[result.memory.worth > 0 ? `👍 ${result.memory.worth}` : '', result.memory.notWorth > 0 ? `👎 ${result.memory.notWorth}` : '', ...result.memory.notes].filter(Boolean).join(' · ')}
                  </ThemedText>
                )}
                {result.tip && (result.tip.text || result.tip.price) && (
                  <ThemedText type="small" themeColor="accent">
                    {[result.tip.text ? `„${result.tip.text}”` : '', result.tip.price ? `cena: ${result.tip.price}` : '', result.tip.year ? `wpis z ${result.tip.year}` : ''].filter(Boolean).join(' · ')}
                  </ThemedText>
                )}
                {result.address && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {result.address}
                  </ThemedText>
                )}
                <View style={styles.row}>
                  <ThemedText type="small" themeColor={status.color} style={[styles.grow, result.open.state === 'closed' && styles.problem]}>
                    {status.label}
                  </ThemedText>
                  <Pressable onPress={() => void Linking.openURL(googleMapsSearchUrl(result))} hitSlop={8}>
                    <ThemedText type="linkPrimary">Mapa i opinie</ThemedText>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
          {shown.length > limit && <Button small label={`Pokaż więcej (${shown.length - limit})`} onPress={() => setLimit((current) => current + PAGE)} />}
          {results.length > 0 && shown.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              Filtry odsiały wszystko — odznacz któryś.
            </ThemedText>
          )}
          {onSave !== undefined && picked.size > 0 && (
            <Button
              variant="primary"
              label={busy === 'save' ? 'Zapisuję…' : 'Przypnij i zapisz'}
              disabled={busy !== null}
              onPress={() => void save()}
            />
          )}
          <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
            © OpenStreetMap · Powered by Geoapify
            {answer.tipSources.length > 0 ? ` · Polecenia: ${answer.tipSources.map((source) => `Wikivoyage: ${source.title}`).join(', ')} (CC BY-SA 4.0)` : ''}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  list: { gap: Spacing.two },
  result: { gap: 2, borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.two },
  credit: { fontSize: 11 },
  problem: { color: '#d32f2f' },
});
