import { Camera, type CameraRef, Map as MapView, OfflineManager, type StyleSpecification, UserLocation } from '@maplibre/maplibre-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { REGIONS, type Region } from '@/poc/data';
import { appendLog } from '@/poc/log';
import { maxZoomWithin, OPENFREEMAP_STYLE, pmtilesStyle, tileCount } from '@/poc/map-styles';

/**
 * PoC-2 — mapa offline (PLAN_ETAPOWY.md). Trzy źródła mapy, pomiar rozmiaru i czasu pobrania;
 * resztę (tryb samolotowy, płynność, pozycja GPS, polskie napisy bez sieci) sprawdza się ręcznie
 * według listy pod mapą, a wynik zapisuje przyciskiem do logu.
 */

type Source = 'online' | 'pack' | 'pmtiles';

const PACK_MIN_ZOOM = 10;
/** Warunki OpenFreeMap dla paczek offline: najwyżej 3000 kafli na pobranie (docs/USLUGI.md). */
const PACK_TILE_LIMIT = 3000;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function MapScreen() {
  const [region, setRegion] = useState<Region>(REGIONS[0]!);
  const [source, setSource] = useState<Source>('online');
  const [pmtilesUri, setPmtilesUri] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const camera = useRef<CameraRef>(null);

  const style: string | StyleSpecification =
    source === 'pmtiles' && pmtilesUri !== null ? pmtilesStyle(pmtilesUri) : OPENFREEMAP_STYLE;

  const chooseRegion = (next: Region) => {
    setRegion(next);
    camera.current?.jumpTo({ center: next.center, zoom: next.zoom });
  };

  const centerOnMe = async () => {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) return setStatus('Brak zgody na lokalizację.');
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    camera.current?.jumpTo({ center: [here.coords.longitude, here.coords.latitude], zoom: 16 });
    setStatus(`Pozycja: dokładność ${Math.round(here.coords.accuracy ?? 0)} m`);
  };

  const downloadPack = async () => {
    const maxZoom = maxZoomWithin(region.bounds, PACK_MIN_ZOOM, PACK_TILE_LIMIT);
    const tiles = tileCount(region.bounds, PACK_MIN_ZOOM, maxZoom);
    const started = Date.now();
    setStatus(`Paczka: ${tiles} kafli, zoom ${PACK_MIN_ZOOM}–${maxZoom}…`);
    OfflineManager.setTileCountLimit(PACK_TILE_LIMIT);
    await OfflineManager.createPack(
      { mapStyle: OPENFREEMAP_STYLE, bounds: region.bounds, minZoom: PACK_MIN_ZOOM, maxZoom, metadata: { name: region.id } },
      (_pack, progress) => {
        const seconds = Math.round((Date.now() - started) / 1000);
        setStatus(`Paczka ${region.name}: ${Math.round(progress.percentage)}%, ${progress.completedTileCount} kafli, ${mb(progress.completedResourceSize)}, ${seconds} s`);
        if (progress.state === 'complete') {
          void appendLog({ type: 'map', variant: 'pack', region: region.id, maxZoom, tiles: progress.completedTileCount, bytes: progress.completedResourceSize, seconds });
          setSource('pack');
        }
      },
      (_pack, error) => setStatus(`Błąd paczki: ${error.message}`),
    );
  };

  /** Plik `.pmtiles` regionu zostaje w katalogu dokumentów — mapa otwiera go jako `pmtiles://file://…`. */
  const keepFile = async (picked: File, name: string) => {
    const dir = new Directory(Paths.document, 'regions');
    dir.create({ idempotent: true, intermediates: true });
    const target = new File(dir, name);
    if (target.exists) target.delete();
    picked.copy(target);
    setPmtilesUri(target.uri);
    setSource('pmtiles');
    return target;
  };

  const pickPmtiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0]!;
    const target = await keepFile(new File(asset.uri), asset.name.endsWith('.pmtiles') ? asset.name : `${region.id}.pmtiles`);
    setStatus(`PMTiles z pliku: ${asset.name}, ${mb(target.size)}`);
    void appendLog({ type: 'map', variant: 'pmtiles-file', region: region.id, name: asset.name, bytes: target.size });
  };

  const downloadPmtiles = async () => {
    const dir = new Directory(Paths.document, 'regions');
    dir.create({ idempotent: true, intermediates: true });
    const target = new File(dir, `${region.id}.pmtiles`);
    if (target.exists) target.delete();
    const started = Date.now();
    const task = File.createDownloadTask(url.trim(), target, {
      onProgress: ({ bytesWritten, totalBytes }) =>
        setStatus(`PMTiles: ${mb(bytesWritten)}${totalBytes > 0 ? ` / ${mb(totalBytes)}` : ''}, ${Math.round((Date.now() - started) / 1000)} s`),
    });
    const file = await task.downloadAsync();
    if (file === null) return;
    const seconds = Math.round((Date.now() - started) / 1000);
    setPmtilesUri(file.uri);
    setSource('pmtiles');
    setStatus(`PMTiles pobrany: ${mb(file.size)} w ${seconds} s`);
    void appendLog({ type: 'map', variant: 'pmtiles-download', region: region.id, bytes: file.size, seconds });
  };

  const note = async (check: string, ok: boolean) => {
    const position = await Location.getLastKnownPositionAsync().catch(() => null);
    await appendLog({ type: 'map-check', source, region: region.id, check, ok, accuracy: position?.coords.accuracy ?? null });
    setStatus(`Zapisano: ${check} — ${ok ? 'tak' : 'nie'}`);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.map}>
          <MapView mapStyle={style} androidView="surface">
            <Camera ref={camera} initialViewState={{ center: region.center, zoom: region.zoom }} />
            <UserLocation accuracy />
          </MapView>
        </View>
        <ScrollView style={styles.controls} contentContainerStyle={styles.panel}>
          <ThemedText type="small">{status || 'Wybierz region i źródło mapy.'}</ThemedText>
          <Row>
            {REGIONS.map((each) => (
              <Button key={each.id} label={each.name} active={each.id === region.id} onPress={() => chooseRegion(each)} />
            ))}
            <Button label="Do mnie" onPress={centerOnMe} />
          </Row>
          <Row>
            <Button label="Online" active={source === 'online'} onPress={() => setSource('online')} />
            <Button label="Pobierz paczkę (OpenFreeMap)" onPress={downloadPack} />
            <Button label="PMTiles z pliku" active={source === 'pmtiles'} onPress={pickPmtiles} />
          </Row>
          <Row>
            <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder="Adres pliku .pmtiles" autoCapitalize="none" />
            <Button label="Pobierz" onPress={downloadPmtiles} />
          </Row>
          <ThemedText type="small">W trybie samolotowym sprawdź i zapisz:</ThemedText>
          {['mapa się wyświetla', 'płynne przesuwanie i zoom', 'pozycja GPS na mapie', 'napisy po polsku'].map((check) => (
            <Row key={check}>
              <ThemedText type="small" style={styles.check}>
                {check}
              </ThemedText>
              <Button label="tak" onPress={() => note(check, true)} />
              <Button label="nie" onPress={() => note(check, false)} />
            </Row>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Button({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <AppButton label={label} onPress={onPress} variant={active ? 'accent' : 'secondary'} small />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  // Mapa ok. 2/3 ekranu; bez flex na ScrollView panel zajmuje całą wysokość swojej treści.
  map: { flex: 2 },
  controls: { flex: 1 },
  panel: { padding: Spacing.three, gap: Spacing.two, paddingBottom: BottomTabInset + Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  input: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: '#8888', borderRadius: Spacing.two, padding: Spacing.two, color: '#888' },
  check: { flex: 1 },
});
