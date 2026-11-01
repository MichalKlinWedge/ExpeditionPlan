# Maroko — luki schematu (PoC-0)

Źródło: `exaples/Maroko-plan-26-30-grudnia-2026.pdf` (21 stron) → `plan.json` (`TripDocument`, schemaVersion 1).
Wynik: `npx vitest run src/__tests__/fixtures.test.ts -t "maroko"` — zielony.

Zawartość `plan.json` (po migracji A1–A9): 5 uczestników, 31 miejsc, 5 dni, 65 punktów (50 w dniach, w tym 6 alternatywnych z wariantów; 15 w puli),
5 odcinków niejawnych, 7 grup wariantów, 24 warianty (w tym 9 kandydatów auta), 12 ograniczeń, 16 rezerwacji (2 loty, bagaż,
3 noclegi + pakiet, 9 kandydatów auta z dodatkami), 3 kontakty, 13 linii budżetu, 19 zadań, 32 pozycje pakowania, 31 notatek, 14 źródeł.

## Luki

| Element dokumentu | Gdzie trafił | Problem | Propozycja zmiany schematu |
|---|---|---|---|
| Wiersz „04:10 Lotnisko Wrocław” (dzień 1) i „15:50 Wrocław” (dzień 5) | `items[].time` w dniu o strefie `Africa/Casablanca` + notatka | Godzina punktu nie ma strefy — dni 1 i 5 mają punkty w dwóch strefach. Silnik policzy 04:10 jako czas marokański (godzina różnicy). Lot ma poprawne strefy tylko w rezerwacji | **zamknięte — A1** (`time.tz`). Pierwotnie: `ItemTime.tz?: TimeZone` (domyślnie strefa dnia); to samo dla `DocConstraint.time`  |
| Ograniczenie „Ryanair zamyka odprawę 40 min przed odlotem” (05:30 we Wrocławiu) | `constraints[]` `arrive_before`, `time: 05:30` | Ten sam problem strefy | **zamknięte — A1** (`constraints[].tz`). Pierwotnie: jw. — `tz?` w ograniczeniu albo `minutesBefore` względem `bookingRef` (np. `-40`)  |
| Noclegi: „Noc 1 · 26–27 grudnia” itd. | daty tylko w `title` + `days[].lodgingBookingRef` | `ZonedLocal` wymaga godziny; dokument nie podaje godzin zameldowania (poza Line Up 14:00) — trzeba by je zmyślić, więc `start`/`end` pominięte | **zamknięte — A5** (`start`/`end` z samą datą). Pierwotnie: `startDate`/`endDate` (`IsoDate`) w rezerwacji albo godzina opcjonalna w `ZonedLocal`  |
| „do ok. 10:00 w poniedziałek” (koniec pakietu), auto „ok. 11:30 → ok. 09:00” | `bookings[].start/end` jako dokładne + notatka | `ZonedLocal` nie ma precyzji — „ok.” ginie | **zamknięte — A5** (`precision: approx`). Pierwotnie: `precision?: 'exact' \| 'approx'` w `ZonedLocal`  |
| Nagłówek dnia 3 „199 km · ok. 3 h” | `days[].statedDriving.durationMin = 180` | Brak flagi przybliżenia | `statedDriving.approx?: boolean` |
| Rekomendacja auta: „Rekomendacja: Sixt”, Octavia „WYBÓR”, Smart „BIERZCIE TO” | `variantGroups.auto` (`rationale`), `status: to_book` przy Octavii i Smart, „REKOMENDACJA” w `notes` | Kandydaci to rezerwacje, a `chosenRef`/`recommended` i wiersze `comparison` wskazują tylko `variants` — rekomendacji nie da się zapisać polem, a tabel „AUTO / MIEJSCA I BAGAŻ / 4 DOBY” i „PAKIET / UDZIAŁ WŁASNY / KOSZT” nie da się zapisać bez dublowania każdej rezerwacji wariantem | **zamknięte — A7** (`bookings[].variantRef`, `recommended`; tabela klas aut jako `comparison` grupy `auto`). Tabela pakietów ochrony siedzi w `addons` (cena + `excess`), już nie jako tabela. Pierwotnie: `DocBooking.recommended?: boolean`; `chosenBookingRef` w grupie `scope = booking`; `comparison.rows[].bookingRef` jako alternatywa dla `variantRef`  |
| Wybór auta to trzy wymiary: firma (Sixt / Avis / lokalne) × klasa (7 aut) × pakiet ochrony (3) + dodatek bez limitu km; odpowiedź to kombinacja „Octavia + Smart = $348” | 2 grupy `scope = booking` (`auto`, `auto-ubezpieczenie`), dodatek jako osobna rezerwacja `kind: other` bez grupy | Rezerwacja należy do jednej grupy; ubezpieczenie u wynajmującego i pakiet km to dodatki do najmu, a nie osobne rezerwacje (`kind: insurance` sugeruje osobną polisę — dokument przed tym ostrzega). Suma kombinacji nie jest nigdzie policzalna | **częściowo — A7**: pakiety ochrony i pakiet km są `addons` z `recommended` i `excess`. Zostaje: te same dodatki powielone przy 7 kandydatach Sixta, firma i klasa w jednej grupie, suma kombinacji („$348”) nadal niepoliczalna polem. Pierwotnie: `DocBooking.addons[]: { title, price, recommended?, includes[] }` dla `car_rental`; grupy zagnieżdżone albo `variantGroupRefs[]`  |
| Punkty „Odbiór auta 11:30” i „Zwrot auta 08:15” przy niezarezerwowanym aucie | `items[].bookingRef = auto-sixt-octavia` (rekomendowany kandydat) | Punkt powinien wskazywać „to auto, które zostanie wybrane”, nie konkretnego kandydata | **zamknięte — A7** (`bookingRef: auto` → grupa). Pierwotnie: `DocItem.bookingGroupRef` (rozwiązywane do wybranego kandydata)  |
| Audyt dnia 2: „Najprostsze cięcie: jeden zabytek zamiast dwóch” | grupa `d2-ciecia` z wariantami + `cutRank: 1` przy medersie i przy Bahii | Wariant może tylko *dodawać* punkty (`items[].variantRef`); nie da się zapisać, że wariant *usuwa* punkty. „Jeden z dwóch” zapisany jako remis `cutRank` — silnik nie wie, że to XOR | **zamknięte — A9**: dwa warianty „tylko medersa” / „tylko Bahia” i wariant radykalny z `excludesRefs`; remis `cutRank` usunięty. Pierwotnie: `DocVariant.excludesRefs[]`; `cutGroup`/`oneOf` dla punktów wymiennych  |
| Kozy i kooperatywa: 12:30 w wersji A, „w przelocie” w wersji B | `variantRef: d4-v-a`; w B tylko w `summary` wariantu | `variantRef` pojedynczy, a godzina jest jedna dla punktu — wspólny punkt z inną godziną w każdym wariancie się nie mieści | **częściowo — A9**: `variantRefs[]` + `excludesRefs` pozwalają na punkt wspólny dla obu wersji. Zostaje: godzina 12:30 tylko z wersji A — brak godziny per wariant. Pierwotnie: `variantRefs[]` + nadpisanie godziny per wariant (`timeByVariant`)  |
| Quady 15:45, wielbłądy 17:15, kolacja 19:30 — w osi dnia i jednocześnie W PAKIECIE | `planStatus: in_package`, `dayRef`, `time`, `bookingRef`, `payment: included` | `planStatus` łączy „czy jest w grafiku” z „czy jest opłacone w pakiecie”. Według §7 silnik liczy tylko `scheduled` — te trzy punkty mogą wypaść z wyliczeń dnia | **zamknięte — A6** (`scheduled` + `bookingRef` + `payment: included`). Pierwotnie: „W pakiecie” wyrażać przez `bookingRef` + `payment: included`; `in_package` tylko dla puli albo zasada w silniku: `in_package` z `dayRef` = zaplanowany  |
| Znaczniki puli MIEŚCI SIĘ, DROGO, brak znacznika (basen w obozie) | `candidate` / `alternative` / `in_package` + notatka z oryginalnym znacznikiem | Brak statusu „mieści się, opcjonalnie” i powodu „za drogo”; oryginalny znacznik ginie poza notatką | `PlanStatus += 'optional_fits'` albo `statusReason: 'too_expensive' \| 'fits' \| …` |
| Paradise Valley „TYLKO ZAMIAST PORANKA W SIDI KAOUKI” (poranek = plaża + sandboard) | `replacesRef: d4-sandboard` + notatka | `replacesRef` wskazuje jeden punkt | **zamknięte — A9** (`replacesRefs: [d4-plaza, d4-sandboard]` + `excludesRefs` wersji B). Pierwotnie: `replacesRefs[]`  |
| Wiersz 14:00 (mury + port + medyna) i 12:30 (kozy + kooperatywa); pula wycenia je osobno. „Suki, dwa razy… 2–3 h” = dwa wiersze osi | wiersze rozbite na kilka punktów; dla suków czas łączny w notatce | Brak relacji „pozycja puli ↔ wystąpienia w osi”; czas „2–3 h na dwa wejścia” nie ma pola | `DocItem.poolRef` (wystąpienie pozycji puli) albo `occurrences[]` |
| Wiersze ruchu: „14:30 Wyjazd na południowy zachód”, „10:00 Przejście przez suki… ok. 25 min” | punkt `kind: transport` z godziną + odcinek `legs[]` z jego punktu do celu | Odcinek nie ma godziny wyjazdu, więc wiersz ruchu musi być punktem — niejasne, co jest punktem, a co odcinkiem (import zrobi to różnie w każdym planie) | **zamknięte — A4** (punkt `transport` z `leg`; z `legs` zostały tylko przejścia bez wiersza). Pierwotnie: `DocLeg.departTime?` albo jasna konwencja w schemacie (punkt `transport` = start odcinka)  |
| „Objazd kosztuje tylko 16 km i 19 minut względem jazdy prosto”; suma dnia zamiast odcinków | `legs[].instructions`, `days[].statedDriving` | Przyrost względem trasy bazowej nie jest odcinkiem; dokument nie podaje km/czasu dla większości odcinków (tylko sumy dnia) | `DocLeg.detour?: { extraKm, extraMin }`; reszta OK (liczy routing) |
| Ceny złożone: surfing „€15–20 deska, lekcja od €30/os.”; konie „€500–800 / €100–160 od osoby”; sandboard „ok. €100, €150 z kolacją w jaskini”; kooperatywa „wstęp bezpłatny, olej od ok. 100 MAD” | jedna `Price` + reszta w `price.note` | `Price` to jedna oferta; druga opcja (inna podstawa albo inny zakres) tylko tekstem | `Price.options[]` (etykieta + własna `Price`) |
| Bahia „100 MAD od dorosłego i 50 MAD za dziecko 7–13” | `tiers`: dorosły `minAge: 14`, dziecko 7–13 | Dolna granica dorosłego wywnioskowana; cena dla dzieci <7 nieznana — nie da się zaznaczyć „nieznane” (silnik może policzyć 0 albo cenę minimalną) | `PriceTier.unknown?` albo zasada: wiek poza progami = brak ceny |
| Kaucja 20 000 MAD „blokowana na karcie kredytowej… ok. 8 000 zł limitu”, klauzula 4%, „czy Smart obniża kaucję” | `car.deposit` (Price) + notatki + zadania-pytania | Brak rozróżnienia blokada / pobranie i wymagania co do karty | `deposit.mode: 'hold' \| 'charge'`; `car.paymentCard: { creditOnly, holderMustBeDriver, pinRequired }` |
| „Kierowca: min. 24 lata i prawo jazdy od co najmniej 2 lat; dla najmniejszych aut 21 lat” | `car.minDriverAge: 24` + notatka | Brak stażu prawa jazdy; próg zależny od klasy opisany tylko przy Octavii | `car.minLicenseYears` |
| „kod taryfy IDAR” | `car.carClass: 'IDAR'` | Kod taryfy ≠ klasa auta | `car.rateCode` |
| Lokalne wypożyczalnie: Grey Cars, AMO Drive, Carzio, Euromotion, Safe Rent; „4,9–5,0 przy 80–290 opiniach” | jedna rezerwacja-kandydat, dostawcy w `provider`, oceny w `cons` | Kilku dostawców w jednej pozycji; ocena jako przedział nie mieści się w `rating` | Akceptowalne; ewentualnie `rating.scoreMax`, `count` jako przedział |
| Ubezpieczenie Basic „udział własny do 20 000 MAD” vs Smart „zero” | `notes` / `includes` | Brak pola na udział własny (franszyzę) — kluczowe przy porównaniu pakietów | **zamknięte — A7** (`addons[].excess`). Pierwotnie: `insurance.excess?: Price` (w dodatku najmu lub w rezerwacji `insurance`)  |
| Loty: „755 zł od osoby w obie strony… 3 775 zł za piątkę” | cena w `lot-tam`; `lot-powrot` bez ceny z notatką | Brak powiązania dwóch odcinków jednej rezerwacji (cena obejmuje oba) | `DocBooking.priceIncludedInRef` albo `segments[]` w rezerwacji lotu |
| Audyt dnia 1 „zależy wyłącznie od lotniska”, dnia 4 „zero, jeśli chcecie jeszcze Paradise Valley” | `slack: 'small'` (dz. 1), `slack: 'none'` (dz. 4) + pełny tekst | Ocena zapasu jest warunkowa; skala nie ma „zależy od X” ani oceny per wariant | `slack` per wariant (`slackByVariant`) albo `slackCondition` |
| „Postój na kawę w połowie trasy nie jest opcjonalny” | `constraints[]` `kind: other` | Rodzaj nieobsługiwany przez silnik | `ConstraintKind += 'mandatory_break'` (`minutes`, `afterDrivingMin`) |
| B dnia 4: „Zanim wybierzecie B, zapytajcie w Taghazout, czy sadzawki są pełne” | `conditionText`, `decideBy: 09:00`, zadanie-pytanie `on_trip` | Warunek zależy od informacji z miejsca — brak powiązania „decyzja ← odpowiedź na pytanie” (poza tekstem) | `DocVariantGroup.dependsOnTaskRef` |
| Wstęp dnia | `days[].summary` = linia „Nocleg: …” | Dokument nie ma osobnego wstępu dnia; podpis noclegu trafił do `summary` | Brak zmiany; ewentualnie `days[].lodgingCaption` |
| Budżet: znacznik „SZAC.” przy części pozycji „do wydania” | `status: estimate` dla wszystkich + „SZAC.” w `note` | Dokument rozróżnia „kwota z cennika, jeszcze nie wydana” od „szacunek” — `status` ma jedno `estimate` | `DocBudgetLine.approx?: boolean` (jak w `Price`) |
| „Wstępy: medersa i Bahia 285 zł” | jedna linia, oba punkty w `note` | `itemRef` pojedynczy | `itemRefs[]` |
| „Pozostałe atrakcje: — / 900 zł” | `lowMinor: 0` | „—” (nie dotyczy) zapisane jako 0 | Akceptowalne |
| Sumy „Razem ~11 400 / ~13 100”, „na osobę 2 280 / 2 620”, „dwie trzecie zamknięte”, nagłówek „710 km, najdłuższy dzień 3 h 30” | `trip.summary` + notatka `rationale` | Wartości liczone; zapisane tylko tekstem do porównania z wyliczeniem | Akceptowalne (pulpit liczy); ewentualnie `trip.statedTotals` do kontroli importu |
| „Podkładki nie bierzcie” w liście pakowania | `packing[]` z tytułem „— NIE brać” | Pozycja negatywna — na telefonie wyjdzie jako rzecz do spakowania | `DocPackingItem.exclude?: boolean` |
| „Wodę pijcie butelkowaną…” (w sekcji Apteczka) | notatka `health` | Porada, nie rzecz do spakowania | Brak zmiany |
| „Paszporty — sprawdzić dziś” | zadanie bez terminu, `priority: high` | „Dziś” liczone od daty dokumentu, której schemat nie zna (brak też numeru wersji) | `trip.preparedAt: IsoDate` |
| Źródła „październik 2026”, „początek października 2026” | `sources[].note` (bez `checkedAt`) | `checkedAt` wymaga dnia | `checkedAt` z precyzją miesiąca (`RRRR-MM`) |
| Kontakty | 3 kontakty bez telefonów | Dokument nie podaje żadnego telefonu, maila ani numeru alarmowego — problem dokumentu, nie schematu | Bez zmiany schematu; import powinien zgłaszać „brak kontaktu przy rezerwacji opłaconej” |
| Wiersz „12:45 Lunch, wymeldowanie, bagaże na parking” | jeden punkt `kind: meal` | Wiersz łączy posiłek i sprawę; jeden `kind` | Akceptowalne |
| Wiersze przylotu („09:55 Lądowanie w Agadirze”, „15:50 Wrocław”) | punkt `kind: transport` bez `leg` | Koniec przejazdu nie jest przejazdem; lot tam nie ma własnego wiersza, więc został w `legs` (z odprawy do lądowania) | `ItemKind += 'arrival'` albo konwencja: przylot = punkt bez `leg` |
| „Biuro Sixta otwiera o 07:00” przy zwrocie auta, które nie jest zarezerwowane | `constraints[]` `office_open_at` z `itemRef` (punkt wskazuje grupę `auto`), bez `bookingRef` | `DocConstraint.bookingRef` przyjmuje tylko rezerwację, nie grupę kandydatów | `bookingRef` w ograniczeniu jak w punkcie: rezerwacja albo grupa `scope: booking` |
| Warianty z innymi godzinami (wyjazd 13:00 w cięciu radykalnym, 09:00 w wersji B, 11:00, 07:15) | punkty alternatywne z `sortKey` wstawionym chronologicznie | Dokument opisuje je w audycie pod osią dnia; `sortKey` musi wskazać miejsce w osi, więc kolejność „wg dokumentu” jest interpretacją | Akceptowalne |

## Niespójności w dokumencie

1. **Najdłuższy dzień:** strona 1 „żaden dzień dłuższy niż trzy godziny” i „najdłuższy dzień ma niespełna trzy godziny”; uzasadnienie wariantu A „W A żaden dzień nie przekracza trzech godzin”; tabela porównania „ok. 3 h” — a nagłówek strony 1 „najdłuższy dzień 3 h 30”, dzień 4 „190 km · 3 h 30 min”.
2. **Tabela układów nocy jest nieaktualna:** wariant A, dzień 4 „139 km wybrzeżem do Taghazout” — plan to 190 km do Anzy (nocleg przeniesiony, strona 13).
3. **Od której obóz przyjmuje gości:** dzień 2 i strona 6 „obozy przyjmują od 14:00”; strona 8 „15:00 to dokładnie ta godzina, od której obozy w Agafay w ogóle przyjmują gości” (start pakietu 15:00).
4. **Cięcie radykalne dnia 2:** „w obozie o 13:50” — przed 14:00 i przed startem pakietu o 15:00.
5. **Kolacja na pustyni:** wiersz 19:30 „zwykle płatna osobno” vs pakiet GetYourGuide z kolacją w cenie.
6. **Quady:** wiersz 15:45 „dogaduje się je na miejscu” vs „W PAKIECIE”.
7. **Śniadanie:** „zwykle jedyny posiłek wliczony w cenę” vs kolacja w pakiecie (a pakiet nie wymienia śniadania).
8. **Koniec pobytu w obozie:** pakiet „19 godzin, czyli do ok. 10:00” vs „wymeldowanie macie do 11:00”.
9. **Ceny noclegów:** „Noc w riadzie i noc w Sidi Kaouki kosztują tyle samo, €86” vs potwierdzenia 878 zł i 361 zł.
10. **Kaucja i przeliczenia:** „20 000 MAD … to ok. 8 000 zł” — przy przyjętym 1 MAD ≈ 0,43 zł to ok. 8 600 zł; „do 20 000 MAD (ok. $2 050)” — przy kursach planu ok. $2 360; „4% z 20 000 MAD to 800 zł” — to 800 **MAD**, ok. 344 zł.
11. **Taghazout w puli:** „Wioska i zachód słońca na plaży, 2 h, W PLANIE” vs oś dnia: godzina w Taghazout (16:15), zachód już w Anzie.
12. **Odbiór auta:** wiersz 11:30 „Meet & Greet, przedstawiciel czeka w hali przylotów” vs rekomendacja „Sixt, biuro w terminalu”.
13. **Wersja B dnia 4:** decyzja zapada przy wyjeździe z Sidi Kaouki o 09:00, a informację o sadzawkach macie zdobyć „w Taghazout”, czyli po drodze, już po wyborze.
14. **Zapas czasu:** „Zima i drogi” — „żaden dzień nie jest na styk” vs audyty dnia 2 („żaden zapas”) i dnia 4 („zero”).
15. **Ostatnia noc:** lista pakowania i uwagi o bagażu mówią o „domach w Taghazout” (baseny, pranie) — nocleg jest w Anzie.
16. **Budżet „Pozostałe atrakcje: Skala du Port, quady, Majorelle”:** quady w Agafay są w pakiecie (chodzi pewnie o quady po wydmach), a Majorelle ma w puli status NIE MIEŚCI SIĘ.
17. **„755 zł od osoby”** to średnia — lot wyceniony jako 4 bilety dorosłe i 1 dziecięcy, więc cena na osobę nie jest jedna.
18. **„Jazda rozkłada się na wszystkie cztery dni”** — jeździcie w pięciu dniach (dzień 5: 44 min).
19. **Cięcie radykalne dnia 2:** lunch w osi jest o 12:45, a wyjazd w cięciu radykalnym o 13:00 — nie wiadomo, czy lunch zostaje.

## Ocena

Na telefon w trakcie wyjazdu trafia prawie wszystko:
- **godziny:** tak, z precyzją;
- **kod rezerwacji:** tak (`ANON-GYG-0001`, pakiet Agafay);
- **warianty z warunkiem i terminem decyzji:** tak (12:30 w dniu 1, 09:00 w dniu 4);
- **ograniczenia:** tak (15:00, 11:00, 08:15, 09:35, bez jazdy po zmroku);
- **ceny dla grupy z progami wiekowymi:** tak;
- **kontakty:** pola są, ale dokument nie podaje żadnych danych kontaktowych.

Słabe punkty, które wpływają na pracę w trakcie wyjazdu:
- punkty z czasem polskim (04:10 i 15:50) są liczone w strefie marokańskiej;
- cięcia typu „jeden zabytek zamiast dwóch” są opisane, ale silnik ich nie wykona;
- punkty pakietu w osi dnia (`in_package`) mogą wypaść z wyliczeń;
- rekomendowanego auta nie da się oznaczyć polem.

**GO z poprawkami** — schemat unosi ten plan. Przed pierwszą migracją dodać: `tz` w godzinie punktu, daty rezerwacji bez godziny, `excludesRefs` w wariancie, rozdzielenie „w pakiecie” od statusu planu, `recommended` / dodatki w rezerwacji.

## Migracja do poprawek A1–A9 (31.10.2026)

Co się zmieniło w `plan.json`:
- **A1:** `tz: Europe/Warsaw` przy 04:10 (odprawa we Wrocławiu), 15:50 (przylot do Wrocławia) i przy ograniczeniu 05:30.
- **A2:** nieużywane — plan nie ma godzin względnych.
- **A3:** `sortKey` (`0010`, `0020`…) przy każdym punkcie z dniem. Punkty alternatywne stoją tam, gdzie wypadają w czasie.
- **A4:** przejazdy z osi dnia mają `leg` przy punkcie:
  - A7 z bramkami;
  - przejście do Bahii;
  - wyjazd do obozu (także 13:00);
  - wyjazdy z Agafay (10:00 i 11:00) i do Sidi Kaouki;
  - N1 (także wersja B);
  - wyjazd z Anzy (07:30 i 07:15);
  - wylot.

  `legs` spadło z 14 do 5. Zostały: lot tam (bez własnego wiersza), objazd przez Imsouane, Imsouane → Taghazout, Taghazout → Anza, Taghazout ↔ Paradise Valley (`roundTrip`). Punkty postoju (parking w Essaouirze, odprawa, odprawa we Wrocławiu) zmieniły rodzaj na `errand`.
- **A5:** noclegi mają daty (26–27, 27–28, 28–29, 29–30.12) bez godziny. Koniec pakietu „ok. 10:00” i godziny najmu „ok. 11:30 / ok. 09:00” mają `precision: approx`.
- **A6:** quady, wielbłądy i kolacja są `scheduled` + `bookingRef` + `payment: included`. Basen w obozie (pula, bez znacznika) jest `candidate`.
- **A7:**
  - 9 kandydatów auta ma warianty w grupie `auto` i tabelę porównania;
  - Octavia ma `recommended`;
  - Basic, Smart, All Inclusive i pakiet bez limitu km są `addons` (z `excess`) przy kandydatach Sixta — 4 osobne rezerwacje i grupa `auto-ubezpieczenie` zniknęły;
  - `days.lodgingRef` zastąpiło `lodgingBookingRef`;
  - „Odbiór auta” i „Zwrot auta” wskazują grupę `auto`.
- **A8:** bagaż 20 kg ma `status: unknown` (dokument: „jeśli jeszcze nie jest dokupiony”). Statusu `not_required` nie użyto — dokument zawsze mówi, czy coś jest opłacone.
- **A9:** wszystkie warianty dni wyrażone przez `variantRefs` / `excludesRefs` / `replacesRefs`:
  - dzień 1: po 12:30 bez suków;
  - dzień 2: tylko medersa, tylko Bahia, cięcie radykalne;
  - dzień 3: wyjazd 11:00;
  - dzień 4: wersja B wyrzuca plażę, sandboard, wyjazd 11:30, Imsouane i Taghazout;
  - dzień 5: wyjazd 07:15.

  Plan bazowy nie ma `variantRefs`.

Zamknięte w tabeli:
- A1 (2 wiersze), A4, A5 (2), A6, A7 (3, w tym franszyza pakietów), A9 (2);
- częściowo: wybór auta w trzech wymiarach (A7) i kozy z inną godziną w wariantach (A9).

Nadal otwarte, istotne na telefonie:
- godzina punktu per wariant;
- ograniczenie nie wskaże grupy kandydatów;
- dodatki powielone przy każdym kandydacie;
- `statedDriving` bez „ok.”;
- statusy puli MIEŚCI SIĘ / DROGO;
- ceny z dwiema opcjami;
- kaucja (blokada vs pobranie) i wymagania co do karty;
- data dokumentu.

## Strefa czasowa (1.11.2026)

Dokument zakłada „Maroko cały rok na UTC+1”, zachód w Marakeszu ok. 18:35, wschód ok. 08:30 (notatka i `facts`). To już nieaktualne: od 20.09.2026 Maroko jest na stałe w UTC+0 (tzdata 2026c, https://data.iana.org/time-zones/tzdb/NEWS), więc pod koniec grudnia zachód ok. 17:35, wschód ok. 07:30. Notatki zostają jak w źródle; silnik liczy słońce i godziny z nowych reguł (`FIXED_OFFSET_FROM` w `packages/core/src/engine/time.ts`), więc ostrzeżenia o zmroku pojawiają się w planie same.
