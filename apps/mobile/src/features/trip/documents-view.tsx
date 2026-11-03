import { codeCanvas, codeLabel, type CodeRaster, codeSymbol, formatBytes, isLinearCode, vaultDocument, type VaultDocument } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import * as bwip from 'bwip-js/generic';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { requireOptionalNativeModule } from 'expo';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, PixelRatio, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * Sejf na telefonie: dokumenty wyjazdu (bilety, vouchery) przy rezerwacjach, kod do pokazania
 * przy bramce i plik — offline. Lista z planu w SQLite (wiersze `documents`, które RLS pozwala
 * zobaczyć), pliki „offline” pobrane do katalogu aplikacji przy synchronizacji z internetem
 * (po sha256 wiadomo, że są aktualne). Kod rysowany natywnie z treści — działa bez pliku i sieci.
 */

const BUCKET = 'documents';

/**
 * Ekran bez gaśnięcia przy kodzie. Moduł natywny brany opcjonalnie, nie przez import
 * `expo-keep-awake` (ten rzuca przy braku modułu): gdyby zainstalowany APK go nie miał,
 * kod nadal się pokaże, tylko ekran może zgasnąć.
 */
const KeepAwake = requireOptionalNativeModule<{ activate?: (tag: string) => Promise<void>; deactivate?: (tag: string) => Promise<void> }>('ExpoKeepAwake');
const AWAKE_TAG = 'sejf-kod';
const BLACK = '#000000';

/** Plik dokumentu w katalogu aplikacji: `vault/<wyjazd>/<dokument>-<sha>.<rozszerzenie>`. */
function localFile(tripId: string, document: VaultDocument): File {
  const extension = document.storagePath.includes('.') ? document.storagePath.slice(document.storagePath.lastIndexOf('.')) : '';
  return new File(Paths.document, 'vault', tripId, `${document.id}-${(document.sha256 ?? 'x').slice(0, 12)}${extension}`);
}

/**
 * Pobiera brakujące pliki „offline” (krótki podpisany URL z bucketu) i kasuje te, których już
 * nie ma w planie albo zmieniły się (inny sha). Błąd jednego pliku nie zatrzymuje reszty.
 */
export async function syncVaultFiles(tripId: string, documents: VaultDocument[]): Promise<{ downloaded: number; failed: number }> {
  const folder = new Directory(Paths.document, 'vault', tripId);
  if (!folder.exists) folder.create({ intermediates: true });
  const wanted = new Set(documents.filter((each) => each.offline).map((each) => localFile(tripId, each).name));
  for (const entry of folder.list()) if (entry instanceof File && !wanted.has(entry.name)) entry.delete();
  let downloaded = 0;
  let failed = 0;
  for (const document of documents.filter((each) => each.offline)) {
    const target = localFile(tripId, document);
    if (target.exists) continue;
    try {
      const { data, error } = await supabase!.storage.from(BUCKET).createSignedUrl(document.storagePath, 300);
      if (error || !data) throw error ?? new Error('brak adresu');
      await File.downloadFileAsync(data.signedUrl, target);
      downloaded++;
    } catch {
      failed++;
    }
  }
  return { downloaded, failed };
}

/**
 * `only` — tylko dokumenty jednego punktu albo jego rezerwacji (karta punktu); wtedy bez pobierania
 * plików w tle (robi to pełny sejf w Info — z wycinkiem listy skasowałby pliki innych dokumentów).
 */
/** Ile dokumentów „offline” ma już kopię na telefonie (aktualną — po sha256). */
export function savedVaultFiles(tripId: string, documents: VaultDocument[]): number {
  return documents.filter((each) => each.offline && localFile(tripId, each).exists).length;
}

export function DocumentsView({ trip, tripId, online, only }: { trip: CachedTrip; tripId: string; online: boolean; only?: { itemId?: string; bookingId?: string } }) {
  const theme = useTheme();
  const all = useMemo(() => trip.live.documents.map((row) => vaultDocument(row)).filter((each): each is VaultDocument => each !== null), [trip.live.documents]);
  const documents = useMemo(
    () =>
      only === undefined
        ? all
        : all.filter((each) => (only.itemId !== undefined && each.itemId === only.itemId) || (only.bookingId !== undefined && each.bookingId === only.bookingId)),
    [all, only?.itemId, only?.bookingId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [shown, setShown] = useState<{ title: string; payload: string; format: string | null; plain?: boolean } | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState(0);


  // Pliki „offline” dociągają się, gdy jest internet; stan zmienia się dopiero po pobraniu.
  useEffect(() => {
    if (only !== undefined || !online || supabase === null || documents.length === 0) return;
    let cancelled = false;
    void syncVaultFiles(tripId, documents).then((result) => {
      if (cancelled) return;
      setStatus(result.failed > 0 ? `Nie pobrano ${result.failed} — spróbuję przy następnej synchronizacji.` : result.downloaded > 0 ? `Pobrano ${result.downloaded} na telefon.` : '');
      setVersion((current) => current + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [online, tripId, documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const codes = trip.state.doc.bookings.filter(
    (booking) =>
      booking.confirmationCode &&
      booking.status !== 'candidate' &&
      booking.status !== 'idea' &&
      booking.status !== 'cancelled' &&
      (only === undefined || (only.bookingId !== undefined && trip.ids[booking.ref] === only.bookingId)),
  );
  if (documents.length === 0 && codes.length === 0) return null;

  const open = async (document: VaultDocument) => {
    const file = localFile(tripId, document);
    if (!file.exists) {
      if (!online || supabase === null) return Alert.alert('Plik nie jest na telefonie', document.offline ? 'Pobierze się przy następnym połączeniu z internetem.' : 'Ten dokument jest tylko z internetem (bez „offline” na webie).');
      try {
        const { data, error } = await supabase!.storage.from(BUCKET).createSignedUrl(document.storagePath, 300);
        if (error || !data) throw error ?? new Error('brak adresu');
        await File.downloadFileAsync(data.signedUrl, file);
        setVersion((current) => current + 1);
      } catch (e) {
        return Alert.alert('Nie udało się pobrać pliku', e instanceof Error ? e.message : String(e));
      }
    }
    if (document.mime?.startsWith('image/')) return setImage(file.uri);
    // PDF: systemowa przeglądarka plików („Otwórz w…”).
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: document.mime ?? 'application/pdf', dialogTitle: document.fileName });
  };

  // Dokumenty pogrupowane po rezerwacjach (dokument wskazuje id wiersza, plan trzyma `ref`); reszta osobno.
  const bookingIds = new Set(trip.state.doc.bookings.map((booking) => trip.ids[booking.ref]).filter(Boolean));
  const groups = [
    ...trip.state.doc.bookings.map((booking) => ({
      key: booking.ref,
      title: booking.title,
      code: codes.includes(booking) ? (booking.confirmationCode ?? null) : null,
      docs: documents.filter((each) => each.bookingId !== null && each.bookingId === trip.ids[booking.ref]),
    })),
    { key: 'other', title: 'Inne dokumenty', code: null, docs: documents.filter((each) => each.bookingId === null || !bookingIds.has(each.bookingId)) },
  ].filter((group) => group.docs.length > 0 || group.code !== null);

  return (
    <View style={styles.section} key={version}>
      <ThemedText type={only === undefined ? 'subtitle' : 'smallBold'}>Dokumenty i kody</ThemedText>
      {status !== '' && (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      )}
      {groups.map((group) => (
        <View key={group.key} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{group.title}</ThemedText>
          {group.code && <Button label={`Kod rezerwacji: ${group.code}`} small onPress={() => setShown({ title: group.title, payload: group.code!, format: null, plain: true })} />}
          {group.docs.map((document) => {
            const saved = localFile(tripId, document).exists;
            return (
              <View key={document.id} style={styles.document}>
                <ThemedText type="small">{document.fileName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {[formatBytes(document.size), saved ? 'na telefonie' : document.offline ? 'pobierze się z internetem' : 'tylko z internetem'].filter(Boolean).join(' · ')}
                </ThemedText>
                <View style={styles.row}>
                  {document.codePayload && <Button label={`Pokaż ${codeLabel(document.codeFormat)}`} variant="primary" onPress={() => setShown({ title: document.fileName, payload: document.codePayload!, format: document.codeFormat })} />}
                  <Button label="Plik" small onPress={() => void open(document)} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
      {shown && <CodeScreen {...shown} onClose={() => setShown(null)} />}
      <Modal visible={image !== null} onRequestClose={() => setImage(null)} animationType="fade">
        <SafeAreaView style={styles.dark}>
          {image && <Image source={{ uri: image }} style={styles.fill} contentFit="contain" />}
          <Pressable onPress={() => setImage(null)} style={styles.closeDark} hitSlop={12}>
            <ThemedText style={styles.closeText}>Zamknij</ThemedText>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/**
 * Kod na całym ekranie: czarne moduły na białym, ekran nie gaśnie. Rysowany z treści kodu
 * (bwip-js, czysty JS) jako paski widoków — bez sieci, bez pliku i bez modułów natywnych.
 */
function CodeScreen({ title, payload, format, plain, onClose }: { title: string; payload: string; format: string | null; plain?: boolean; onClose: () => void }) {
  useEffect(() => {
    void KeepAwake?.activate?.(AWAKE_TAG).catch(() => undefined);
    return () => void KeepAwake?.deactivate?.(AWAKE_TAG).catch(() => undefined);
  }, []);
  return (
    <Modal visible onRequestClose={onClose} animationType="fade">
      <SafeAreaView style={styles.white}>
        <ScrollView contentContainerStyle={styles.codeBody}>
          <ThemedText style={styles.codeTitle}>{title}</ThemedText>
          {plain ? <ThemedText style={styles.plainCode}>{payload}</ThemedText> : <CodeMatrix payload={payload} format={format} />}
          {!plain && <ThemedText style={styles.payload}>{payload}</ThemedText>}
          <Pressable onPress={onClose} style={styles.close} hitSlop={12}>
            <ThemedText style={styles.closeLight}>Zamknij</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Kod jako raster: bwip-js rysuje do kontekstu z core (`codeCanvas`), bez SVG i modułów natywnych. */
function raster(payload: string, format: string | null): CodeRaster {
  const canvas = codeCanvas();
  bwip.render({ bcid: codeSymbol(format), text: payload, scale: 1, paddingwidth: 0, paddingheight: 0, ...(isLinearCode(format) ? { height: 12 } : {}) }, canvas.context as never);
  return canvas.result();
}

function CodeMatrix({ payload, format }: { payload: string; format: string | null }) {
  const { width: screen } = useWindowDimensions();
  const result = useMemo(() => {
    try {
      return { ok: raster(payload, format) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [payload, format]);
  if ('error' in result) return <ThemedText style={styles.payload}>Nie da się narysować kodu ({result.error}) — pokaż plik.</ThemedText>;
  const code = result.ok;
  // Piksel kodu w pełnych pikselach ekranu (inaczej między modułami widać szwy); strefa ciszy wokół.
  const quiet = isLinearCode(format) ? 10 : 8;
  const unit = Math.max(1, Math.floor(PixelRatio.getPixelSizeForLayoutSize(screen - 2 * Spacing.four) / (code.width + 2 * quiet))) / PixelRatio.get();
  // Kod kreskowy wyższy niż z biblioteki — łatwiej go złapać czytnikiem.
  const tall = isLinearCode(format) ? Math.max(1, Math.round((code.width * 0.35) / code.height)) : 1;
  return (
    <View style={{ padding: unit * quiet, backgroundColor: '#FFFFFF' }}>
      <View style={{ width: unit * code.width, height: unit * code.height * tall }}>
        {code.rows.map((runs, y) =>
          runs.map(([start, length]) => (
            <View key={`${y}:${start}`} style={{ position: 'absolute', top: y * unit * tall, left: start * unit, width: length * unit, height: unit * tall, backgroundColor: BLACK }} />
          )),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  document: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
  white: { flex: 1, backgroundColor: '#FFFFFF' },
  codeBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  codeTitle: { color: BLACK, fontSize: 16, lineHeight: 22, fontWeight: 700, textAlign: 'center' },
  plainCode: { color: BLACK, fontSize: 40, lineHeight: 48, fontWeight: 800, letterSpacing: 4, textAlign: 'center' },
  payload: { color: '#444444', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  close: { borderWidth: 1, borderColor: '#CCCCCC', borderRadius: 20, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  closeLight: { color: BLACK },
  dark: { flex: 1, backgroundColor: BLACK },
  fill: { flex: 1 },
  closeDark: { position: 'absolute', top: Spacing.four, right: Spacing.four, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  closeText: { color: '#FFFFFF' },
});
