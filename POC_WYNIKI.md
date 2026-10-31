# Wyniki PoC

Dokument bramki decyzyjnej z [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md). Każdy eksperyment dopisuje swoją sekcję.

---

## PoC-0 — Schemat danych na własnych planach (31.10.2026)

**Werdykt: GO.** Poprawki A1–A9 wprowadzone 31.10.2026 (schemat, testy, migracja pięciu planów, specyfikacja v0.3) — patrz „Stan po poprawkach” niżej. Pierwotnie: **GO z poprawkami.** Wszystkie 5 planów zmieściło się w schemacie `TripDocument` bez utraty tego, co jest potrzebne na telefonie w trasie (godziny, rezerwacje i kody, warianty z warunkami, ograniczenia, ceny dla grupy, kontakty). Jednocześnie wyszło **9 luk, które dają złe wyniki silnika albo dublują dane** (grupa A niżej) — trzeba je załatać w schemacie przed MVP-1, razem z migracją pięciu `plan.json`.

### Co powstało

- [`packages/core/src/schemas/trip-document.ts`](packages/core/src/schemas/trip-document.ts) — schemat całego wyjazdu (§5) z kontrolą spójności odwołań.
- `fixtures/plans/<plan>/plan.json` — wzorcowe dokumenty, zanonimizowane (role zamiast imion, kody rezerwacji `ANON-…`, bez prywatnych linków), sprawdzone testem `fixtures.test.ts`.
- `fixtures/plans/<plan>/GAPS.md` — luki, niespójności w dokumentach i ocena per plan.
- [`tools/import-plan`](tools/import-plan/src/cli.ts) — CLI importu DOCX/PDF przez AI z porównaniem do wzorca. **Nie uruchomione** — brak klucza AI w `.env.local`. To jest otwarta część PoC-0 (i wejście do PoC-1).

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

- **Fakty dnia wymagają współrzędnych.** Z pięciu planów tylko Chatka ma pinezkę; w pozostałych zachód słońca i „bez jazdy po zmroku” sprawdzą się dopiero po geokodowaniu (MVP-2). Silnik mówi to wprost (`no_coordinates`), zamiast udawać.
- **Godziny otwarcia** rozumie tylko w postaci „09:00–19:00”; reszta (dni tygodnia, sezon) czeka na dane z Geoapify/OSM.
- **Limit km Maroka:** silnik liczy 675 km z sum dni (dzień 5 nie ma km w planie), plan podaje 710 — różnica to brakujący odcinek na lotnisko, nie błąd liczenia.
- Święta i nakładanie się punktu z poprzednim przy `from: previous` — do dopisania przy MVP-3.
