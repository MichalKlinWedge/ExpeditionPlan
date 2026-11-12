import { formatMinutes, instantToZoned, itemTrackWalk, MINUTE, minutesToKm, type PlanItem, TRACK_POI_TYPE, type TrackPoi, variantsForItem } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { PlanChoice } from '@/features/plan/plan-place';
import { useTheme } from '@/hooks/use-theme';

/**
 * Profil wysokości, odcinki z czasem wg DIN, słońce i woda / schroniska / zejścia przy śladzie
 * (`core/track-profile.ts`, `core/track-pois.ts`) — wszystko z planu, więc offline. Godzina wyjścia
 * z silnika dla scenariusza i wariantów z ekranu planu. Punkty z OpenStreetMap pobiera web.
 */

const BARS = 48;
const POI_ICON: Record<TrackPoi['kind'], string> = { water: '💧', shelter: '🏠', exit: '↘' };
const TREND = { up: '↗', down: '↘', flat: '→' } as const;
const round5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);
const km = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString('pl-PL')} km`;

export function TrackProfileCard({ trip, item, plan }: { trip: CachedTrip; item: PlanItem; plan?: PlanChoice }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const { doc, inputs } = trip.state;
  const walk = itemTrackWalk(doc, item, {
    scenario: plan?.scenario,
    activeVariants: variantsForItem(doc, item, { ...inputs.activeVariants, ...plan?.variants }).variants,
    delays: inputs.delays,
    skipRefs: inputs.skipRefs,
    done: inputs.done,
    pulled: inputs.pulled,
  });
  if (walk === null) return null;
  const { profile, sections, daylight, start, tz } = walk;
  const pois = doc.tracks.find((each) => each.ref === item.activity?.trackRef)?.pois?.items ?? [];
  const clock = (minutes: number) => (start === null || tz === null ? null : instantToZoned(start + minutes * MINUTE, tz).time);
  const total = Math.max(profile.totalKm, 0.1);

  // Słupki: najwyższy punkt w każdym kawałku trasy; słupek z punktem zawrócenia — w kolorze ostrzeżenia.
  const lo = profile.minEle ?? 0;
  const hi = Math.max(profile.maxEle ?? 1, lo + 50);
  const bars = Array.from({ length: BARS }, (_, i) => {
    const from = (i / BARS) * total;
    const to = ((i + 1) / BARS) * total;
    const inside = profile.points.filter((point) => point.km >= from && point.km <= to && point.ele !== null);
    const nearest = inside.length > 0 ? inside : [profile.points.reduce((best, point) => (Math.abs(point.km - from) < Math.abs(best.km - from) ? point : best))];
    const ele = Math.max(...nearest.map((point) => point.ele ?? lo));
    return { from, to, ele };
  });
  const turnBar = daylight?.turnaround ? Math.min(BARS - 1, Math.floor((daylight.turnaround.km / total) * BARS)) : null;
  const poiBars = new Map<number, string>();
  for (const poi of pois) {
    const index = Math.min(BARS - 1, Math.floor((poi.km / total) * BARS));
    if (!poiBars.has(index)) poiBars.set(index, POI_ICON[poi.kind]);
  }
  const shown = picked === null ? null : bars[picked]!;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold" themeColor="accent">
        PROFIL I TRUDNOŚĆ
      </ThemedText>
      {profile.hasElevation && (
        <>
          <View style={styles.icons}>
            {bars.map((_, i) => (
              <ThemedText key={i} style={styles.icon}>
                {poiBars.get(i) ?? ''}
              </ThemedText>
            ))}
          </View>
          <View style={styles.chart} accessibilityLabel={`Profil wysokości: ${lo}–${hi} m n.p.m. na ${km(total)}`}>
            {bars.map((bar, i) => (
              <Pressable
                key={i}
                onPress={() => setPicked(picked === i ? null : i)}
                style={[
                  styles.bar,
                  {
                    height: `${8 + ((bar.ele - lo) / (hi - lo)) * 92}%`,
                    backgroundColor: i === picked ? theme.text : i === turnBar ? theme.primary : theme.accent,
                  },
                ]}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {shown === null
              ? `${lo}–${hi} m n.p.m. · ${km(total)} · stuknij słupek`
              : `${km((shown.from + shown.to) / 2)} · ${Math.round(shown.ele)} m · ${formatMinutes(round5(minutesToKm(sections, (shown.from + shown.to) / 2)))} od startu${clock(minutesToKm(sections, (shown.from + shown.to) / 2)) ? ` (ok. ${clock(minutesToKm(sections, (shown.from + shown.to) / 2))})` : ''}`}
          </ThemedText>
        </>
      )}
      {daylight !== null && (
        <View style={styles.block}>
          <ThemedText type="small">
            Wyjście {daylight.startLocal} · meta ok. {daylight.finishLocal}
            {daylight.sunsetLocal ? ` · zachód ${daylight.sunsetLocal}` : ''}
          </ThemedText>
          {daylight.startsAfterSunset ? (
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              ⚠ Wyjście po zachodzie słońca.
            </ThemedText>
          ) : daylight.marginMin !== null && daylight.marginMin < 0 ? (
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              ⚠ Meta {formatMinutes(-daylight.marginMin)} po zachodzie.
            </ThemedText>
          ) : (
            daylight.marginMin !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                Zapas do zachodu: {formatMinutes(daylight.marginMin)}.
              </ThemedText>
            )
          )}
          {daylight.turnaround && (
            <ThemedText type={daylight.marginMin !== null && daylight.marginMin < 60 ? 'smallBold' : 'small'}>
              Punkt bez powrotu: {km(daylight.turnaround.km)} (ok. {daylight.turnaround.atLocal}). Jeśli nie jesteście tam o tej godzinie — zawróćcie albo idźcie do mety lub zejścia.
            </ThemedText>
          )}
        </View>
      )}
      <View style={styles.block}>
        {sections.map((section) => (
          <ThemedText key={section.fromKm} type="small">
            {TREND[section.trend]} {(Math.round(section.fromKm * 10) / 10).toLocaleString('pl-PL')}–{km(section.toKm)} · ↑{section.ascentM} ↓{section.descentM} m · {formatMinutes(round5(section.minutes))}
            {clock(section.endMin) ? ` · do ${clock(section.endMin)}` : ''}
          </ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Czas wg DIN 33466{Math.abs(walk.pace - 1) >= 0.05 ? ', w tempie z planu' : ''}, bez postojów.
        </ThemedText>
      </View>
      {pois.length > 0 && (
        <View style={styles.block}>
          <ThemedText type="smallBold">Woda, schroniska, zejścia</ThemedText>
          {pois.map((poi) => (
            <Pressable key={poi.osmId} onPress={() => void Linking.openURL(`geo:${poi.lat},${poi.lng}?q=${poi.lat},${poi.lng}(${encodeURIComponent(poi.name ?? TRACK_POI_TYPE[poi.type] ?? poi.type)})`)}>
              <ThemedText type="small">
                {km(poi.km)} {POI_ICON[poi.kind]} {TRACK_POI_TYPE[poi.type] ?? poi.type}
                {poi.name ? ` ${poi.name}` : ''}
                {poi.potable === false ? ' · niepitna' : ''}
                {poi.offM >= 50 ? ` · ${poi.offM} m od śladu` : ''}
              </ThemedText>
            </Pressable>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Stuknij, by otworzyć w mapie offline. Dane © OpenStreetMap (ODbL).
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  icons: { flexDirection: 'row', height: 16 },
  icon: { flex: 1, fontSize: 9, lineHeight: 14, textAlign: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 1 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  block: { gap: Spacing.half, marginTop: Spacing.one },
});
