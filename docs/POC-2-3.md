# PoC-2 i PoC-3 — instrukcja testu na telefonie

> Dokument historyczny z PoC (stan 31.10.2026). Przyciski i ekrany opisane tu (np. „PMTiles z pliku”) już nie istnieją; aplikacja pobiera mapę przyciskiem „Pobierz mapę wyjazdu” (paczki OpenFreeMap), a werdykty są w `POC_WYNIKI.md`.

Kod jest gotowy w `apps/mobile` (zakładki **Mapa** i **Spacer**). Do zrobienia po Twojej stronie: konto Expo, zbudowanie APK, plik mapy offline i spacer. Wyniki wracają do mnie jako log z aplikacji.

## 1. Zbudowanie aplikacji (jednorazowo, ok. 15–20 min w chmurze)

```bash
npx eas-cli@latest login
```

```bash
cd apps/mobile && npx eas-cli@latest init
```

`init` dopisze `projectId` do `app.json` — ten plik trzeba potem wypchnąć.

```bash
cd apps/mobile && npx eas-cli@latest build --platform android --profile preview
```

Profil `preview` ma kod JS wbudowany w APK — działa w terenie bez komputera i bez Wi-Fi (development build wymagałby serwera Metro na laptopie). Link do APK przyjdzie w terminalu i mailem; zainstaluj go na telefonie (zgoda na instalację z nieznanych źródeł).

## 2. Plik mapy offline (PoC-2, wariant główny)

Mapa offline to plik `.pmtiles` regionu wycięty z dziennego buildu Protomaps (docs/USLUGI.md).

1. Pobierz narzędzie `pmtiles` dla Windows: https://github.com/protomaps/go-pmtiles/releases (plik `go-pmtiles_*_Windows_x86_64.zip`).
2. Sprawdź datę najnowszego buildu na https://maps.protomaps.com/builds/ (np. `20261030`).
3. Wytnij regiony (ramki jak w `apps/mobile/src/poc/data.ts`):

```bash
pmtiles extract https://build.protomaps.com/20261030.pmtiles marrakesz.pmtiles --bbox=-8.05,31.6,-7.96,31.66 --maxzoom=15
```

```bash
pmtiles extract https://build.protomaps.com/20261030.pmtiles bystrzyckie.pmtiles --bbox=16.45,50.2,16.65,50.33 --maxzoom=15
```

4. Skopiuj pliki na telefon (kabel, Dysk Google) i w aplikacji: **Mapa → PMTiles z pliku**. Rozmiar pliku zapisuje się w logu.

Wariant zapasowy bez pliku: **Mapa → Pobierz paczkę (OpenFreeMap)** — aplikacja sama dobiera zoom, żeby zmieścić się w limicie 3000 kafli, i zapisuje rozmiar oraz czas pobrania.

## 3. Test mapy offline (PoC-2)

1. Online: otwórz region raz z siecią w wybranym wariancie (PMTiles albo paczka) — przy okazji zapiszą się w pamięci podręcznej czcionki napisów.
2. Włącz **tryb samolotowy** (GPS zostaje włączony).
3. Pod mapą zaznacz „tak / nie” dla: mapa się wyświetla, płynne przesuwanie i zoom, pozycja GPS na mapie, napisy po polsku.

**Go:** miasto ≤ ok. 150 MB, mapa i pozycja działają w trybie samolotowym.

## 4. Spacer z geofencingiem (PoC-3)

Punkty: 10 miejsc w centrum Wrocławia (Ratusz, św. Elżbieta, Leopoldina, Hala Targowa, Most Tumski, Katedra, Ogród Botaniczny, Panorama, Opera, NFM). W innym mieście: **Dodaj punkt tutaj** w każdym miejscu trasy (najpierw przejdź trasę raz albo dodaj punkty z góry).

Dwa spacery, każdy ok. 1–1,5 h, z naładowanym telefonem:

1. **Geofencing w tle** (promień 100 m): **Spacer → Start: geofencing w tle**, zgoda na lokalizację „Zezwalaj zawsze” i powiadomienia, ekran wygaszony, telefon w kieszeni.
2. **Tryb spaceru** (dokładny GPS, 40 m, stałe powiadomienie): **Start: tryb spaceru**, reszta tak samo.

Przy każdym punkcie naciśnij **Jestem przy punkcie** — to „prawda z terenu”, z której liczy się opóźnienie wykrycia. Na końcu **Stop**, potem **Udostępnij log** i wyślij mi plik (`poc-log.jsonl`).

Mierzę z logu: które wejścia wykryte, opóźnienie wykrycia względem „Jestem przy punkcie”, zużycie baterii na godzinę w obu trybach.

**Uwaga (Xiaomi, Huawei, Samsung):** agresywne oszczędzanie baterii potrafi zabić zadania w tle — jeśli punkty nie są wykrywane, wyłącz optymalizację baterii dla ExpeditionPlan (https://dontkillmyapp.com).
