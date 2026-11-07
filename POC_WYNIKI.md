# Wyniki PoC

Dokument bramki decyzyjnej z [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md). Każdy eksperyment dopisuje swoją sekcję.

---

## Bramka decyzyjna (stan 31.10.2026)

**Werdykt: MVP-1 startuje.** Wszystko, od czego zależy fundament danych (schemat, synchronizacja, silnik, AI), ma GO. PoC-2 i PoC-3 dotyczą mapy offline i geofencingu (MVP-4, Etap 8) — ich wynik dopiszę po teście w terenie i nie zmienia on MVP-1.

| PoC | Werdykt | Najważniejsze |
|---|---|---|
| PoC-0 schemat | **GO** | 5 planów w `TripDocument`, poprawki A1–A9 wprowadzone (spec v0.3); luki B — przy etapach, które ich potrzebują |
| PoC-1 łańcuch AI | **GO z warunkami** | jakość spełnia kryteria; czas < 90 s niezmierzony na API (przez CLI 102–391 s) — pomiar przed MVP-2 |
| PoC-2 mapa offline | w toku | `pmtiles extract`: Wrocław 25 MB, Marakesz 2,9 MB, Góry Bystrzyckie 4,6 MB (kryterium ≤ 150 MB z zapasem); test w trybie samolotowym — na telefonie |
| PoC-3 geofencing | w toku | APK z geofencingiem i trybem spaceru zainstalowany; spacery i pomiar baterii — w terenie |
| PoC-4 synchronizacja | **GO** | wariant własny (outbox + `row_version` + `pull_changes`), bez PowerSync |
| PoC-5 silnik | **GO** | 5 planów w ±15 min (`bramka PoC-5`) |

**Wybrani dostawcy** (warunki: [docs/USLUGI.md](docs/USLUGI.md)):

| Obszar | Wybór | Uwagi |
|---|---|---|
| AI | Claude: **Haiku 5.5** etap 2, **Opus 5.5** etap 1 i import planu | D3; klucz produkcyjny — D8, decyzja właściciela przed MVP-2 |
| Miejsca, geokodowanie | **Geoapify** (produkcja), Nominatim + Photon (narzędzia, pojedyncze zapytania) | ugruntowanie 94–97% na OSM; Google Places — NIE |
| Godziny otwarcia | OSM `opening_hours` (z `extratags`) | składnia OSM tylko przybliżona — pełny parser w MVP-2 |
| Routing | **OpenRouteService** (pieszo, auto), Geoapify Routing zapasowo, Transitous dla komunikacji | bez zmian względem spec |
| Kafle | **PMTiles** z buildu Protomaps (offline, własny CDN), **OpenFreeMap** online i małe paczki | potwierdzi PoC-2. **Decyzja końcowa:** aplikacja używa paczek OpenFreeMap (`apps/mobile/src/features/map/offline-packs.ts`), PMTiles został tylko w kodzie PoC |
| Synchronizacja | własna (`packages/sync`) | PowerSync niepotrzebny |
| Dystrybucja | EAS `preview` + **OTA** (`expo-updates`), sprawdzone na telefonie | nowy APK tylko przy zmianach natywnych |

**Otwarte przed kolejnymi etapami:**
- MVP-1 (logowanie): projekt Supabase w chmurze, klient Google OAuth, domena Resend (albo na start samo Google) — konta właściciela.
- MVP-2: D8 (klucz AI w produkcji) i pomiar czasu PoC-1 na API.
- MVP-4 / Etap 8: wynik PoC-2 i PoC-3 (glify offline, opóźnienie geofence, bateria ≤ 5%/h).

---

## Gemini zamiast Claude w łańcuchu planowania (1.11.2026)

Decyzja D8: Gemini API. `npm run plan-ai -- --backend gemini --models …` na 5 planach wzorcowych (`tools/plan-ai/out/2026-11-01T09-54-06`):

| plan | model | AI | miejsca ugruntowane | dni wykonalne | twarde ostrz. | dryf > 15 min | ryzyka | koszt |
|---|---|---|---|---|---|---|---|---|
| dinara | gemini-3.5-flash-lite | 22 s | 6/6 | 3/3 | 0 | 6 | 3/4 | $0,038 |
| barcelona | gemini-3.5-flash-lite | 15 s | 10/11 | 2/3 | 1 | 1 | 3/4 | $0,026 |
| dinara | claude-haiku-5-5 (31.10) | 140 s | 14/14 | 3/3 | 0 | 1 | 4/4 | $0,035 |

- Flash-Lite: 3 z 5 planów padły na walidacji (JSON niezgodny ze schematem dwa razy z rzędu) — `planTrip` ponawia teraz etap jednym świeżym zapytaniem; z tym poprawką Dinara przeszła na lokalnej bazie.
- `gemini-3.8-flash`: wszystkie 5 planów — „model przeciążony” (darmowy limit, ~20 zapytań/dzień). Do ponownego porównania po włączeniu rozliczeń.
- Wniosek: Flash-Lite daje szkic szybciej i równie tanio jak Haiku, ale mniej szczegółowy (mniej miejsc) i z większym dryfem godzin — do szkicu wystarcza; silnik i tak audytuje wynik.

## PoC-0 — Schemat danych na własnych planach (31.10.2026)

**Werdykt: GO.** Poprawki A1–A9 wprowadzone 31.10.2026 (schemat, testy, migracja pięciu planów, specyfikacja v0.3) — patrz „Stan po poprawkach” niżej. Pierwotnie: **GO z poprawkami.** Wszystkie 5 planów zmieściło się w schemacie `TripDocument` bez utraty tego, co jest potrzebne na telefonie w trasie (godziny, rezerwacje i kody, warianty z warunkami, ograniczenia, ceny dla grupy, kontakty). Jednocześnie wyszło **9 luk, które dają złe wyniki silnika albo dublują dane** (grupa A niżej) — trzeba je załatać w schemacie przed MVP-1, razem z migracją pięciu `plan.json`.

### Co powstało

- [`packages/core/src/schemas/trip-document.ts`](packages/core/src/schemas/trip-document.ts) — schemat całego wyjazdu (§5) z kontrolą spójności odwołań.
- `fixtures/plans/<plan>/plan.json` — wzorcowe dokumenty, zanonimizowane (role zamiast imion, kody rezerwacji `ANON-…`, bez prywatnych linków), sprawdzone testem `fixtures.test.ts`.
- `fixtures/plans/<plan>/GAPS.md` — luki, niespójności w dokumentach i ocena per plan.
- [`tools/import-plan`](tools/import-plan/src/cli.ts) — CLI importu DOCX/PDF przez AI z porównaniem do wzorca. Uruchomione 31.10.2026 przez Claude Code — wyniki w sekcji „Import planów przez AI” na końcu.

Wzorce przygotował Claude ręcznie z pełnego tekstu dokumentów (nie przez CLI), więc mierzą zdolność **schematu**, a nie jakość importu AI.

Po migracji do poprawek A1–A9 (przejazdy z godziną przeniesione z `legs` do punktów `transport`, dodatki do najmu z rezerwacji do `addons`):

| Plan | Dni | Punkty (pula) | Przejazdy: punkty / niejawne | Warianty (grupy) | Ograniczenia | Rezerwacje | Budżet | Zadania | Pakowanie | Notatki | Źródła | Ślady |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Maroko | 5 | 65 (15) | 12 / 5 | 24 (7) | 12 | 16 | 13 | 19 | 32 | 31 | 14 | 0 |
| Gruzja | 12 | 56 (0) | 18 / 0 | 13 (7) | 5 | 8 | 0 | 5 | 0 | 7 | 1 | 0 |
| Barcelona | 3 | 40 (1) | 10 / 1 | 6 (3) | 5 | 5 | 0 | 6 | 0 | 12 | 2 | 0 |
| Chatka | 2 | 40 (3) | 5 / 1 | 11 (5) | 7 | 2 | 2 | 29 | 54 | 20 | 6 | 3 |
| Dinara | 3 | 33 (0) | 8 / 0 | 4 (2) | 3 | 6 | 5 | 16 | 12 | 7 | 0 | 4 |

### A. Poprawki obowiązkowe przed MVP-1 — wprowadzone

Każda z nich albo psuje wyliczenia silnika (§7), albo zmusza do zapisywania tego samego dwa razy.

| # | Luka | Gdzie wyszła | Poprawka |
|---|---|---|---|
| A1 | **Godzina punktu nie ma strefy.** Dzień wylotu żyje w strefie celu, a „04:10 lotnisko Wrocław” silnik policzy w czasie marokańskim (godzina błędu; w Gruzji dwie). | Maroko, Gruzja, Dinara | `ItemTime.tz?` — nadpisuje strefę dnia. Tak samo `DocConstraint.tz?`. |
| A2 | **Czas względny liczy się od poprzedniego kroku, nie od „godziny zero”.** Inaczej 9-godzinna ferrata trwałaby 7:40. | Dinara (wzór!) | `relative: { offsetMin, from: 'anchor' \| 'previous' }`. |
| A3 | **Brak kolejności punktów.** Punkty bez godziny (opcja A w Barcelonie, niedziela w Dinarze) trzymają kolejność tylko dzięki pozycji w tablicy JSON. | Barcelona, Dinara | `DocItem.sortKey` (jak `sort_key` w §5). |
| A4 | **Przejazd z godziną zapisany dwa razy** — raz jako punkt (bo ma godzinę i jest w osi), raz jako `leg` (bo ma linię, instrukcję, częstotliwość). `legs` nie mają dnia ani kolejności. | Barcelona, Maroko, Gruzja, Dinara | Przejazd w osi dnia = punkt `kind: transport` z polem `leg` (tryb, linia, instrukcja, częstotliwość, alternatywa jako obiekt, odcinki z przesiadkami, `roundTrip`). Kolekcja `legs` tylko dla przejść niejawnych między punktami. |
| A5 | **Rezerwacja wymaga godziny.** Noclegi „26–27 grudnia” i „5–10.08” bez godzin zameldowania nie mają dat; „ok. 10:00” traci „ok.”. | Gruzja, Maroko, Barcelona | `start`/`end` jako `{ date, time?, precision?, tz }`. |
| A6 | **`in_package` miesza dwie rzeczy:** „jest w grafiku” i „opłacone w pakiecie”. Quady, wielbłądy i kolacja w Agafay wypadłyby z wyliczeń dnia. | Maroko | `planStatus` wraca do „czy w grafiku”; pokrycie przez pakiet to `bookingRef` + `payment: included`. Status `in_package` usunięty. |
| A7 | **Wybór z kandydatów nie trafia tam, gdzie jest potrzebny.** Dzień nie wskaże „noclegu wybranego z grupy X” (10 dni w Gruzji do ręcznego uzupełnienia), punkt „zwrot auta” nie wskaże „auta, które zostanie wybrane”. Kandydat nie ma `variantRef` ani `recommended`. | Gruzja, Maroko | `DocBooking.variantRef` + `recommended`; `days.lodgingRef` i `items.bookingRef` mogą wskazywać grupę porównania — rozwiązywaną do wybranego kandydata. Dodatki do najmu (ubezpieczenie, pakiet km) jako `addons` rezerwacji, nie osobne rezerwacje. |
| A8 | **Status rezerwacji bez „nie wiadomo” i „nie da się zarezerwować”.** Import musiał zgadywać (loty w Gruzji, T-casual, mecz), chatka „kto pierwszy” udaje `idea`. | Gruzja, Barcelona, Chatka | `status += 'unknown' \| 'not_required'`. |
| A9 | **Wariant może tylko dodawać punkty.** „Jeden zabytek zamiast dwóch” i „Paradise Valley zamiast poranka (plaża + sandboard)” nie dają się zapisać; `replacesRef` i `variantRef` przyjmują jeden punkt. | Maroko | `DocVariant.excludesRefs[]`, `replacesRefs[]`, `variantRefs[]`. |

### B. Poprawki przed etapem, który ich potrzebuje

| Obszar | Luki (plany) | Kierunek | Etap |
|---|---|---|---|
| Ceny | opcje wejścia (winda / schody), dopłaty (śniadanie 46 zł/os./dzień), warunki (gratis do 18:00 po rezerwacji), konfiguracje (1 apartament / 2 pokoje), „na rodzinę”, granica wieku „do 30 lat” (Barcelona, Gruzja, Maroko, Chatka) | `Price.options[]`, `extras[]`, `conditions[]`, `basis: per_household`, `PriceTier.maxAgeExclusive`; `sourceRef` zamiast UUID w dokumencie | MVP-3 |
| Budżet | kwota nieznana (parking, paliwo), „SZAC.” obok cen z cennika, jedna pozycja na kilka punktów (Chatka, Maroko) | kwoty opcjonalne przy `unknown`, `approx`, `itemRefs[]` | MVP-3 |
| Ograniczenia | okno 14:00–15:00, „nie wcześniej niż” (zameldowanie), „wszyscy w bazie od zmierzchu”, obowiązkowa przerwa w jeździe, „X min przed odlotem”, względem zachodu słońca, świadome wyjście poza zachód (czołówki), omijanie obszaru (Chatka, Maroko, Gruzja, Barcelona, Dinara) | `window {from,to}`, `not_before`, `be_at_base_by`, `mandatory_break`, `relativeTo: booking \| sunset`, `acknowledged`, `avoid_area` | MVP-3 (silnik) |
| Podgrupy | „2 dorosłych + 2 dzieci” bez imion (szpica), ekipy zadaniowe jako blok, „rafting dla chętnych” (Chatka, Gruzja) | `participantSlots`, `parentRef` (blok → podpunkty), `optIn` | Etap 5 |
| Warianty | zamiana dni wg pogody (zbiór dni), go / no-go „2 dni przed”, wyzwalacz w terenie („gdy szpica dotrze”), decyzja zależna od odpowiedzi na pytanie, procedura awaryjna bez wyboru (deszcz) (Gruzja, Chatka, Maroko) | `dayRefs[]`, `decideBy.before_trip`, `triggerItemRef`, `dependsOnTaskRef`, notatka `contingency` | MVP-3 / Etap 10 |
| Pula | „mieści się, opcjonalnie”, „za drogo”, „na przyszłość”, powód statusu, powiązanie pozycji puli z wystąpieniami w osi (Maroko, Barcelona, Chatka) | `statusReason`, `planStatus += optional_fits \| future`, `poolRef` | MVP-3 |
| Ślady | brak geometrii, a dojście do chatki bez szlaku to najważniejsza trasa na telefonie; tam / tam i z powrotem; skala ferrat (Chatka, Dinara) | `gpxPath` / `geojson` (spec ma), `shape: one_way \| out_and_back \| loop`, `ferrataGrade` | Etap 7 |
| Pakowanie | odbiorca (gwizdek tylko dzieci), ilość liczona z grupy (2,5 l wody/os./dobę), pozycje negatywne („podkładki nie bierzcie”), sprzęt wymagany przez punkt (kask → ferrata), powiązanie z posiłkiem (Chatka, Maroko, Dinara) | `audience`, `perPerson`, `exclude`, `requiredForRefs`, `itemRef` | Etap 7 |
| Rezerwacje — szczegóły | udział własny, kaucja: blokada / pobranie, staż prawa jazdy, kod taryfy; jednostki noclegu (typ, cały obiekt, gwiazdki, pokoje × łóżka); „tylko gotówka” vs „gotówka lub karta”; bagaż z wymiarami; dwa odcinki jednej ceny lotu (Maroko, Gruzja, Dinara) | rozszerzenia `car`, `lodging.units[]`, `paymentMethods[]` + `only`, `flight.baggage` strukturalnie, `segments[]` | Etap 6 |
| Załączniki i linki | voucher auta, „inne trasy” — prywatne linki gubione przez anonimizację; obrazy w dokumentach (Dinara, Chatka) | `attachments[]` (→ `documents`), `Link.visibility: private` | MVP-3 |
| Zadania | okno „zimą”, „kiedyś przed wyjazdem”, linki w zadaniu, zadanie zamykane przypisaniem w pakowaniu (Gruzja, Chatka, Barcelona, Dinara) | `TaskDue.window`, `before_trip.days` opcjonalne, `links[]`, `packingRef` | MVP-3 |
| Drobne | punkt przez północ (dyżur przy piecu), `ItemKind: rest`, `statedDriving.durationMaxMin` i `approx`, `checkedAt` z dokładnością do miesiąca, `trip.preparedAt` („sprawdzić dziś”) | jak w nazwach | przy okazji |

### C. Do importu, nie do schematu

Dokumenty mają luki, których żaden schemat nie naprawi — **import powinien je zamieniać w zadania**, a nie gubić:

- brak wieku uczestników (Barcelona, Gruzja, Chatka) → „uzupełnij wiek” — bez niego nie policzy się ceny dla grupy;
- nocleg albo cel trasy bez współrzędnych (chatka!) → „dodaj punkt na mapie”;
- opłacona rezerwacja bez kontaktu → „dodaj kontakt do gospodarza”;
- status zakupu nieznany → pytanie „czy kupione?”.

### Niespójności znalezione w Twoich dokumentach

Wybrane — pełne listy w `GAPS.md` każdego planu. To jest też argument za silnikiem: wszystkie poniższe da się wykryć automatycznie.

- **Maroko:** „żaden dzień ponad 3 h” vs 3 h 30 w dniu 4; tabela układów nocy nieaktualna po przeniesieniu ostatniej nocy do Anzy (139 km vs 190 km); obóz przyjmuje od 14:00 czy od 15:00; „4% z 20 000 MAD to 800 zł” — to 800 MAD, ok. 344 zł; riad i Sidi Kaouki „po €86”, a potwierdzenia mówią 878 zł i 361 zł; „żaden dzień nie jest na styk” vs audyty dnia 2 i 4.
- **Gruzja:** 10.08 kanion zaczyna się dokładnie po 4 h jazdy, bez żadnego zapasu; zamiana dni w górach może wrzucić Muzeum Swanetii na poniedziałek, gdy muzea są zamknięte; Winterfell ma darmowe odwołanie tylko do 6.07.2027 — decyzja wcześniej niż reszta.
- **Barcelona:** 6.12 to święto, a plan awaryjny na koszulki to sklep przy stadionie w niedzielę; wejście do Sagrady na godzinę bez rezerwacji i bez zadania.
- **Chatka:** ekipy zadaniowe wymagają 6 dorosłych, a jest 5; najmłodsze dziecko raz ma 5, raz 6 lat; dojazd „2:15–2:30”, a harmonogram daje 3:30; zmiana czasu wpisana w sobotę, choć jest w niedzielę.
- **Dinara:** Tulove → Čikola 1:40 po wyjeździe 16:30 daje 18:10, a ferrata startuje o 18:00; voucher na auto jest, a „wynajem auta” wciąż w TODO; Szybenik → Dinara 1:15 vs +1:20.

### Wzór dokumentu

`wzór.docx` ma 14 sekcji i każda da się wygenerować z kolekcji `TripDocument` (mapowanie w [`fixtures/plans/dinara/GAPS.md`](fixtures/plans/dinara/GAPS.md)). Brakuje w nim sekcji „Kontakty i bezpieczeństwo”, którą ma plan Chatki — eksport powinien ją dodawać.

### Stan po poprawkach (31.10.2026)

Wszystkie A1–A9 są w [`trip-document.ts`](packages/core/src/schemas/trip-document.ts), każda z testem z przypadku, który ją wywołał (`trip-document.test.ts`, „poprawki z PoC-0”). Pięć planów przeniesionych i zielonych; każdy `GAPS.md` ma sekcję „Migracja do poprawek A1–A9” i zamknięte wiersze oznaczone „zamknięte — A#”.

Jedna decyzja zapadła przy migracji: **czas względny `from: previous` liczy się od początku poprzedniego punktu** aktywnego wariantu, nie od jego końca. Tak liczy wzór (sobota w Dinarze: 0:00 wyjazd, +1:20 wyjście, choć jazda trwa 1:15; ferrata 9 h, +9:00 powrót) — przy tej interpretacji wynik zgadza się co do minuty: 1:20, 10:20, 11:50.

Migracja odsłoniła kilka nowych luk — dopisane do grupy B:

| Luka | Plan | Kierunek |
|---|---|---|
| Godzina punktu zależna od wariantu (kozy 12:30 w wersji A, „w przelocie” w B) | Maroko | `timeByVariant` albo osobne punkty z `variantRefs` |
| Ograniczenie nie wskaże grupy kandydatów („biuro Sixta otwiera 07:00” → auto, które zostanie wybrane) | Maroko | `DocConstraint.bookingRef` jak w punktach: rezerwacja albo grupa |
| Te same dodatki powielone na 7 kandydatach jednego dostawcy; suma „Octavia + Smart = $348” bez pola | Maroko | dodatki na poziomie dostawcy/grupy; wyliczana suma wybranej kombinacji |
| Lot przez strefy w osi dnia to dwa punkty (`ItemTime` ma jedną strefę na start i koniec) | Gruzja | `endTz` w `ItemTime` albo lot tylko jako rezerwacja + punkt odlotu |
| Numer nocy („noc 3/5”) | Gruzja | wyliczany z `lodgingRef` dni |
| Cena dodatku „za osobę za dzień” (śniadanie) | Gruzja | `basis` łączony albo `Price.extras` (B: ceny) |
| Status punktów w nierozstrzygniętej grupie wariantów | Gruzja | reguła importu: bez `chosenRef` → `candidate`, z rekomendacją → rekomendowany `scheduled` |
| „W ramach karnetu” zapisane jako `payment: prepaid` | Barcelona | `payment: pass` albo wyliczane z `leg.ticketBookingRef` |
| Które punkty chatki wypadają w Planie B/C — dokument nie mówi, `excludesRefs` to interpretacja | Chatka | pytanie przy imporcie |

### Co zostało z PoC-0

1. ~~Poprawki A1–A9~~ — zrobione 31.10.2026.
2. **Import przez AI** (`npm run import-plan -- … --compare …`) dla 5 dokumentów, gdy będzie klucz — wynik dopisać tutaj (ile punktów wzorca odnaleziono, które luki AI popełnia).
3. ~~Specyfikacja v0.3~~ — §5 i §7 zaktualizowane; grupa B czeka na etapy z tabeli wyżej.

---

## PoC-5 — Silnik harmonogramu i ograniczeń (31.10.2026)

**Werdykt: GO.** Silnik odtwarza godziny z pięciu planów w granicach ±15 min w obu scenariuszach (optymistycznym i pesymistycznym), bez twardych naruszeń — test `bramka PoC-5` w [`engine-schedule.test.ts`](packages/core/src/__tests__/engine-schedule.test.ts). Kod idzie wprost do MVP.

### Co powstało — `packages/core/src/engine/`

| Moduł | Co robi |
|---|---|
| [`time.ts`](packages/core/src/engine/time.ts) | czas lokalny ↔ chwila w strefie IANA przez `Intl` (bez bibliotek — to samo w przeglądarce, na telefonie i w Deno); zmiana czasu: godzina powtórzona → pierwsze wystąpienie, nieistniejąca → przesunięta naprzód |
| [`sun.ts`](packages/core/src/engine/sun.ts) | wschód, zachód, zmierzch cywilny (równanie NOAA) i oświetlenie Księżyca — offline, bez API |
| [`price.ts`](packages/core/src/engine/price.ts) | kwota dla grupy z progów wiekowych; uczestnicy bez wieku liczeni po najwyższym progu i zgłaszani |
| [`schedule.ts`](packages/core/src/engine/schedule.ts) | `scheduleDay` (godziny, ostrzeżenia, zapas, fakty dnia), `proposeCuts`, `checkCarKmLimit`, wybór aktywnych wariantów |

Zasady, które wyszły z danych:

- **Godzina z planu = „nie wcześniej niż”.** Punkt startuje o niej, chyba że poprzednie się przeciągnęły; różnica (`driftMin`) to sygnał, że plan się nie spina. Stała godzina (`isFixed`) przy spóźnieniu daje twarde ostrzeżenie.
- **Pora dnia to okno, nie godzina** — „wieczór” nie jest spóźnieniem o 17:01.
- **Początek dnia liczony wstecz** od pierwszej podanej godziny („dojazd 3 h”, potem „w Mestii ok. 13:00” → start 10:00); bez żadnej godziny — 08:00.
- **Część grupy idzie osobną ścieżką** (szpica, grupa główna) i schodzi się z resztą w następnym wspólnym punkcie.
- **Blok z podpunktami** (`parentRef`, nowe pole — z listy B, wprowadzone, bo bez niego „PRACA 14:15–16:00” z czterema ekipami liczyła się po kolei i dawała fałszywy alarm o zachodzie słońca): podpunkty dzieją się równolegle w czasie bloku.
- **Czas względny `from: previous`** od początku poprzedniego punktu aktywnego wariantu (decyzja z PoC-0); bez „godziny zero” silnik przyjmuje koniec ostatniego punktu przed nią i ostrzega.
- **Ograniczenie bez wskazanego punktu nie jest zgadywane** („wymeldowanie 11:00” wskazuje tylko rezerwację — nie wiadomo, czyj to limit).

### Rozjazdy w Twoich planach, które silnik wykrywa (wszystkie ≤ 15 min)

| Plan | Punkt | Plan mówi | Wychodzi | Dlaczego |
|---|---|---|---|---|
| Maroko d1 | Autostradą A7 | 11:45 | 12:00 | odbiór auta 11:30 + „pół godziny na formalności” |
| Maroko d1 | Marakesz, parking | 14:45 | 14:52 | skutek powyższego (+2 h 52 jazdy) |
| Maroko d3 | Mury Skala de la Ville | 14:00 | 14:15 | lunch 12:45 trwa 1,5 h |
| Maroko d4 | Sandboard | 09:30 | 09:45 | poranek na plaży 08:45 trwa 1 h |
| Maroko d4 | Wyjazd drogą N1 | 11:30 | 11:45 | sandboard 2 h |
| Chatka d1 | Szpica w chatce | 13:10 | 13:15 | dojście 45 min, w planie 40 |
| Chatka d1 (pesym.) | Bystrzyca, zakupy | 10:15 | 10:30 | dojazd do 2:30 |
| Dinara d1 | Ferrata Čikola | 18:00 | 18:10 | wyjazd 16:30 + 1:40 jazdy |

### Testy na Twoich danych (wybrane)

- Dinara, sobota z „godziną zero” 06:00: 07:20 wyjście, ferrata 07:20–16:20, 16:20 powrót, 17:50 Szybenik — dokładnie jak we wzorze.
- Gruzja: wylot 15:40 czasu polskiego to 17:40 w Gruzji, przylot 21:10 na miejscu.
- Chatka: zmiana czasu w nocy 24/25.10 wykryta; wschód 7:31 / zachód 17:45 / ciemno 18:20 zgodne z planem (±5 min); Księżyc ~98%.
- Marakesz koniec grudnia: zachód ok. 18:35 — tak jak poprawka w Twoim planie, nie 17:40 ze starych przewodników.
- Maroko d2: po 4 h w Pałacu Bahia wyjazd łamie „nie po 15:00”; `proposeCuts` dochodzi do wycięcia Bahii, nie rusza wyjazdu.
- Pałac Bahia dla piątki: 450 MAD — dokładnie jak w planie (4 × 100 + 50), z informacją, że trzech dorosłych nie ma wieku.

### Ograniczenia, o których trzeba pamiętać

- **Fakty dnia wymagają współrzędnych.** Silnik bez nich mówi to wprost (`no_coordinates`), zamiast udawać. Plany wzorcowe są już zgeokodowane (sekcja „Geokodowanie planów wzorcowych” niżej) — każdy dzień ma słońce.
- **Godziny otwarcia** rozumie tylko w postaci „09:00–19:00”; reszta (dni tygodnia, sezon) czeka na dane z Geoapify/OSM.
- **Limit km Maroka:** silnik liczy 675 km z sum dni (dzień 5 nie ma km w planie), plan podaje 710 — różnica to brakujący odcinek na lotnisko, nie błąd liczenia.
- Święta i nakładanie się punktu z poprzednim przy `from: previous` — do dopisania przy MVP-3.

---

## PoC-4 — Synchronizacja Supabase ↔ SQLite (31.10.2026)

**Werdykt: GO — wariant własny, bez PowerSync.** Wszystkie trzy scenariusze przechodzą powtarzalnie na lokalnym Supabase (Docker), z `node:sqlite` w roli SQLite telefonu: [`sync.integration.test.ts`](packages/sync/src/__tests__/sync.integration.test.ts), uruchomienie `npm run test:sync`. RLS i wersjonowanie: 22 testy pgTAP w [`supabase/tests/poc4_sync.test.sql`](supabase/tests/poc4_sync.test.sql) (`npm run test:db`).

| Scenariusz | Wynik |
|---|---|
| 1. Zmiana na webie widoczna na telefonie < 3 s | **ok. 0,5 s** (5 pomiarów: 480–610 ms) — Realtime → pobranie przyrostowe → SQLite |
| 2. Telefon offline: 3 opóźnienia + 2 wydatki, w tym czasie web zmienia czas punktu, dodaje punkt i usuwa inny | po powrocie sieci 5/5 wysłane, zmiany z webu na telefonie, **harmonogram wszystkich dni w obu scenariuszach identyczny** na webie i telefonie (z opóźnieniami) |
| 3a. Awaria po wysłaniu partii, a przed potwierdzeniem w SQLite (3 powtórzenia) | brak duplikatów, nic nie zginęło |
| 3b. Prawdziwe zabicie procesu (`SIGKILL`) w losowym momencie wysyłki 30 zdarzeń, 10 rund | 30/30 na serwerze, zero duplikatów; w każdej rundzie zabicie trafiało w okno „serwer już ma, telefon jeszcze nie potwierdził” |

### Co powstało

- Migracja [`20261031120000_poc4_sync.sql`](supabase/migrations/20261031120000_poc4_sync.sql): `trips`, `trip_members`, `days`, `items`, `schedule_events`, `expenses`; RLS owner/editor/viewer (widz czyta, wydatki dodaje tylko z `can_add_expenses`, poprawia tylko własne); zdarzenia dnia tylko dopisywane; brak twardego `DELETE`.
- **Wersje zamiast znaczników czasu.** Trigger przy każdym zapisie podbija `trips.sync_version` i stempluje nim wiersz (`row_version`); `plan_version` rośnie tylko przy zmianach planu. Blokada wiersza wyjazdu szereguje zapisy, więc wersje są w kolejności zatwierdzania — `updated_at > last_sync` z v0.3 gubiłby zmiany z transakcji zatwierdzonej później niż nowsza.
- RPC `pull_changes(trip, since)`: wszystko po wersji w jednym zapytaniu (jedna migawka, jedno żądanie z telefonu), z RLS jak zwykły SELECT.
- [`packages/sync`](packages/sync/src/index.ts): `LocalDb` (synchroniczny interfejs: expo-sqlite / `node:sqlite`), outbox (wiersz lokalny + wpis w jednej transakcji, wysyłka partiami w kolejności, wiele poprawek tego samego wydatku → jedna wysyłka), `pullChanges` / `syncTrip` (najpierw outbox, potem pobranie; starsze pobranie nie nadpisze nowszego, wiersz czekający w outboxie zostaje lokalny), `watchTrip` (Realtime na wierszu wyjazdu), `serialPuller`, `uuidv7`, `documentFromRows` / `stateFromLocal` / `stateFromPayload` — ten sam kod składa `TripDocument` i wejście silnika na obu urządzeniach.

### Wnioski i decyzje

- **Realtime po zimnym starcie gubi pierwszy sygnał** (pierwsze uruchomienie po `supabase start`: Realtime zakłada slot replikacji przy pierwszej subskrypcji). Poprawka: po komunikacie „Subscribed to PostgreSQL” (także po ponownym połączeniu) telefon robi dodatkowe pobranie. Sprawdzone restartem kontenera Realtime.
- Duplikat zdarzenia (`ON CONFLICT DO NOTHING`) i tak podbija licznik wyjazdu — trigger BEFORE INSERT działa przed wykryciem konfliktu. Nieszkodliwe (luka w wersjach, dodatkowy sygnał Realtime).
- Wydatki: last-write-wins po stronie serwera; poprawka z telefonu wysłana po poprawce z webu wygrywa. Na MVP wystarczy (wydatki dopisuje głównie telefon), `activity_log` pokaże historię.

### Do zrobienia w MVP-1 (świadome skróty PoC)

- Pola dnia i punktu leżą w `content jsonb`, reszta dokumentu w `trips.doc_rest` — w MVP-1 rozbicie na kolumny i tabele z §5 (`documentFromRows` zostaje jedynym miejscem mapowania).
- `ref` jako klucz dokumentu obok `id` (unikalny w wyjeździe) — warto zostawić: łapki AI i importu odwołują się do `ref`.
- `pull_changes` bez stronicowania (pełna migawka Maroka to kilkadziesiąt kB); przy dużych wyjazdach — strony po `row_version`.
- Odrzucenie trwałe (np. utrata prawa do wydatków) zatrzymuje outbox — trzeba je odróżnić od braku sieci i pokazać użytkownikowi.
- Na telefonie: adapter expo-sqlite dla `LocalDb`, polyfill `crypto.getRandomValues` (expo-crypto) dla `uuidv7`, sprawdzenie na urządzeniu razem z PoC-2/3.

---

## Geokodowanie planów wzorcowych — przygotowanie do PoC-1 (31.10.2026)

Miejsca w `fixtures/plans/*/plan.json` mają współrzędne z OpenStreetMap (publiczny Nominatim, jednorazowo, 1 zapytanie na 1,1 s, identyfikujący User-Agent, cache zapytań poza repozytorium — zgodnie z [docs/USLUGI.md](docs/USLUGI.md)). Narzędzie: [`tools/geocode`](tools/geocode/src/cli.ts), `npm run geocode -- [slug…] [--write]`.

| Plan | Ze współrzędnymi | Bez (powód) |
|---|---|---|
| Barcelona | 25 / 31 | nocleg u znajomej i lokal kolegi (prywatne, celowo pominięte), dwa „X albo Y”, Barça Store przy stadionie, jarmark świąteczny (sezonowy, brak w OSM) |
| Chatka | 6 / 10 | skrzynka geocachingowa; Orlica i Czerniec — OSM daje tylko imienników albo przysiółki, nie szczyty |
| Dinara | 7 / 10 | kwatera i „zakup wody na trasie” (opisowe), start trasy na Dinarę |
| Gruzja | 29 / 36 | trzy noclegi, kolejka na Hacwali, Muzeum Swanetii, wodospad Uszba, wieże w Mestii |
| Maroko | 24 / 31 | obóz na Agafay, dwa noclegi, parking „przy medynie”, warsztaty tui, wydmy i plaża Sidi Kaouki z ruinami marabutu |

**Co wyszło na Twoich planach:**
- **Gruzja, dzień 1:** dojazd do Zugdidi po przylocie o 21:10 wypada ok. 2 h po zmierzchu cywilnym (20:30 zachód, 21:01 zmierzch) — silnik zgłasza `driving_after_dark`.
- **Maroko:** żadna jazda nie wypada po zmroku — zachód 18:35–18:46, plan był policzony z poprawną godziną.
- **Chatka:** OSM zna „Chatkę Sylwestrową” (ok. 1,8 km od schroniska, jak w opisie) — najważniejszy punkt wyjazdu, którego dokument nie miał.

**Wnioski dla PoC-1 i importu:**
- **Polskie egzonimy i transkrypcje nie działają w OSM** (Marakesz, Kutubijja, Uszguli, Szchara, Hacwali). Pomogły podpowiedzi nazw lokalnych/angielskich ([`aliases.ts`](tools/geocode/src/aliases.ts)) — import AI powinien zwracać obok nazwy polskiej `searchName` w języku lokalnym albo angielskim.
- **Imiennicy** (Orlica pod Szczecinem, Tsitsinatela w Tbilisi zamiast w Szekwetili, „UNESCO” w Bieszczadach): trafienie dalej niż promień obszaru wyjazdu od mediany trafień jest odrzucane i szukane drugi raz tylko w prostokącie obszaru.
- **Trafienia zbyt ogólne** (hotel „(Ureki)” znaleziony jako miejscowość Ureki) nie są zapisywane — wyglądałyby na dokładne. Schemat nie ma pola dokładności punktu; warto je dodać w MVP-2 (`precision: exact | area`), bo dla słońca wystarczy miejscowość, a dla nawigacji nie.
- Nominatim nie nadaje się do aplikacji (zakaz bulk i autouzupełniania) — w produkcie geokodowanie przez Geoapify, jak w D4.


---

## PoC-1 — Łańcuch AI z ugruntowaniem (31.10.2026)

**Werdykt: GO z warunkami.** Jakość spełnia kryteria (ugruntowanie, realizowalność, ryzyka), koszt na Haiku jest pomijalny. Kryterium czasu (< 90 s dla planu 4-dniowego) **nie jest spełnione** w tym pomiarze — ale przebiegi szły przez Claude Code (`claude -p`, abonament właściciela, bez kredytów API), z narzutem CLI; czas trzeba zmierzyć ponownie na kluczu API przed MVP-2. Wariant awaryjny („AI wybiera tylko z listy kandydatów”) nie jest potrzebny.

Narzędzie: [`tools/plan-ai`](tools/plan-ai/src/cli.ts) — `npm run plan-ai -- [--plans …] [--models …] [--chunk-days 2] [--backend claude-code|api]`, przeliczenie miar bez AI: `--rescore tools/plan-ai/out/<znacznik>`. Wyniki przebiegów w `tools/plan-ai/out/` (poza git). Tylko tanie modele (Sonnet 5.5, Haiku 5.5) — Opus i Fable są zablokowane w kodzie.

**Łańcuch:** brief → etap 1 (2–3 warianty, ryzyka, bazy z `searchName`) → bazy w OSM + fakty dni liczone kodem (słońce, zmierzch, święta z Nager.Date, zmiana czasu) → etap 2 w częściach po 2 dni, równolegle (dni, punkty, pula, warianty A/B, ograniczenia, audyt zapasu) → pinezki z briefu → ugruntowanie (Nominatim, zapas: Photon w obszarze wyjazdu; godziny otwarcia z OSM) → silnik harmonogramu (§7) → miary.

### Wyniki — iteracja 2 (5 planów × 2 modele)

| Miara (kryterium) | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Ugruntowane miejsca konkretne (≥ 90%) | **97%** (69/71) | **95%** (82/86) |
| Dni realizowalne bez twardych ostrzeżeń (≥ 80%) | **84%** (21/25) | **92%** (23/25) |
| Ryzyka z planów ręcznych (≥ połowa) | **81%** (17/21), spoza briefu 4/8 | **90%** (19/21), spoza briefu 6/8 |
| Czas AI na plan (Maroko 5 dni < 90 s) | 146–281 s (Maroko 281 s) ✗ | 218–391 s (Maroko 382 s) ✗ |
| Koszt planu wg cennika API | **0,03–0,07 USD** | 0,40–2,03 USD (Gruzja 12 dni: 2,03) |
| Naprawy odpowiedzi (jedna próba) | 1–2 na plan | 0–3 na plan |

Iteracja 1 (bez poprawek niżej) dla porównania: ugruntowanie 66–94%, dni realizowalne 33–100%, 1 plan z 10 nieudany, kolacje o 14:10.

### Co poprawiło jakość (iteracja 1 → 2)

- **`searchName` + kategorie po angielsku** z listy: OSM nie zna polskich egzonimów; polskie kategorie („lotnisko”, „baza”) psuły reguły dopasowania. Miejsca opisowe („restauracja w centrum Mestii”) celowo bez `searchName` — miara liczy tylko konkretne.
- **Photon jako zapas** dla nieznalezionych — tylko w prostokącie obszaru wyjazdu i w jego krajach (sam z siebie zwraca muzeum w Mołdawii).
- **Pinezki z briefu** mają pierwszeństwo przed geokoderem (parking na Przełęczy Spalonej).
- **Kotwice czasu**: `dayStart`/`dayEnd` każdego dnia, posiłki z przybliżoną godziną. Bez nich model podawał godzinę tylko lotom, a silnik ściskał dzień (kolacja 14:10, obiad 10:10).
- **Kod sprząta pomyłki formalne zamiast marnować naprawę**: odwołania do rezerwacji w etapie 2, przedrostek części doklejony do dnia („c3-d5”), drugi obiekt JSON po pierwszym (`unwrapJson` bierze pierwszą domkniętą wartość).
- **Claude Code**: domyślne myślenie mnożyło tokeny (73 tys. → 32 tys. przy `--effort low`); na Windows trzeba zabijać całe drzewo procesów po przekroczeniu czasu.

### Co silnik wyłapał w planach AI (to działa jak audyt)

- **Rozjazdy godzin** (> 15 min): Haiku Gruzja 17, Sonnet Chatka 11 — kotwice modelu nie zgadzają się z jego własnymi czasami trwania. To sygnał dla etapu 3 (dostrajanie), nie błąd silnika.
- **Przejazdy fizycznie niemożliwe** (np. 95 km w linii prostej, plan: 20 min pieszo): część to pomyłki AI, część — ugruntowanie w imienniku. Obie warto pokazać do sprawdzenia.
- **Godziny otwarcia**: wyszły dwa błędy silnika, poprawione — godziny przez północ („12:00–01:00”) i zapis OSM z dniami tygodnia (teraz ostrzeżenie miękkie, bo parser bierze pierwszy przedział). **Do MVP-2: pełny parser `opening_hours` z OSM.**

### Rekomendacje do MVP-2

- **Haiku 5.5 jako domyślny model etapu 2**: jakość blisko Sonneta przy ~15× niższym koszcie. Sonnet do rozważenia dla etapu 1 (lepsze warianty i więcej ryzyk spoza briefu) albo jako opcja „dokładniej”.
- **Etap 2 po 1–2 dni równolegle**, jako zadanie w tle z postępem (`ai_runs`), nie jedno żądanie: limit Edge Function 150 s bez aktywności i tak wymusza podział.
- **Produkcja potrzebuje klucza API** — abonament Claude Code zasila tylko narzędzia deweloperskie. Decyzja przed MVP-2: kredyty Anthropic (Haiku ≈ 0,05 USD za plan) albo inny dostawca z darmowym pakietem.
- Miara posiłków ma fałszywe alarmy, gdy brief sam podaje wczesną porę (Dinara: śniadanie 5:30) — do uwzględnienia przy ocenie, nie do poprawy w planie.

---

## Import planów przez AI — domknięcie PoC-0 (31.10.2026)

Pięć Twoich dokumentów z `examples/` → `TripDocument` przez AI (z anonimizacją), porównane z ręcznymi wzorcami i przepuszczone przez silnik harmonogramu. Narzędzie: `npm run batch --workspace tools/import-plan -- [--models …] [--plans …]`, przez `claude -p` (abonament, tylko tanie modele); wyniki w `tools/import-plan/out/` (poza git — pochodzą z prywatnych dokumentów).

| Plan | Haiku 5.5: punkty wzorca / silnik | Sonnet 5.5: punkty wzorca / silnik |
|---|---|---|
| Barcelona | 65% / ok | 65% / ok |
| Gruzja | ✗ (te same klucze w wariantach i rezerwacjach) | 79% / ok |
| Maroko | ✗ (notatka miejsca jako lista) | 86% / rozjazd 60 min |
| Chatka | 40% / 1 twarde, rozjazd 1170 min | 83% / rozjazd 1170 min |
| Dinara | 97% / rozjazd 330 min | 88% / rozjazd 10 min |

Czas 93–370 s na dokument, koszt wg cennika API: Haiku 0,02–0,30 USD, Sonnet 0,19–0,76 USD.

**Werdykt: import AI działa jako szkic do akceptacji, nie jako wierna kopia.** Sonnet 5/5 dokumentów zgodnych ze schematem, Haiku 3/5 — do importu (jednorazowego, długiego dokumentu) lepiej Sonnet. Wzorce ręczne zostają złotym standardem.

**Błędy importu, które silnik i porównanie wyłapały:**
- **„0:00 wyjazd” jako północ** (Haiku, Dinara): we wzorze to „godzina zero”, a AI wpisało godzinę 00:00 — silnik pokazał rozjazd 330 min.
- **Fakty dnia jako punkty** (Chatka, oba modele): „zmiana czasu 3:00 → 2:00” i wschód słońca z godziną w osi dnia — rozjazd 1170 min. Te fakty liczy silnik; w dokumencie to notatki.
- **Zgubione grupy równoległe** (Chatka): szpica i ekipy bez `participantRefs`/`parentRef` — punkty liczą się po kolei.
- **Pominięte sekcje** (Barcelona, oba modele): cały spacer Gotyk–El Born z dnia 2 i 3 rezerwacje (przylot, nocleg, mecz) — model streszcza długi dokument.

**Poprawki wprowadzone:**
- Reguły 13–16 w poleceniu importu: godzina zero, fakty jako notatki, grupy równoległe, kompletność.
- `notes` miejsca, uczestnika i kontaktu przyjmuje też listę — schemat nie zastawia pułapki: w punkcie to lista, w miejscu tekst.

**Do MVP (import planu):** import po sekcjach (dzień po dniu + osobno rezerwacje, budżet, zadania) zamiast jednego zapytania — długie dokumenty tracą treść; podgląd do akceptacji per sekcja (SPECYFIKACJA §4) z ostrzeżeniami silnika przy dniu.

---

## Porównanie z Opus 5.5 (31.10.2026, na życzenie właściciela)

Te same testy na `claude-opus-5-5` (przez `claude -p`, od tego przebiegu w `--safe-mode`, czyli bez globalnego CLAUDE.md użytkownika). Opus jest dopuszczony w `pricing.ts` tylko podany wprost w `--models` — nie jest domyślny.

**Łańcuch PoC-1 (etap 2 po 2 dni), 5 planów:**

| Miara | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| Ugruntowane miejsca konkretne | 97% | 95% | 94% |
| Dni realizowalne | 84% | 92% | 84% |
| Ryzyka z planów ręcznych (spoza briefu) | 81% (4/8) | 90% (6/8) | **100% (8/8)** |
| Czas AI na plan | 146–281 s | 218–391 s | **102–178 s** |
| Maroko (5 dni) | 281 s | 382 s | **131 s** |
| Tokeny wyjścia, Maroko | 97 tys. | 98 tys. | **24 tys.** |
| Naprawy odpowiedzi | 1–2 | 0–3 | 0–1 |
| Koszt planu wg cennika API | **0,03–0,07 USD** | 0,40–2,03 USD | 0,27–1,33 USD |

**Import planów (5 dokumentów):**

| Plan | Haiku | Sonnet | Opus |
|---|---|---|---|
| Barcelona | 65% | 65% | **85%** |
| Gruzja | ✗ | 79% | **86%** |
| Maroko | ✗ | 86% | **89%** |
| Chatka | 40% | 83% | 83% |
| Dinara | 97% | 88% | **100%** |
| Dokumenty zgodne ze schematem | 3/5 | 5/5 | 5/5 |
| Koszt wg API | 0,02–0,30 USD | 0,19–0,76 USD | 0,34–1,91 USD |

**Wnioski:**
- **Opus pisze zwięźle** — ok. 4× mniej tokenów wyjścia niż Sonnet przy tym samym schemacie — więc jest od niego szybszy i tańszy, mimo 2× wyższej stawki. Sonnet nie ma w tych testach przewagi nad żadnym z dwóch pozostałych.
- **Opus wykrywa wszystkie ryzyka** z planów ręcznych, także te, o których brief nie mówi (godziny biura wypożyczalni, limit km, kolejki na lotnisku w Maroku; kieszonkowcy w Barcelonie; woda na grani Dinary).
- **Czas:** Opus zbliża się do kryterium (Maroko 131 s przez CLI z narzutem), ale go nie spełnia; na API i przy częściach po 1 dniu ma szansę zejść poniżej 90 s.
- **Rekomendacja (zmienia D3):** **Haiku 5.5 dla etapu 2** (dni i punkty — 10–20× taniej, jakość wystarczająca, silnik i tak audytuje), **Opus 5.5 dla etapu 1 i importu planu** (warianty, ryzyka, jednorazowy długi dokument — tu liczy się trafność, a koszt to jedno wywołanie). Sonnet odpada. Próba jest mała (5 planów, jeden przebieg na model) — potwierdzić przy MVP-2.

---

## Iteracja 3: reguły importu 13–16 i części po 1 dniu (31.10.2026)

**Import z regułami 13–16** (godzina zero, fakty jako notatki, grupy równoległe, kompletność) — ten sam zestaw, Haiku i Sonnet:

| Plan | Haiku przed → po | Sonnet przed → po |
|---|---|---|
| Barcelona | 65% → 75% | 65% → **88%** |
| Gruzja | ✗ → 79% | 79% → 75% |
| Maroko | ✗ → ✗ | 86% → 85% |
| Chatka | 40% → 63% (rozjazd 1170 → 0 min) | 83% → **90%** (rozjazd 1170 → 0 min) |
| Dinara | 97% → 97% (rozjazd 330 → 575 min) | 88% → 88% |
| Dokumenty zgodne ze schematem | 3/5 → 4/5 | 5/5 → 5/5 |

- Reguła „fakty jako notatki” zadziałała: Chatka bez rozjazdu 1170 min u obu modeli. Kompletność pomogła w Barcelonie (Sonnet 65 → 88%), choć nadal brakuje 2 rezerwacji.
- Haiku dalej myli „godzinę zero” w Dinarze (rozjazd 575 min) i nie domyka Maroka — potwierdza, że do importu potrzebny jest mocniejszy model (D3: Opus) albo import po sekcjach.

**PoC-1 z etapem 2 po 1 dniu** (Haiku, plany równolegle) — **gorzej niż po 2 dni**: czas 121–301 s (bez zysku — wąskim gardłem jest etap 1 i narzut CLI), Maroko 40% dni realizowalnych (było 84% średnio), Barcelona odrzucona przez walidację mimo naprawy, Gruzja 0,49 USD zamiast ok. 0,05 USD (więcej wywołań z pełnym kontekstem). Przebieg szedł równolegle z importem na tym samym abonamencie, co mogło wydłużyć czasy, ale nie tłumaczy spadku jakości. **Zostaje etap 2 po 2 dni**; kryterium 90 s do sprawdzenia dopiero na API (MVP-2).
