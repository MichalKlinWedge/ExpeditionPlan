# Usługi zewnętrzne — warunki i limity (stan na 30.10.2026)

Weryfikacja na podstawie oficjalnych stron (cenniki, regulaminy, polityki użycia, dokumentacja) odczytanych 30.10.2026. Każda liczba ma źródło. Gdzie strony nie dało się odczytać albo strona nie podaje danej wprost, wpis jest oznaczony **NIEPOTWIERDZONE**. Parafrazy regulaminów nie są poradą prawną.

Kontekst projektu przyjęty do werdyktów: D1 = „ja + znajomi”, APK spoza Google Play, bez przychodów (użycie niekomercyjne). Rachunek Google Maps Platform zakładany z adresem w EOG (Polska). Jeśli projekt stanie się komercyjny albo trafi do Google Play, werdykty oznaczone „OK z warunkiem” trzeba przejrzeć ponownie.

## Tabela zbiorcza

| Usługa | Do czego | Darmowy limit | Kluczowy warunek | Werdykt dla projektu |
|---|---|---|---|---|
| Supabase Free | baza, auth, pliki, Edge Functions | 500 MB DB, 1 GB Storage, 5 GB egress (+5 GB z cache), 500 tys. wywołań funkcji, 200 połączeń Realtime / 2 mln wiadomości, 50 tys. MAU, 2 projekty | pauza po **7 dniach** bezczynności; wbudowany SMTP: 2 maile/h i tylko do członków zespołu | OK z warunkiem (Pro 25 USD/mies. przed realnym wyjazdem) |
| Supabase Pro | produkcja | 25 USD/mies.: 8 GB dysku, 100 GB Storage, 250 GB egress, 100 tys. MAU, 2 mln wywołań funkcji, 500 połączeń / 5 mln wiadomości, 10 USD kredytu compute | brak pauzy; Edge Function do 400 s wall clock | OK |
| OpenFreeMap | kafle web + offline | bez limitu wyświetleń, bez klucza | pobieranie offline ≤ 3000 kafli lub 50 MB na jedno pobranie, ≤ 4 równoległe żądania, własny User-Agent | OK z warunkiem (paczki małe; większe → PMTiles) |
| Protomaps (PMTiles, self-hosting) | kafle offline na własnym CDN | dane do pobrania; hosting własny | dane = ODbL Produced Work (atrybucja OSM); kod BSD-3, style CC0; hostowane API Protomaps darmowe tylko niekomercyjnie | **OK — rekomendowane do offline** |
| MapTiler Cloud Free | kafle web | 100 tys. żądań API, 5 tys. sesji / mies. | Free tylko niekomercyjnie; zakaz bulk download (§6.3); cache tylko tymczasowy per użytkownik (§5.7) | NIE dla offline; OK z warunkiem dla web |
| Stadia Maps Free | kafle web | 200 tys. kredytów / mies. | Free tylko niekomercyjnie; offline w aplikacji mobilnej dozwolony do 100 MB na urządzenie | OK z warunkiem (zapas, nie główne źródło) |
| tile.openstreetmap.org | — | — | pobieranie offline i bulk **zakazane** | NIE |
| MapLibre Native / `@maplibre/maplibre-react-native` | mapa na Androidzie | open source | v11.5.1 (29.10.2026), tylko New Architecture, Expo ≥ 54 przez config plugin, nie działa w Expo Go | OK |
| Google Places API | miejsca | — | EOG: poza lat/lng/place_id **nie wolno używać z żadną mapą** (także Google); cache tylko place_id (bez limitu) i lat/lng (30 dni) | NIE (poza Places UI Kit, patrz §3) |
| Geoapify Free | geokodowanie, POI, routing | 3000 kredytów/dzień, 5 req/s | atrybucja OSM + Geoapify; wyniki Places API wolno przechowywać | **OK** |
| Nominatim (publiczny) | geokodowanie pojedyncze | max 1 req/s | zakaz autouzupełniania, zakaz bulk, wymagany identyfikujący User-Agent | OK z warunkiem (tylko rzadkie, pojedyncze zapytania) |
| Photon (komoot) | wyszukiwanie | brak liczbowego limitu | „bądź rozsądny”, duży ruch dławiony, brak gwarancji | OK z warunkiem (zapas) |
| Foursquare Places | POI | do 10 tys. wywołań endpointów Pro (sprzeczne dane w cenniku) | atrybucja „Powered by Foursquare”; cache wg Usage Guidelines (NIEPOTWIERDZONE) | NIE (na teraz) |
| OpenRouteService | routing pieszy/auto | 2000 tras/dzień, 40/min; macierz 500/dzień, 40/min | darmowy „dla wszystkich” (częściowo potwierdzone) | OK |
| Geoapify Routing | routing | z puli 3000 kredytów/dzień; trasa = (punkty − 1) kredytów | atrybucja | OK |
| GraphHopper Free | routing | 500 kredytów/dzień, max 5 punktów | tylko niekomercyjnie | OK z warunkiem (zapas) |
| Transitous (MOTIS 2) | komunikacja publiczna | brak twardego limitu (sygnał: ~720 zapytań `/plan` na dobę) | tylko FOSS / niekomercyjnie, projekt powinien być open source, User-Agent z kontaktem, link do źródeł | OK z warunkiem |
| Overpass API (FOSSGIS, overpass-api.de) | linie komunikacji z OSM (relacje `type=route`) | wytyczne: < 10 000 zapytań i < 1 GB na dobę, przy stałym użyciu ok. 100× mniej; liczy się suma wszystkich użytkowników | identyfikujący User-Agent, podpis „© OpenStreetMap” z linkiem „zgłoś błąd”, e-mail operatora na stronie; komercyjnie tylko jako nieistotna część oferty; bez masowego pobierania | OK z warunkiem (zapytanie tylko na kliknięcie) |
| Open-Meteo | pogoda | 600/min, 5000/h, 10 000/dzień, 300 tys./mies. | tylko niekomercyjnie, CC BY 4.0 | OK z warunkiem |
| Frankfurter | kursy walut | brak kwot, limit anty-nadużyciowy | v2 obejmuje MAD i GEL; v1 tylko kursy EBC | **OK (używać v2)** |
| Nager.Date | święta | „brak limitów” | komercyjnie tylko ze sponsoringiem; **Maroko bez świąt islamskich** | OK z warunkiem |
| Resend Free | e-mail (magic link, zaproszenia) | 3000/mies., 100/dzień, 3 domeny | weryfikacja domeny (SPF + DKIM; DMARC zalecany) | OK |
| Google Play — lokalizacja w tle | publikacja w sklepie | — | formularz deklaracji + wideo ≤ 30 s + prominent disclosure; jedna funkcja w tle na aplikację | nie dotyczy MVP (APK); NIE bez przygotowania przy publikacji |
| Android Geofencing | audio przy punkcie | 100 aktywnych geofence na aplikację i użytkownika urządzenia | promień ≥ 100 m (zalecane 100–150 m), opóźnienie ~2–3 min w tle | OK z warunkiem |
| Gemini API (Google AI Studio) | AI: etapy planu, import, audio | darmowy limit per projekt, „best effort”, zmienny bez zapowiedzi (fora: ~20 zapytań/dzień dla 3.8 Flash, ~500 dla Flash-Lite; aktualne liczby tylko w AI Studio → Rate limits) | dane z darmowego limitu idą do ulepszania produktów Google, **ale w EOG/CH/UK obowiązują warunki płatne także dla darmowego limitu**; aplikacja dla użytkowników w EOG **tylko na Paid Services** (projekt z aktywnym rozliczeniem) | OK do testów (darmowy limit); produkcja = rozliczenia w projekcie Google Cloud (patrz §11) |
| Wikipedia / Wikimedia Commons (API) | przewodnik po punkcie: artykuł, zdjęcia | brak kwot; zapytania po kolei, nie równolegle | identyfikujący User-Agent z kontaktem; tekst CC BY-SA 4.0 (opis pochodny z atrybucją i tą licencją), zdjęcia — licencja każdego pliku osobno | OK z warunkiem (atrybucja, patrz §12) |

---

## 1. Supabase

**Krótko:** założenie „pauza po 7 dniach” jest **potwierdzone**. Darmowy plan wystarcza na rozwój, nie na wyjazd. Pro kosztuje 25 USD/mies.

**Plan Free** (cennik):
- Baza: 500 MB na projekt. Storage: 1 GB. Egress: 5 GB bez cache + 5 GB z cache.
- Edge Functions: 500 000 wywołań / mies.
- Realtime: 200 równoczesnych połączeń (szczyt), 2 mln wiadomości / mies.
- MAU: 50 000. Aktywne projekty: 2 (wstrzymane projekty nie liczą się do limitu).
- Brak transformacji obrazów w Storage.
- **Pauza:** cennik podaje, że darmowe projekty są wstrzymywane po 7 dniach bezczynności.
- Przywracanie: dokumentacja aktualizacji podaje, że wstrzymany projekt można przywrócić z Supabase Studio w oknie 1 roku (zrzut ekranu w tej samej dokumentacji pokazuje licznik „90 Days Remaining”, więc długość okna jest niejednoznaczna — **NIEPOTWIERDZONE**, czy 1 rok czy 90 dni). Płatnych projektów nie da się wstrzymać.

**Plan Pro** (od 25 USD/mies.):
- 8 GB dysku na projekt (dalej 0,125 USD/GB), Storage 100 GB (dalej 0,0213 USD/GB).
- Egress 250 GB bez cache (0,09 USD/GB) + 250 GB z cache (0,03 USD/GB).
- 100 000 MAU (dalej 0,00325 USD/MAU), 2 mln wywołań funkcji (dalej 2 USD/mln).
- Realtime: 500 połączeń (dalej 10 USD/1000), 5 mln wiadomości (dalej 2,50 USD/mln).
- 10 USD/mies. kredytu compute = jedna instancja Micro; każdy kolejny projekt płaci pełny koszt compute.

**Edge Functions — limity:**
- Maks. czas działania (wall clock): **150 s na Free, 400 s na planach płatnych**.
- Czas CPU: 2 s na żądanie (bez asynchronicznego I/O).
- Idle timeout żądania: 150 s (potem 504).
- Pamięć: 256 MB. Rozmiar funkcji: 20 MB (bundlowane CLI) / 5 MB (bundlowane po stronie serwera).
- Wniosek dla AI: wywołanie LLM to I/O, więc nie zjada 2 s CPU, ale **idle timeout 150 s obowiązuje także na Pro** — etap AI musi zwrócić odpowiedź (albo strumieniować) w < 150 s. Potwierdza podejście R9 (etapy jako osobne wywołania).

**Wbudowany SMTP Auth:**
- **2 wiadomości na godzinę** (Supabase może to zmienić bez uprzedzenia).
- Wysyłka tylko na adresy członków zespołu organizacji; inne adresy dostają błąd „Email address not authorized”.
- Brak SLA. Po skonfigurowaniu własnego SMTP: początkowo 30 wiadomości/h, do podniesienia w ustawieniach Rate Limits.
- Zalecenia: własny SMTP w produkcji, SPF/DKIM/DMARC, własna domena dla linków auth.

Źródła:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/upgrading
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/auth/auth-smtp

---

## 2. Kafle mapy offline (MapLibre Native na Androidzie)

**Krótko:** tylko dwie drogi są jednoznacznie zgodne z warunkami: (1) **regionalny plik PMTiles z Protomaps na własnym CDN, pobierany w całości na telefon**, (2) **paczki offline MapLibre z OpenFreeMap** do 3000 kafli / 50 MB na pobranie. Stadia dopuszcza offline do 100 MB na urządzenie, ale tylko na planie niekomercyjnym/płatnym. MapTiler Cloud i tile.openstreetmap.org — nie.

### OpenFreeMap
- Publiczna instancja darmowa, bez rejestracji, bez kluczy, bez cookies; brak limitu wyświetleń i żądań.
- Użycie komercyjne: FAQ na stronie głównej odpowiada „tak”. Regulamin (ToS) nie mówi o tym wprost.
- **Offline:** aplikacje mogą pozwalać użytkownikom zapisywać obszary offline, jeśli jedno pobranie to najwyżej **ok. 3000 kafli albo 50 MB**, najwyżej **4 równoległe żądania** i każde pobranie ma **unikalny User-Agent** aplikacji. Większe pobrania — po kontakcie z operatorem. Poza tym automatyczne pobieranie danych jest zabronione.
- Co tydzień udostępniane są pełne pliki planety (Btrfs i MBTiles) — do self-hostingu.
- Brak SLA; usługa może zostać wyłączona bez uprzedzenia.
- Atrybucja: OpenMapTiles + OpenStreetMap (MapLibre wyświetla ją automatycznie); część „OpenFreeMap” opcjonalna.
- Źródła: https://openfreemap.org/ , https://openfreemap.org/tos/

### MapTiler Cloud
- Free: 100 tys. żądań API, 5 tys. sesji map, 1 tys. sesji wyszukiwania / mies.; po wyczerpaniu usługa pauzuje do następnego miesiąca. Logo MapTiler na mapie obowiązkowe na Free. Najtańszy płatny: Flex, 30 USD/mies.
- §1.2: plan Free tylko do celów niebiznesowych (oraz R&D produktu komercyjnego).
- §5.7: wyniki wolno trzymać w **tymczasowym** cache osobistym (przeglądarka/aplikacja), dla jednego użytkownika.
- §6.3: **zakaz masowego (bulk) pobierania kafli** bez pisemnej zgody MapTiler. §6.2: zakaz eksportu treści mapy poza usługę bez umowy. §7.2: zakaz przechowywania treści mapy po stronie serwera.
- Wniosek: paczki offline z MapTiler Cloud — **niedozwolone** bez osobnej umowy. Osobna oferta danych MapTiler do pobrania (MBTiles) — **NIEPOTWIERDZONE** (nie sprawdzano cen i licencji).
- Źródła: https://www.maptiler.com/cloud/pricing/ , https://www.maptiler.com/terms/cloud/

### Protomaps (PMTiles)
- Regionalny wycinek: `pmtiles extract` z `--bbox`, `--region` (GeoJSON) i `--maxzoom` (każdy poziom zoomu ≈ podwaja rozmiar). Źródło musi być „clustered” archiwum, lokalne lub zdalne.
- Licencja danych: mapa bazowa dystrybuowana jako **ODbL Produced Work — wymagana atrybucja OpenStreetMap**.
- Licencje kodu i stylu (plik LICENSE w repo `protomaps/basemaps`): kod BSD-3-Clause; **wygląd stylów CC0**; schemat kafli zaadaptowany z Tilezen (MIT); część ikon z Mapzen (MIT). `go-pmtiles` (CLI): BSD-3-Clause.
- Strona pobierania odradza hotlinkowanie buildów (URL-e mogą się zmieniać) i zaleca skopiowanie pliku na własny storage. Czy buildy dzienne są darmowe do pobrania — strona nie mówi wprost (**NIEPOTWIERDZONE**, ale nie wymagają konta ani klucza).
- Hostowane API Protomaps: „niekomercyjnie za darmo, komercyjnie — GitHub Sponsor”. Self-hosting tego nie wymaga.
- Źródła: https://docs.protomaps.com/basemaps/downloads , https://docs.protomaps.com/pmtiles/cli , https://protomaps.com/ , https://github.com/protomaps/basemaps/blob/main/LICENSE.md

### Stadia Maps
- Free: 200 tys. kredytów / mies., **użycie komercyjne niedozwolone**. Starter: 20 USD/mies. za 1 mln kredytów.
- Regulamin (wersja z 18.03.2026; **nowa wersja wchodzi 9.11.2026** — nie czytano):
  - §8 pkt 5: cache po stronie klienta dozwolony, jeśli zostaje na urządzeniu i nie dłużej niż nagłówki HTTP (lub 7 dni bez nagłówków); cache serwerowy zakazany.
  - §8 pkt 4: bulk download zakazany, **z wyjątkiem cache niewielkiej ilości danych do użytku offline w aplikacji mobilnej — do 100 MB na urządzenie naraz**.
  - §8 pkt 7: trwałe przechowywanie wyników geokodowania tylko na planach Standard/Professional/Enterprise.
  - §13: Free tylko niekomercyjnie / ewaluacja.
- Źródła: https://stadiamaps.com/pricing/ , https://stadiamaps.com/terms-of-service/

### OSM Foundation — tile.openstreetmap.org
- **Potwierdzone:** polityka definiuje bulk download jako pobieranie kafli, których użytkownik akurat nie ogląda (pre-seeding, archiwa, boty) i wprost stwierdza, że użycie offline nie jest dozwolone na tile.openstreetmap.org. Funkcje „pobierz na offline” i prefetch w tle są zabronione; dla offline odsyła do self-hostingu lub dostawców, którzy to dopuszczają.
- Dodatkowo: wymagany stały, unikalny User-Agent aplikacji; szanowanie nagłówków cache (min. 7 dni, gdy brak nagłówków); widoczna atrybucja OSM.
- Źródło: https://operations.osmfoundation.org/policies/tiles/

### MapLibre Native (Android) i `@maplibre/maplibre-react-native`
- **PMTiles:** obsługa od **MapLibre Android 11.7.0**. Schematy: `pmtiles://https://…` (strumieniowanie), `pmtiles://file://…` (plik w pamięci urządzenia), `pmtiles://asset://…` (plik w APK; nota w wydaniu android-v13.7.1). URL po `pmtiles://` musi być pełny (bez względnych ścieżek).
- **Ważne ograniczenie:** dokumentacja wprost mówi, że **źródła PMTiles nie obsługują paczek offline ani cache**. Offline z PMTiles = pobranie całego pliku `.pmtiles` na urządzenie i wskazanie go przez `pmtiles://file://`, a nie `OfflineManager`.
- **Paczki offline:** MapLibre Native Android ma `OfflineManager` / `OfflineRegion` (definicja: styl + bbox/geometria + zakres zoomu). W `@maplibre/maplibre-react-native` `OfflineManager.createPack({ mapStyle, bounds, minZoom, maxZoom, metadata })`, `setTileCountLimit` (domyślna wartość nie jest podana w dokumentacji — **NIEPOTWIERDZONE**), `invalidatePack`, ambient cache.
- **Wersje:** najnowsze stabilne `@maplibre/maplibre-react-native` = **11.5.1 (opublikowane 29.10.2026)** (rejestr npm). Changelog: 11.4.0 podniosło MapLibre Native Android do 13.6.1; najnowszy natywny Android to 13.7.1 (15.10.2026). v11 działa **wyłącznie w New Architecture**.
- **Expo:** jest config plugin (`"plugins": ["@maplibre/maplibre-react-native"]`), wymagany rebuild (development build); **nie działa w Expo Go**. peerDependencies 11.5.1: `expo >= 54.0.0` (opcjonalne), `react-native >= 0.80.0`, `react >= 19.1.0`.
- Czy wrapper RN przekazuje `pmtiles://` do natywnego SDK bez zmian — dokumentacja RN tego nie opisuje (**NIEPOTWIERDZONE**, sprawdzić w PoC-2). Natywna wersja 13.6.1 > 11.7.0, więc po stronie SDK obsługa istnieje.
- Offline wymaga też lokalnych glifów (fontów) i sprite'ów stylu — sposób podania ich jako plików lokalnych w MapLibre Native — **NIEPOTWIERDZONE**, do PoC-2.
- Źródła: https://maplibre.org/maplibre-native/android/examples/data/PMTiles/ , https://github.com/maplibre/maplibre-native/releases , https://maplibre.org/maplibre-native/android/api/-map-libre%20-native%20-android/org.maplibre.android.offline/-offline-manager/index.html , https://maplibre.org/maplibre-react-native/docs/modules/offline-manager/ , https://maplibre.org/maplibre-react-native/docs/setup/expo , https://registry.npmjs.org/@maplibre/maplibre-react-native , https://raw.githubusercontent.com/maplibre/maplibre-react-native/main/CHANGELOG.md

---

## 3. Google Maps Platform — Places API

**Krótko:** założenie R3 jest **potwierdzone i dla EOG jeszcze ostrzejsze**. Dla klienta z adresem rozliczeniowym w EOG treści Places API (poza lat/lng i place_id) **nie wolno używać z żadną mapą — także z mapą Google**. Wyjątek: Places UI Kit.

### (a) Przechowywanie / cache
- **ToS §3.2.3(b) „No Caching”** (wersja globalna) i **§3.3.2(b)** (wersja EOG): nie wolno cache'ować treści Google Maps poza tym, co wprost dopuszczają Service Specific Terms. §3.2.3(a)/§3.3.2(a) „No Scraping”: m.in. zakaz prefetchu, indeksowania, przechowywania i zapisywania nazw firm, adresów i opinii.
- **Service Specific Terms, część A §3 „Google ID Caching”**: wolno cache'ować identyfikatory, np. `place_id` z Places API (bez limitu czasu).
- **Service Specific Terms §14.3 (globalne) / §15.4 (EOG) „Caching”**: lat/lng z Places API wolno trzymać tymczasowo **do 30 kolejnych dni**, potem usunąć.
- Wniosek: nazw, adresów, godzin otwarcia, ocen z Google **nie wolno** zapisywać w tabeli `places` ani w paczce offline.

### (b) Wyświetlanie na mapie innej niż Google
- **Globalne (poza EOG):** ToS §3.2.3(e) „No Use With Non-Google Maps” — przykład wprost: nie wyświetlać treści Places na mapie innej niż Google. Service Specific Terms §14.2: treści Places API nie wolno używać z mapą inną niż Google; §14.1: wolno bez mapy.
- **EOG (dotyczy nas):** Service Specific Terms EEA, część B: „With any Map” = wyświetlanie na, obok albo wizualnie powiązane z jakąkolwiek mapą, **w tym mapą Google**, lub linkowanie do mapy. §15.1: poza lat/lng i place_id treści Places API nie wolno używać z żadną mapą. §15.2: wolno je używać tylko w ramach listy „Places API EEA Permitted Uses” (9 przypadków: autouzupełnianie adresu, własne sklepy/biura, CRM sprzedaży, notatki/przypomnienia przypięte do miejsca w aplikacji produktywności, otoczenie oferty nieruchomości, transakcje finansowe, gry, tagowanie w social media, smart home). Planer podróży nie jest na liście wprost; najbliższy jest pkt 4 (notatki/przypomnienia w aplikacji organizacyjnej) — interpretacja **NIEPOTWIERDZONE**.
- **Places UI Kit:** globalnie §15.1 — wolno z dowolną mapą, także nie-Google (klauzula ma pierwszeństwo przed zakazem); w EOG §15.3 — ograniczenia §15.1–15.2 nie dotyczą UI Kit. Nadal obowiązuje zakaz cache (poza lat/lng 30 dni) i nienaruszalna atrybucja Google — więc **nie nadaje się do offline**.
- Daty wersji: Service Specific Terms (globalne i EOG) — ostatnia zmiana 28.10.2026; ToS (globalny i EOG) — 26.08.2026; EEA Permitted Uses — 04.06.2025.

Źródła:
- https://cloud.google.com/maps-platform/terms (ToS, §3.2.3)
- https://cloud.google.com/terms/maps-platform/eea (ToS EOG, §3.3.2)
- https://cloud.google.com/maps-platform/terms/maps-service-terms (część A §3, §14, §15)
- https://cloud.google.com/terms/maps-platform/eea/maps-service-terms (część B, §15, §16)
- https://cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses

### (c) Linki do tras (sprawdzone 7.11.2026)
- **Maps URLs** (link `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b`, do 9 punktów pośrednich): bez klucza API i bez opłat. Tak budujemy linki „Trasa w Mapach Google” (`drivingRouteUrl`, `transitRouteUrl`), nic nie zapisując.
- **Własny link użytkownika** (`leg.routeUrl`, zwykle skrócony `maps.app.goo.gl/…`): po „Przelicz trasę” serwer rozwija go jednym zapytaniem HEAD, czytając tylko nagłówek `Location` przekierowania, bez otwierania strony (`planner/src/google-link.ts`). Z rozwiniętego adresu bierzemy tylko współrzędne, które wskazał sam użytkownik: przystanki i przeciągnięte punkty trasy (`core/google-route.ts`). Trasę przez nie liczy openrouteservice. Z Google nie zapisujemy nazw, adresów, linii trasy ani czasu.
- Warunki Map Google (Additional Terms, ost. zmiana 27.01.2026), §2: nie wolno kopiować treści, masowo jej pobierać ani budować z niej zbioru danych map. Nie ma tam zakazu odczytu przekierowania z linku, który wkleił użytkownik, a my nie bierzemy treści Google. ToS Maps Platform §3.2.3 (zakaz scrapingu i cache) dotyczy treści uzyskanej przez usługi Platformy (API), z których tu nie korzystamy.
- Format `/maps/dir/…/data=…` po rozwinięciu **nie jest udokumentowany**: czytamy go ostrożnie (współrzędne w ścieżce i bloki `!3m…!1m2!1d<lng>!2d<lat>`), a niezrozumiały link liczy się jak bez punktów pośrednich.
- Źródła: https://developers.google.com/maps/documentation/urls/get-started, https://www.google.com/help/terms_maps/

---

## 4. Miejsca i geokodowanie

### Geoapify
- Free: **3000 kredytów/dzień**, do **5 req/s**. Cennik (FAQ): Free można używać komercyjnie, także produkcyjnie, w ramach limitów. Regulamin jest ostrożniejszy: komercyjnie „w fazie rozwoju, a w produkcji z ograniczeniami — skontaktuj się” (rozbieżność; dla nas bez znaczenia, bo użycie niekomercyjne).
- Najtańszy płatny: API 10 — 59 USD/mies., 10 000 kredytów/dzień.
- Koszty: geokodowanie / reverse / autocomplete = 1 kredyt; Places API = 1 kredyt do 20 wyników (+1 za każde kolejne 20); Place Details = 1 kredyt + dodatki; kafel mapy = 0,25 kredytu.
- **Przechowywanie:** strona Places API (FAQ) — wyniki wolno cache'ować, przechowywać i redystrybuować („bez limitów”) przy zachowaniu atrybucji. Dla Place Details i geokodowania strona tego nie mówi wprost — **NIEPOTWIERDZONE** (regulamin milczy o cache).
- **Godziny otwarcia:** Place Details zwraca `opening_hours` (string z OSM, tylko gdy jest w OSM; „może być nieaktualne”). Wyszukiwanie Places nie wymienia `opening_hours` w wynikach.
- Atrybucja: zawsze OpenStreetMap; na Free także „Powered by Geoapify”. Zakaz rozpraszania zapytań na wiele kont.
- Źródła: https://www.geoapify.com/pricing/ , https://www.geoapify.com/pricing-details/ , https://www.geoapify.com/term-and-conditions/ , https://www.geoapify.com/places-api/ , https://apidocs.geoapify.com/docs/place-details/

### Nominatim (publiczny, OSMF)
- **Max 1 req/s** na aplikację (suma ruchu wszystkich użytkowników).
- Bulk geokodowanie odradzane; długie/cykliczne skrypty max 4 zapytania/min. Okresowe zapytania w tle z aplikacji traktowane jak bulk.
- **Autouzupełnianie zabronione** (także po stronie klienta).
- Wymagany identyfikujący User-Agent/Referer; cache wyników; atrybucja OSM; aplikacja musi umieć wyłączyć Nominatim na żądanie OSMF bez aktualizacji.
- Zakazane: systematyczne zapytania (siatki, pobieranie wszystkich POI obszaru), scraping, odsprzedaż.
- Źródło: https://operations.osmfoundation.org/policies/nominatim/

### Photon (komoot, photon.komoot.io)
- Warunki: wolno używać w projekcie, ale „rozsądnie”; intensywne użycie będzie dławione; dostępność niegwarantowana; warunki mogą się zmienić.
- Liczbowe limity, użycie komercyjne, wymagana atrybucja — **NIEPOTWIERDZONE** (strona nie podaje).
- Źródło: https://photon.komoot.io/

### Foursquare Places API
- Strona produktu: test wybranych endpointów Pro **do 10 000 wywołań bez opłat** (czy miesięcznie, czy jednorazowo — nie podano). Tabela cennika pokazuje dla Pro 0–500 wywołań za 0 USD CPM — **sprzeczność, NIEPOTWIERDZONE**. Endpointy Premium (m.in. godziny, zdjęcia) bez darmowego progu, od 18,75 USD CPM.
- Licencja pay-as-you-go (§2.1): cache i limity zapytań według Usage Guidelines — tej strony nie udało się odczytać (404). Wyniki wyszukiwarki wskazują, że Sandbox i Pay-as-you-go nie mogą cache'ować, a Enterprise tylko 24 h na urządzeniu — **NIEPOTWIERDZONE**.
- §2.2: atrybucja „Powered by Foursquare” na każdym ekranie z danymi; §2.5.2: zakaz dystrybucji danych hurtowo.
- Źródła: https://foursquare.com/pricing/ , https://foursquare.com/products/places-api/ , https://foursquare.com/legal/terms/apilicenseagreement/

---

## 5. Routing

### OpenRouteService
- Plan Standard: „darmowy dla wszystkich”. **Directions: 2000/dzień, 40/min; Matrix: 500/dzień, 40/min; Isochrones: 500/dzień, 20/min** (część limitów z gwiazdką „obowiązują dodatkowe ograniczenia”).
- Status: **częściowo potwierdzone** — strona https://openrouteservice.org/plans/ zwróciła 404 przy bezpośrednim odczycie; liczby pochodzą z indeksu wyszukiwarki tej oficjalnej strony. Maks. liczba punktów/rozmiar macierzy — **NIEPOTWIERDZONE**.
- Sprawdzone w użyciu (1.11.2026): `POST /v2/directions/{profil}`, klucz w nagłówku `Authorization`; domyślnie punkt musi leżeć ≤ 350 m od drogi (błąd 2010 / HTTP 404) — wysyłamy `radiuses` 5 km (auto) / 1 km (pieszo). Kod: `packages/planner/src/routing.ts`, odstęp 1,6 s między zapytaniami, najwyżej 60 tras na plan.
- Limity z https://openrouteservice.org/restrictions/ (7.11.2026): 50 punktów na trasę, 2000 punktów przy wysokościach. `elevation: true` daje podejście i zejście. Czas pieszo ORS liczy bez podejść (41 min tam, gdzie norma DIN daje 1 h 50 min), więc do czasu pieszo tylko `hikingMinutes`.
- **ORS a trasy użytkownika (7.11.2026):** 8 miejskich GPX-ów z mapy.com, `foot-hiking`. Sam start i koniec: tylko 3 z 8 zgodne (100 % śladu w 50 m), bo pozostałe to celowo dłuższe spacery (1,09 km wobec 4,3 km). Z 3 punktami pośrednimi 72–100 %. Podejście zawyżone na płaskim (84 m wobec 15 m). Wniosek: wyliczanie ze startu i końca nie zastępuje GPX, tras górskich nie sprawdzono.
- Źródło: https://openrouteservice.org/plans/

### Geoapify Routing
- Z puli 3000 kredytów/dzień. Trasa = **(liczba punktów − 1) kredytów**, +1 kredyt za każde kolejne 500 km powyżej 500 km.
- Route Matrix = max(źródła, cele) × min(źródła, cele, 10) kredytów; maks. 1000 elementów.
- Źródło: https://www.geoapify.com/pricing-details/

### Mapy.com REST API (sprawdzone 4.11.2026)
- **NIE do zapisywanych tras.** Regulamin (obowiązuje od 1.06.2025), pkt 4.6.2: zakaz przechowywania i cache'owania wyników funkcji API oraz eksportu danych z usługi. Plan i telefon offline trzymają czas, dystans i linię, więc wynik API tu nie wejdzie bez zgody Seznam. Atrybucja wymagana (pkt 3.2, 4.4).
- Routing: `routeType` m.in. `foot_fast`, `foot_hiking`; odpowiedź `length` (m), `duration` (s), `geometry`; maks. 15 punktów pośrednich. Trasa = 4 kredyty, wysokość = 4; taryfa Basic 250 000 kredytów/mies. Adresu końcówki i sposobu podania klucza nie sprawdzono.
- Używamy wyłącznie linku do trasy (`tracks.url`), liczb przepisanych przez użytkownika z mapy i pliku GPX, który sam wyeksportował. Format krótkich linków `mapy.com/s/…` i parametru `rc` nie jest udokumentowany — nie dekodujemy ich.
- **Adres do otwarcia trasy (sprawdzone 7.11.2026):** `https://mapy.com/fnc/v1/route` z `start`, `end` i `waypoints` (lon,lat, do 15 punktów, rozdzielone `;`), `routeType` (m.in. `foot_fast`, `foot_hiking`) i `mapset` (m.in. `outdoor`). Dokumentacja: „nie wymaga klucza API”. To sam link, nic z niego nie zapisujemy. Wywołanie przekierowuje do planowania trasy.
- Źródła: https://developer.mapy.com/en/terms-and-conditions, https://developer.mapy.com/pricing/, https://developer.mapy.com/en/rest-api/funkce/planovani/, https://developer.mapy.com/en/further-uses-of-mapycz/mapy-cz-url/

### GraphHopper
- Free: **500 kredytów/dzień**, max **5 punktów** na zapytanie, limit kredytów na minutę (bez liczby), **tylko niekomercyjnie**. Basic: 69 EUR/mies. netto.
- Źródło: https://www.graphhopper.com/pricing/

### Transitous / MOTIS 2 (komunikacja publiczna)
- Endpoint produkcyjny: `https://api.transitous.org/api/` (staging tylko do rozwoju Transitous).
- Przeznaczenie: aplikacje **FOSS i niekomercyjne**; projekty „powinny być open source”; użycie komercyjne niedozwolone (organizacje charytatywne — wyjątek na wniosek). Best effort, mogą odciąć dowolnego konsumenta.
- Limit: brak twardego; sygnałem dużego użycia jest m.in. **> ~720 zapytań / 24 h** do `/plan`, `/one-to-many`, `/one-to-all` — wtedy kontakt przed wdrożeniem.
- Wymagany User-Agent: nazwa aplikacji, wersja, kontakt (w przeglądarce Referer + kontakt na stronie). Widoczny link do strony źródeł Transitous i przestrzeganie licencji źródeł (w tym OSM).
- Zasięg geograficzny (Maroko, Gruzja) — strona API nie opisuje; **NIEPOTWIERDZONE**.
- Źródło: https://transitous.org/api/

### Overpass API — linie komunikacji z OpenStreetMap (sprawdzone 7.11.2026)
- Serwer: `https://overpass-api.de/api/interpreter` (FOSSGIS e.V.). Adres w konfiguracji (`OVERPASS_URL`), nie na sztywno — FOSSGIS to zaleca. Inne serwery (np. ovp.dresel.systems, overpass.private.coffee) mają własne zasady, **niesprawdzone**.
- Warunki FOSSGIS (nutzungsbedingungen, dotyczą też overpass-api.de):
  - podpis jak wymaga licencja i OSMF oraz link do https://www.openstreetmap.org/fixthemap („zgłoś błąd”);
  - na stronie łatwo dostępny e-mail operatora (u nas „Pomoc”, `CONTACT_EMAIL`; bez niego rysowanie linii jest wyłączone);
  - User-Agent identyfikujący aplikację (nie biblioteki), Referer gdy się da, najwyżej 2 połączenia, skrypt 1;
  - zakazane: masowe pobieranie, strony o dużym ruchu; komercyjnie tylko, gdy usługa nie jest istotną częścią oferty.
- Wiki OSM (Overpass API): bez przeszkadzania innym < 10 000 zapytań, < 1 GB i < 10 min obliczeń na dobę, przy stałym użyciu ok. 100× mniej; aplikacja liczy się jako suma użytkowników; bez równoległych skryptów; po 429/406 odczekać 30 s. Serwer bywa przeciążony (502/504) — „nie oczekuj wysokiej niezawodności”.
- Dokumentacja serwera (commons): problemem jest „aplikacja dla nie tylko maperów OSM oparta na publicznych instancjach” — przy większej skali własna instancja.
- U nas: jedno zapytanie na kliknięcie („Narysuj na mapie” albo zapis odcinków z wklejonej trasy), relacje linii o podanych numerach w prostokącie wokół przejazdu; zapisany jest tylko wycięty kawałek linii w `leg.geometry` (kilkadziesiąt punktów).
- Ślad GPX (8.11.2026): woda, schroniska i zejścia awaryjne — też jedno zapytanie na kliknięcie („Szukaj wody, schronisk i zejść” na karcie punktu), punkty (`node`, schroniska i wiaty `nwr`) w pasie `around` wokół uproszczonej linii (≤ 80 punktów) w prostokącie śladu. Zapisane w planie najwyżej 60 punktów (nazwa, rodzaj, współrzędne, km), z podpisem „© OpenStreetMap” i „zgłoś błąd” pod listą. Pusta odpowiedź z uwagą o przekroczonym czasie to błąd, nie „nic przy śladzie”.
- Licencja danych: ODbL. Atrybucja wg wytycznych OSMF: „OpenStreetMap” z linkiem do openstreetmap.org/copyright, przy mapie w rogu (u nas w podpisie mapy dnia). Czy zapisany kawałek linii to już „Derivative Database”, wytyczne nie przesądzają; przy małym wycinku do własnego planu traktujemy go jak wynik (Produced Work) z podpisem.
- Źródła: https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/, https://wiki.openstreetmap.org/wiki/Overpass_API, https://dev.overpass-api.de/overpass-doc/en/preface/commons.html, https://www.openstreetmap.org/copyright, https://osmfoundation.org/wiki/Licence/Attribution_Guidelines

---

## 6. Open-Meteo

- Darmowe API: **tylko niekomercyjnie** (strony prywatne/non-profit bez subskrypcji i reklam, automatyka domowa, nauka, edukacja; dobrowolne dotacje dozwolone).
- Limity: **600/min, 5000/h, 10 000/dzień, 300 000/mies.**, liczone per IP i per aplikacja.
- Licencja danych: CC BY 4.0 (wymagana atrybucja).
- Horyzont: `forecast_days` domyślnie **7**, maksymalnie **16**; `past_days` do 92.
- Dalej niż 16 dni — klimat z archiwum (`archive-api.open-meteo.com`, `models=era5`, ok. 5 dni opóźnienia): te same warunki Free API. Wymagany dopisek „Copernicus Climate Change Service” (ERA5). Geokoder (`geocoding-api.open-meteo.com`) tylko do znalezienia miejsca do klimatu, nic nie zapisujemy; podpis „GeoNames”. Strony nie opisują ważenia zapytań o długie okresy — u nas 10 zapytań (po roku) na jedno okno terminu (**NIEPOTWIERDZONE**, czy liczone jako więcej niż 10). Źródła: https://open-meteo.com/en/docs/historical-weather-api , https://open-meteo.com/en/docs/geocoding-api
- Plany komercyjne: Standard 1 mln, Professional 5 mln, Enterprise > 50 mln wywołań / mies.; ceny nie są podane na stronie (**NIEPOTWIERDZONE**).
- Wniosek: przy apce wywołującej API z telefonu limit per IP jest bezpieczny; przy wywołaniach z Edge Function wszystkie zapytania idą z IP Supabase — cache prognoz po stronie serwera.
- Źródła: https://open-meteo.com/en/terms , https://open-meteo.com/en/docs , https://open-meteo.com/en/pricing

---

## 7. Kursy walut — Frankfurter

- **API v1 = tylko kursy referencyjne EBC**: `/v1/currencies` zwraca 30 walut, **bez MAD i GEL** (zapytanie `v1/latest?symbols=MAD,GEL` → „not found”).
- Lista EBC na 30.10.2026: 29 walut (USD, JPY, CZK, DKK, GBP, HUF, PLN, RON, SEK, CHF, ISK, NOK, TRY, AUD, BRL, CAD, CNY, HKD, IDR, ILS, INR, KRW, MXN, MYR, NZD, PHP, SGD, THB, ZAR) — **brak MAD i GEL**.
- **API v2 (zalecane; v1 przestarzałe, ale ma działać bezterminowo)**: kursy „blended” z wielu banków centralnych. `/v2/currency/mad` i `/v2/currency/gel` istnieją (MAD m.in. z Bank Al-Maghrib, GEL m.in. z Narodowego Banku Gruzji). Test 30.10.2026: `/v2/rates?base=EUR&quotes=MAD,GEL,PLN` → MAD 10,9791; GEL 2,8931; PLN 4,3993.
- Warunki: bez klucza, bez kwot dziennych/miesięcznych, limit anty-nadużyciowy; kursy blended **darmowe także komercyjnie**; zapytania do konkretnego dostawcy podlegają jego warunkom; zalecany lokalny cache kursów dziennych.
- Liczba walut: strona główna podaje 228, `/v2/currencies` zwrócił 170 pozycji — rozbieżność bez znaczenia dla projektu.
- Alternatywa nie jest potrzebna.
- Źródła: https://frankfurter.dev/ , https://api.frankfurter.dev/v1/currencies , https://api.frankfurter.dev/v2/currencies , https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html

---

## 8. Święta — Nager.Date

- Projekt przeniesiony: `date.nager.at` przekierowuje na `nagerholidays.com`; nowe API `https://nagerholidays.com/api/v4/Holidays/{kraj}/{rok}`. Stare `https://date.nager.at/api/v3/...` nadal odpowiadało 30.10.2026.
- Strona API: „No Rate Limits”, bez klucza.
- **Regulamin (15.09.2023):** API dla projektów prywatnych i non-profit; **do celów komercyjnych wymagany aktywny sponsoring**; zakaz budowania własnego portalu świąt; brak gwarancji.
- Kraje: 204 w `AvailableCountries` (v3), w tym **MA, GE, ES, HR, PL**.
- **Luka dla Maroka:** dla 2026 i 2027 API zwraca 11 świąt, **wyłącznie stałych** (Nowy Rok, Dzień Pracy, Święto Tronu, Zielony Marsz, Dzień Niepodległości itd.). **Brak świąt islamskich** (Id al-Fitr, Id al-Adha, Nowy Rok islamski, Mawlid) — sprawdzone bezpośrednim zapytaniem. Gruzja: 17 pozycji, Hiszpania: 32 (z regionalnymi), Chorwacja: 14, Polska: 14.
- Źródła: https://nagerholidays.com/api , https://nagerholidays.com/legal/termsofservice , https://nagerholidays.com/country/coverage , https://date.nager.at/api/v3/AvailableCountries , https://date.nager.at/api/v3/PublicHolidays/2027/MA

---

## 9. Resend

- Free: **3000 e-maili/mies., 100/dzień**, 3 domeny, retencja danych 30 dni. Pro: 20 USD/mies. — 50 000 e-maili, bez limitu dziennego.
- Limit API: 10 żądań/s na zespół (wspólny dla kluczy). Kwota dzienna resetuje się o północy UTC; po przekroczeniu błąd 429 (`daily_quota_exceeded` / `monthly_quota_exceeded`). Liczą się też e-maile odebrane.
- **Domena:** do wysyłki trzeba dodać i zweryfikować co najmniej jedną własną domenę. Zalecana subdomena (np. `mail.example.com`), każda weryfikowana osobno. Rekordy: SPF (TXT + MX na subdomenie `send`), DKIM (TXT na `resend._domainkey`); domeny utworzone po sierpniu 2026 mogą dostać rekordy CNAME; DMARC zalecany. Weryfikacja zwykle do 15 min, do 72 h.
- Wysyłka testowa z `onboarding@resend.dev` bez domeny — **NIEPOTWIERDZONE** (nie znaleziono w odczytanych stronach).
- **W kodzie:** serwis wysyła przez dowolny serwer SMTP (`apps/web/src/lib/mail.ts`, zmienne `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`), nie przez API Resend ani jego klucz. Resend jest tu tylko jednym z możliwych dostawców SMTP, a limity powyżej dotyczą go, jeśli go wybrano.
- Źródła: https://resend.com/pricing , https://resend.com/docs/api-reference/rate-limit , https://resend.com/docs/dashboard/domains/introduction , https://resend.com/docs/add-a-domain

---

## 10. Android — lokalizacja w tle i geofencing

### Google Play — `ACCESS_BACKGROUND_LOCATION` (tylko przy publikacji w sklepie)
- Lokalizacja w tle tylko dla funkcji **kluczowej** dla aplikacji (bez niej aplikacja nie działa), opisanej w karcie sklepu; nie dla reklam/analityki.
- **Formularz deklaracji** w Play Console (App content → Sensitive app permissions → Location permissions); pojawia się, gdy aplikacja celująca w Android 10+ ma to uprawnienie w manifeście. **Można zadeklarować tylko jedną funkcję w tle** na aplikację.
- **Wideo** (najlepiej ≤ 30 s, YouTube lub MP4 na Google Drive): pokazuje uruchomienie funkcji w tle, okno prominent disclosure i systemowy prompt uprawnienia.
- **Prominent disclosure** przed promptem systemowym: w normalnym przepływie aplikacji, ze słowem „lokalizacja”, informacją o użyciu w tle i listą funkcji; także w opisie aplikacji i na stronie. Sama polityka prywatności nie wystarcza.
- Nawigacja zakręt po zakręcie i funkcje możliwe na pierwszym planie — wskazane jako „lepiej na pierwszym planie”. Aplikacje podróżnicze nie są wymienione; ocena indywidualna.
- Źródło: https://support.google.com/googleplay/android-developer/answer/9799150

### Geofencing (dokumentacja Android)
- **Do 100 aktywnych geofence na aplikację na użytkownika urządzenia** (na urządzeniach wieloużytkownikowych limit osobno dla każdego użytkownika).
- **Promień: minimum 100 m; zalecane 100–150 m** (Wi-Fi zwykle 20–50 m dokładności; na wsi dokładność może spaść do kilkuset metrów — większy promień).
- Opóźnienie: zwykle < 2 min; przy limitach tła (Android 8+) średnio **2–3 min**; po długim bezruchu do ok. **6 min**. `setNotificationResponsiveness` (przykład: 5 min) oszczędza baterię kosztem opóźnienia.
- Uprawnienia: `ACCESS_FINE_LOCATION` zawsze; `ACCESS_BACKGROUND_LOCATION` przy targetSdk ≥ 29.
- **Geofence znikają po restarcie telefonu** (trzeba ponownie zarejestrować po `BOOT_COMPLETED`), po reinstalacji, wyczyszczeniu danych aplikacji/Play services i po alercie `GEOFENCE_NOT_AVAILABLE`.
- Źródło: https://developer.android.com/develop/sensors-and-location/location/geofencing

---

## 11. Gemini API (sprawdzone 1.11.2026)

Źródła: [warunki](https://ai.google.dev/gemini-api/terms) (obowiązują od 23.03.2026, aktualizacja 28.04.2026), [limity](https://ai.google.dev/gemini-api/docs/rate-limits) (28.10.2026), [cennik](https://ai.google.dev/gemini-api/docs/pricing) (30.10.2026).

- **Dane:** usługi niepłatne (AI Studio, darmowy limit API) — treść zapytań i odpowiedzi służy do ulepszania produktów Google, mogą ją czytać ludzie (po odłączeniu od konta); warunki każą nie wysyłać tam danych osobowych. Usługi płatne (projekt z aktywnym rozliczeniem) — bez ulepszania produktów, przetwarzanie wg Data Processing Addendum, logi tylko do wykrywania nadużyć.
- **EOG, Szwajcaria, Wielka Brytania:** dla dewelopera z tych krajów warunki „Paid Services” dotyczące danych obowiązują **także na darmowym limicie**. Osobno: aplikację udostępnianą użytkownikom w EOG/CH/UK wolno opierać **tylko na Paid Services** — produkcja ExpeditionPlan (MVP-2+, Edge Functions) wymaga rozliczeń w projekcie.
- **Limity:** per projekt (nie per klucz), dzienne kasują się o północy czasu pacyficznego; strona dokumentacji nie podaje liczb dla darmowego poziomu — tylko AI Studio. Google nazywa darmowy poziom „best effort”; fora zgłaszają cięcia (Flash: 250 → ~20 zapytań/dzień). Poziom 1 (z rozliczeniem) — rzędu tysięcy zapytań dziennie.
- **Ceny (Standard, USD / mln tokenów, wejście / wyjście z „myśleniem”):** 3.8 Flash 0,75 / 3,75 do 31.12.2026, od 1.01.2027 1,50 / 7,50; 3.5 Flash-Lite 0,30 / 2,50; 3.1 Flash-Lite 0,25 / 1,50. Batch i Flex — połowa.
- **Klucz:** tylko w `.env.local` (narzędzia) i w sekretach Edge Functions (`GEMINI_API_KEY`); nigdy w przeglądarce ani w APK.
- **Grounding z wyszukiwarką Google i z Mapami (sprawdzone 5.11.2026): NIE do danych zapisywanych w planie.** Warunki zakazują cache'owania i budowania bazy z wyników. Wyjątki są wąskie: tekst wyników z wyszukiwarki do 2 lat tylko do oceny wyświetlania, historii czatu użytkownika albo chwilowego ponownego wysłania; wyniki z Map do 90 dni tylko do oceny wyświetlania albo do 6 miesięcy w historii czatu. Wynik z wyszukiwarki wolno pokazać tylko osobie, która pytała, razem z sugestiami Google. Darmowego limitu nie ma na modelach Gemini 3+ na poziomie bezpłatnym; na płatnym 5000 zapytań miesięcznie, potem 14 USD za 1000. Dlatego ceny i oceny lokali pochodzą z tekstu wklejonego przez użytkownika (`planner/src/venue.ts`). Źródła: warunki Gemini API („Grounding with Google Search”, „Grounding with Google Maps”), cennik.
- **Mowa z tekstu, Gemini TTS (sprawdzone 8.11.2026): OK z warunkiem.** Lektor pokazu wyjazdu (`/trips/[id]/show`, `packages/ai/src/speech.ts`). Modele `gemini-3.8-flash-lite-tts` i `gemini-3.8-flash-tts` (lista modeli klucza; zapowiedzi `-preview` pomijamy), polski wśród obsługiwanych języków, 30 gotowych głosów. Wywołanie `generateContent` z `responseModalities: ["AUDIO"]` zwraca WAV 24 kHz, mono, 16 bit; tekst czytany jest dosłownie, więc polecenia o sposobie czytania nie doklejamy do tekstu. Wejście do 8192 tokenów. Cena (Standard, USD / mln tokenów, tekst / dźwięk): Flash-Lite TTS 0,50 / 6,00, Flash TTS 0,50 / 9,00 do 31.12.2026, potem dwa razy więcej; dźwięk to 25 tokenów na sekundę, więc 5 minut lektora kosztuje ok. 0,05 USD. Darmowy poziom jest, ale z małym limitem na minutę (w teście 429 po 4 nagraniach z rzędu): aplikacja nagrywa scenę po scenie i po odmowie czeka 30 s. Warunki: Google nie rości sobie praw do wygenerowanej treści, odpowiedzialność za jej użycie i udostępnianie jest po naszej stronie; nie znaleziono zakazu przechowywania nagrań ani obowiązku oznaczania głosu jako syntetycznego (strona pokazu i tak mówi „głos syntetyczny Gemini TTS”). Dane jak wyżej: na darmowym poziomie tekst lektora może służyć Google, a dziennik wyjazdu trafia do szkicu tekstu, więc produkcja tylko na Paid Services. Nagrania są w prywatnym buckecie `show_audio`. Źródła: dokumentacja „Speech generation”, cennik, karty modeli 3.8 Flash TTS i Flash-Lite TTS, warunki Gemini API.

## 12. Wikipedia i Wikimedia Commons (przewodnik, 4.11.2026)

**Krótko:** darmowe API bez klucza; warunkiem jest atrybucja i licencja tekstu. Warunki spisane z dokumentacji Wikimedia znanej z wcześniejszych prac — **w tej sesji nie odczytano stron ponownie**, przed szerszym użyciem sprawdzić linki poniżej.

- Zapytania: MediaWiki Action API (`https://<lang>.wikipedia.org/w/api.php`), bez klucza. Wymagany opisowy `User-Agent` z danymi kontaktowymi (polityka User-Agent Wikimedia: https://meta.wikimedia.org/wiki/User-Agent_policy); zapytania seryjnie, nie równolegle (https://www.mediawiki.org/wiki/API:Etiquette). W kodzie: `packages/planner/src/wiki.ts`, opisy hurtem po kolei.
- Wikidane (`www.wikidata.org/w/api.php`, `wbsearchentities`, `wbgetentities`; dane CC0): tylko do znalezienia artykułu w innym języku po nazwie i współrzędnych. Tekst dalej pochodzi z artykułu Wikipedii albo Wikivoyage, więc obowiązuje ta sama atrybucja. Warunki znane z dokumentacji, nieodczytane ponownie 5.11.2026.
- Tekst artykułów: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Streszczenie AI to utwór zależny — pokazujemy link do artykułu, licencję i informację, że streszczenie zrobiło AI.
- Zdjęcia: pliki z Commons mają różne licencje (CC BY, CC BY-SA, PD, CC0). Pokazujemy tylko pliki z licencją w metadanych (`LicenseShortName`), z autorem i linkiem do strony pliku. Miniatury z `upload.wikimedia.org` / `thumb.wikimedia.org` (hotlinking dozwolony), na telefonie w pamięci podręcznej do użytku offline. Ręczny wybór zdjęcia do opisu (wyszukiwanie w `commons.wikimedia.org`) podlega tym samym zasadom; serwer przyjmuje tylko pliki z Wikimedia z licencją.

## 13. Strony lokali (opis i menu knajpy, 5.11.2026)

Bez API i bez klucza: `apps/web/src/lib/venue-site.ts` pobiera stronę samego lokalu (adres z OSM) i najwyżej jedną podstronę z menu, tylko na kliknięcie użytkownika, a AI robi z tego szkic do zatwierdzenia. Warunki każdej strony są inne i nie da się ich sprawdzić z góry, więc ograniczamy zakres: opisowy `User-Agent`, `robots.txt` respektowany, jedno odczytanie, bez kopiowania całej strony do bazy (zapisujemy tylko krótkie punkty i przykładowe ceny, które wybrał człowiek).

**NIE:** serwisy pośrednie, nawet gdy są wpisane jako „strona” lokalu (Booking, TripAdvisor, Google, Facebook, Instagram, TheFork, Pyszne, Glovo i inne, lista `NOT_OWN_SITE` w `planner/src/venue-page.ts`). Średniej oceny stąd zwykle nie ma: nadal pochodzi tylko z tekstu wklejonego przez użytkownika (§3, §11).

Na tych samych warunkach działa strona wskazana przez użytkownika jako źródło opisu miejsca (`describeFromSource`), bez podstron. Zapisujemy tylko streszczenie AI własnymi słowami i link do strony; bez licencji CC BY-SA, bez zdjęć z tej strony, a pobrany albo wklejony tekst nie trafia do bazy. Streszczenie jest widoczne także na publicznym linku, więc za wybór źródła odpowiada użytkownik.

### Booking.com (nocleg, 5.11.2026)

Kod nie pobiera stron Booking.com ani nie czyta ich automatycznie: warunki serwisu zabraniają automatycznego odczytu, a API partnerskie jest dla nas niedostępne (SPECYFIKACJA W1). Jedyne, co robi: link do wyszukiwania w serwisie (`planner/src/logistics.ts`, „Szukaj w Booking.com”) i link do obiektu wklejony przez użytkownika (`core/lodging-info.ts`). Dane noclegu pochodzą z tekstu, który użytkownik sam wkleił (`planner/src/lodging.ts`), po podglądzie zmian.

## Wnioski dla specyfikacji

Konkretne zmiany do naniesienia w `SPECYFIKACJA.md` (nie zostały wprowadzone):

**§10 — tabela usług:**
1. **Supabase:** dopisać liczby: Free = 500 MB DB / 1 GB Storage / 5+5 GB egress / 500 tys. wywołań funkcji / 50 tys. MAU / pauza po 7 dniach; Pro = 25 USD/mies. (8 GB, 100 GB Storage, 250+250 GB egress, 10 USD kredytu compute). Edge Functions: 150 s wall clock (Free) / 400 s (płatne), **ale idle timeout 150 s na każdym planie**, CPU 2 s.
2. **Kafle mapy:** zmienić „OpenFreeMap / MapTiler / Protomaps” na: **offline = regionalny PMTiles z buildu Protomaps na R2 (ODbL, atrybucja OSM; style CC0)**; web i podgląd = OpenFreeMap; paczki `OfflineManager` z OpenFreeMap tylko ≤ 3000 kafli / 50 MB na pobranie, ≤ 4 równoległe, własny User-Agent. **Usunąć MapTiler z kandydatów offline** (§6.3 zakaz bulk, Free niekomercyjny). Stadia jako zapas (offline ≤ 100 MB/urządzenie, Free niekomercyjny; sprawdzić regulamin od 9.11.2026).
3. **Miejsca:** Geoapify jako główne (3000 kredytów/dzień, 5 req/s, wyniki Places wolno przechowywać, atrybucja OSM + Geoapify). Nominatim: dopisać „**zakaz autouzupełniania**”, max 1 req/s łącznie. Autouzupełnianie przez Geoapify Autocomplete (1 kredyt) lub Photon. Foursquare skreślić na teraz (Premium płatne, cache niepotwierdzony).
4. **Routing:** dopisać limity ORS (2000 tras/dzień, 40/min; macierz 500/dzień), Geoapify (punkty − 1 kredytów), GraphHopper (500/dzień, tylko niekomercyjnie, max 5 punktów).
5. **Pogoda:** Open-Meteo — limit 10 000/dzień, tylko niekomercyjnie, CC BY 4.0; cache prognoz po stronie serwera (wspólne IP Edge Functions).
6. **Święta:** Nager.Date — nowy URL `nagerholidays.com/api/v4`; komercyjnie tylko ze sponsoringiem; **Maroko bez świąt islamskich** → święta ruchome (Id al-Fitr, Id al-Adha, Nowy Rok islamski, Mawlid) z innego źródła albo ręcznie w danych kraju, z oznaczeniem „data przybliżona ±1 dzień”.
7. **Kursy walut:** zmienić „Frankfurter (kursy EBC) — MAD i GEL do sprawdzenia” na „**Frankfurter API v2** (kursy blended banków centralnych, MAD i GEL dostępne, darmowe także komercyjnie, bez klucza). Nie używać v1 (tylko EBC, bez MAD/GEL).”
8. **E-mail:** Resend Free = 3000/mies., 100/dzień, 3 domeny; weryfikacja na subdomenie (SPF TXT+MX na `send`, DKIM `resend._domainkey`, DMARC). Dopisać: wbudowany SMTP Supabase = 2 maile/h i tylko do członków zespołu, więc własny SMTP jest wymagany już do testów z udziałem znajomych.
9. **Transport publiczny:** Transitous dopuszczalny tylko, jeśli projekt jest niekomercyjny i **open source**; wymagany User-Agent z kontaktem, link do źródeł Transitous; > ~720 zapytań `/plan` na dobę → kontakt.

**§11 — ryzyka:**
1. **R3 (Google):** zaostrzyć: „Dla rachunku z adresem w EOG treści Places API (poza lat/lng i place_id) **nie wolno używać z żadną mapą, także Google**, a dozwolone zastosowania są zamkniętą listą (EEA Permitted Uses). Cache: tylko `place_id` bez limitu, lat/lng do 30 dni; nazw, adresów, godzin nie wolno zapisywać. Jedyny wyjątek mapowy to Places UI Kit (bez offline).” Wniosek: Google Places **wykreślić z D4** (porównanie w PoC-1 tylko jakościowe, bez zapisu danych).
2. **R4 (geofencing):** potwierdzone (100 geofence na aplikację i użytkownika, min. 100 m, zalecane 100–150 m). Dopisać: opóźnienie 2–3 min w tle (do ~6 min po bezruchu) i **ponowna rejestracja po restarcie telefonu** (`BOOT_COMPLETED`). Przy D1 (APK poza Play) formularz deklaracji i wideo nie są potrzebne; przy publikacji w Play — jedna funkcja w tle, wideo ≤ 30 s, prominent disclosure.
3. **R6 (kafle offline):** dopisać, że **źródła PMTiles nie obsługują paczek offline MapLibre** — offline = pobranie całego pliku `.pmtiles` regionu (`pmtiles extract --bbox/--region --maxzoom`) do pamięci urządzenia i `pmtiles://file://…`. Do PoC-2: lokalne glify i sprite'y oraz to, czy `@maplibre/maplibre-react-native` 11.5.x przepuszcza `pmtiles://` (natywny Android 13.6.1 obsługuje od 11.7.0).
4. **R8 (Supabase):** potwierdzone 7 dni. Dopisać okno przywrócenia (dokumentacja: 1 rok, zrzut: 90 dni — niejednoznaczne) i że płatne projekty nie są wstrzymywane.
5. **R9 (Edge Functions):** doprecyzować liczby: 150 s Free / 400 s płatne wall clock, **idle timeout 150 s na wszystkich planach**, CPU 2 s. Każdy etap AI musi zwrócić odpowiedź lub strumień w < 150 s.
6. **Nowe ryzyko — licencje „tylko niekomercyjnie”:** Open-Meteo, Nager.Date, GraphHopper Free, Stadia Free, MapTiler Free, Transitous (plus wymóg open source). Przy zmianie D1 na produkt publiczny/komercyjny trzeba wymienić lub opłacić te usługi.
7. **Nowe ryzyko — stos Expo/MapLibre:** `@maplibre/maplibre-react-native` v11 działa tylko w New Architecture, wymaga Expo SDK ≥ 54 i React Native ≥ 0.80, nie działa w Expo Go (potrzebny development build).
