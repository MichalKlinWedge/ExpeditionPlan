# Dinara — luki schematu (PoC-0)

Źródło: `exaples/wzór.docx` (wyjazd na Dinarę, jednocześnie **wzór dokumentu** użytkownika) → `plan.json` (TripDocument v1).
Uczestnicy zanonimizowani: Uczestnik 1–5 (imiona, inicjały i ksywki pominięte).

## Luki

| Element dokumentu | Gdzie trafił | Problem | Propozycja zmiany schematu |
|---|---|---|---|
| Godziny względne w sobotę: „0:00 Wyjazd”, „+1:20 Wyjście na trasę”, „Trasa (9h)”, „+9:00 powrót do auta”, „+1:30 Szybenik”, „+2:00 Zadar” | `items` dnia `d2`: „0:00” = `relative` 0 `from: anchor`, kolejne `+h:mm` = `from: previous` z oryginalnym przesunięciem; `anchorTime` puste | **zamknięte — A2.** Zostaje niejasność: schemat liczy `previous` „od końca poprzedniego kroku”, a dokument liczy od jego początku (+1:20 po wyjeździe, choć jazda trwa 1:15; +9:00 = cała 9-godzinna trasa). Dlatego trasa „(9 h)” i przejazd na nocleg nie mają `durationMin` w punkcie (9 h jest w śladzie), a wyjazd ma `leg.durationMin` 75 — jeśli silnik doliczy go do końca kroku, „+1:20” się przesunie | Doprecyzować `from: 'previous'` — od początku czy od końca poprzedniego kroku (`'previous_start' \| 'previous_end'`), i czy liczy się `leg.durationMin` |
| „5:30 Śniadanie” (godzina dokładna) przed „0:00 Wyjazd” | `sniadanie-sobota` `exact 05:30` | Mieszanie godzin dokładnych i względnych działa, ale nic nie pilnuje, że kotwica musi być po 5:30 | Walidacja silnika: `anchorTime` ≥ ostatni punkt dokładny przed `offsetMin: 0` (bez zmiany schematu) |
| Punkty bez godziny: odbiór bagażu, zakup wody, przejazdy, śniadanie i zwiedzanie w niedzielę | `items` bez `time`, `sortKey` w kolejności dokumentu | **zamknięte — A3** | — |
| Piątek zaczyna się we Wrocławiu (zbiórka 9:30), niedziela kończy się we Wrocławiu (przylot 16:15) | `time.tz = Europe/Warsaw` przy zbiórce, wylocie i przylocie; `tz` w ograniczeniu `c-lotnisko-wro` | **zamknięte — A1** | — |
| „Przejazd pod Tulove Grede (link Google Maps)” + sekcja Samochód „Zadar – Tulove (ok. 1,5 h) – 60 km” | punkty `kind: transport` z `leg` (rodzaj, km, czas, skąd/dokąd, `links` z Google Maps); kolekcja `legs` pusta | **zamknięte — A4.** „Przejazd na nocleg” ma tylko `fromPlaceRef` — cel zależy od wariantu | — |
| Loty Ryanair z godzinami w dwóch strefach | `bookings` `lot-tam`, `lot-powrot` (`start/end` = data + godzina + strefa), `status: unknown`; w osi osobno wylot i lądowanie (`leg.mode: flight`, `ticketBookingRef`) | **zamknięte — A8, A5** (wcześniej `booked` było zgadywane). Lotniska jako nazwy, bez kodów; przewoźnik lotu powrotnego nie podany | — |
| „Bagaż podręczny 40 x 30 x 20 cm”, „bagaż nadany 10 kg w obie strony” (TODO), „bagaż do nadania – 140” | `flight.baggage` (tekst), `bookings` `bagaz-nadany` (`luggage`, `to_book`), `budgetLines` `b-bagaz` | Wymiary i limit wagi tylko tekstem — nie da się sprawdzić z wagą turystyczną z Do ustalenia | `flight.baggage: { cabin: { dimsCm, kg }, checked: { pieces, kg } }` |
| Voucher wynajmu auta (link do Google Drive) | **pominięty** (prywatny); notatka przy `bookings` `auto` | Voucher to dokument potrzebny przy odbiorze auta — powinien być w pakiecie offline, ale schemat importu nie ma załączników | `DocBooking.attachments: [{ label, fileRef, visibility }]` (spec: tabela `documents`, sejf M11) |
| „Inne trasy” — link do prywatnego Google Docs | **pominięty**; notatka `trip` | Link prywatny nie może trafić do publicznego repo, a import go gubi | `Link.visibility: 'private'` — import zachowuje, eksport publiczny i link udostępniania ukrywają |
| Wynajem auta: miejsce odbioru / zwrotu | `startPlaceRef/endPlaceRef = lotnisko-zadar` (wywnioskowane z harmonogramu) | Dokument nie podaje miejsca | — (luka danych) |
| Nocleg: „2 noclegi w okolicy Szybenika, link Booking, 15 min do centrum” | `bookings` `nocleg-szybenik` (`candidate`, daty 24–26.04 bez godzin, `distanceNote`); link Booking „share” usunięty jako prywatny | **częściowo zamknięte — A5** (daty bez godzin). Brak ceny; link „share” pominięty | — |
| Sobota: „Przejazd na nocleg +1:30 Szybenik + 2:00 Zadar” | `variantGroups` `vg-nocleg-sobota` (Szybenik rekomendowany, Zadar jako `alternative`) | Niejednoznaczne: dwa cele bez warunku; reszta dokumentu wskazuje Szybenik | — (interpretacja; import powinien utworzyć pytanie) |
| Dwie trasy na Dinarę (ferrata i „wersja bez ferraty”) | `vg-dinara-trasa` + punkt `alternative` z `replacesRef`; ślady jako `tracks` z URL mapy.com | Brak warunku wyboru (pogoda? potwierdzenie ferraty?) | — |
| Trasy: tylko linki mapy.com | `tracks` (4) z `url`; „9 h” dla ferraty na Dinarę | Brak dystansu, przewyższenia i skali trudności ferraty — dane trzeba pobrać z linku | Pobieranie statystyk ze śladu przy imporcie; `DocTrack.ferrataGrade` (A–F) zamiast tekstu w `difficulty` |
| Sprzęt ferratowy (uprząż, lonża, kask, rękawiczki) + czołówka „koniecznie” na Čikolę | `packing` `scope: personal`, kategoria „Sprzęt ferratowy” | Brak powiązania sprzętu z punktami, które go wymagają (sprawdzenie „masz kask?” przed ferratą) | `DocPackingItem.itemRefs` / `requiredFor` |
| Do ustalenia: „nóż”, „apteczka”, „waga turystyczna” | `tasks` (question) **i** `packing` `shared` bez `assigneeRef` | Ta sama rzecz w dwóch miejscach, bez powiązania | `DocTask.packingRef` (zadanie „kto bierze” zamyka się przypisaniem w pakowaniu) |
| Koszty szacowane: „samolot – 400/os.”, „bagaż – 140”, „wynajem auta – 200”, „paliwo + autostrady – 400”, „noclegi – 600” | `budgetLines` (5), `estimate`; tylko samolot `perPerson: true` | Waluta niepodana (przyjęto PLN); dla 4 z 5 pozycji nie wiadomo, czy to na osobę, czy na grupę; „paliwo + autostrady” to dwie kategorie w jednej kwocie | `perPerson` trójstanowe (`true/false/unknown`); `DocBudgetLine.categories: BudgetCategory[]` albo rozbicie przy imporcie |
| „Trochę gotówki w euro” | `packing` osobiste | Brak kwoty i kursu (`trip.fx` puste) | — |
| Wschód 6:00 / zachód 19:50 | `notes` `trip` (`topic: time`) | Bez daty i miejsca; spec zakłada liczenie lokalne | Brak zmiany; ewentualnie ręczne nadpisanie per dzień |
| Powrót z ferraty Čikola 20:30 (po zachodzie 19:50) — „koniecznie czołówki” | `notes` (`warning`) przy punkcie, czołówka w pakowaniu | Świadome wyjście poza zachód — brak ograniczenia, więc silnik nie ostrzeże; gdyby dodać `finish_before_sunset`, będzie fałszywy alarm | `DocConstraint` z `severity: 'soft'` + `acknowledged: true` („wiemy, mamy czołówki”) |
| eSIM na Bośnię (TODO) | `bookings` `esim-bosnia` (`to_book`) + zadanie | Pasuje | — |
| Uczestnicy (imiona, inicjały, ksywki) | `travelers` Uczestnik 1–5 | Brak kierowców (`isDriver`) — kto prowadzi wynajęte auto, nieustalone | — |
| Kontakty alarmowe | `contacts: []` | Wzór nie ma sekcji kontaktów ani bezpieczeństwa (Chatka ma) — nie wpisywałem numerów, których nie ma w dokumencie | Wzór eksportu: sekcja „Kontakty i bezpieczeństwo” z `contacts` + `notes` (`topic: safety`) |
| Obrazy w dokumencie (14) | pominięte | Brak miejsca na ilustracje | `attachments` / `trip.coverPath` |

## Niespójności w dokumencie

- **„Tulove Grede”** (harmonogram) vs **„Tulove Grade”** (Trasy, Samochód); „Cikola” bez znaku diakrytycznego (Čikola).
- **„+9:00 – powrót do auta”** przy „Trasa ferrata Dinara (9h)”: jeśli +9:00 liczyć od godziny zero, trasa trwałaby 7:40 — więc przesunięcia są liczone od poprzedniego kroku (tak przyjęto).
- **Szybenik → Dinara:** 1:15 w sekcji Samochód, +1:20 w harmonogramie.
- **Tulove → Čikola 1:40:** wyjazd 16:30 + 1:40 = 18:10, a ferrata startuje o 18:00.
- **Zadar → Tulove 1:30:** odbiór auta 13:30 + zakup wody + 1:30 jazdy = start trasy najwcześniej ok. 15:00 — bez zapasu.
- **Wynajem auta:** w sekcji Samochód jest voucher (czyli rezerwacja), a „wynajem auta” nadal jest na liście TODO.
- **Nocleg:** link Booking w Zakwaterowaniu, a „zabookowania noclegów” nadal w TODO.
- **Nocleg w sobotę:** „+1:30 Szybenik / +2:00 Zadar” — przy „2 noclegach w okolicy Szybenika” i niedzielnym „Wymeldowanie → Przejazd do Zadaru”.
- **Bagaż:** Transport mówi tylko o podręcznym (40 × 30 × 20 cm), harmonogram dwa razy o „nadaniu bagażu”, Koszty o „bagażu do nadania – 140”, TODO o „bagażu nadanym 10 kg” — status niejasny.
- **Godzina „zero” w niedzielę** jest w Do ustalenia, ale niedzielny harmonogram nie używa godzin względnych.
- **Wschód / zachód słońca** bez daty i miejsca.

## Wzór dokumentu → kolekcje schematu

`wzór.docx` to szablon eksportu (SPECYFIKACJA §0.2: „eksport DOCX/PDF według wzoru”). Każda sekcja generowana z:

| Sekcja wzoru | Źródło w `TripDocument` |
|---|---|
| Tytuł / podtytuł | `trip.title`, `trip.subtitle` |
| **Założenia** | `trip.goal` (+ `trip.summary`) |
| **Termin** | `trip.startDate`, `trip.endDate`; lista dni z `days[].title` / `days[].summary` |
| **Uczestnicy** | `travelers` (`name`, `nickname`, `age`, `household` → tabela rodzin, `guardianRef`, `isDriver`) |
| **Transport** | `bookings` o `kind` ∈ flight / train / bus / ferry / transfer (godziny, przewoźnik, `flight.baggage`), dojazd z `legs` (pierwsza i ostatnia noga), `places` lotnisk / parkingu, `notes` `topic: transport` |
| **Zakwaterowanie** | `bookings` `kind: lodging` (+ kandydaci z `variantGroups` `scope: booking`, `pros/cons`, `links`), `days[].lodgingBookingRef`, `notes` rezerwacji |
| **Sprzęt** | `packing` z kategoriami sprzętu, podział `scope: personal` / `shared` (+ `assigneeRef`) |
| **Dodatkowo do zabrania** | `packing` kategorii „Dodatkowo do zabrania” (gotówka, dokumenty) |
| **Harmonogram** | `days` → `items` w kolejności (`time` wg precyzji: `exact`, `approx`, `range`, `part_of_day`, `relative` jako `+h:mm` lub godzina po ustaleniu `anchorTime`), między nimi `legs`; warianty awaryjne z `variantGroups` / `variants` (punkty `alternative`), `constraints` jako uwagi |
| **Trasy** | `tracks` (`name`, `url`, dystans, przewyższenie, czas, oznakowanie, `routeNotes`) |
| **Koszty szacowane** | `budgetLines` (`title`, `lowMinor`–`highMinor`, `currency`, `perPerson`, `status`) |
| **Samochód** | `bookings` `kind: car_rental` (`car.*`, okres, miejsce odbioru) + `legs` `mode: car / rental_car` (odcinek, km, czas) + załącznik vouchera (dziś brak — patrz luki) |
| **Inne** | `notes` `topic` ∈ weather / time / other (słońce liczone przez silnik), linki ogólne |
| **Do ustalenia** | `tasks` `kind` ∈ question / decision, `status: open` |
| **TODO** | `tasks` `kind: todo` (`due`, `assigneeRefs`) |

Sekcje, których wzór **nie ma**, a Chatka już używa: Prowiant (menu), Bezpieczeństwo, Kontakty, Warianty awaryjne, Źródła — warto je dodać do wzoru eksportu (`items` `meal`, `notes` `topic: safety`, `contacts`, `variantGroups`, `sources`).

## Ocena

Na telefonie w trakcie wyjazdu potrzebne są: godziny lotów w dwóch strefach, odbiór i zwrot auta, oś dnia z godzinami względnymi, linki do tras i dojazdów, odcinki jazdy z czasem, sprzęt ferratowy i ostrzeżenie o powrocie po zmroku. Wszystko to się mieści. Słabsze miejsca: przesunięcia liczone od poprzedniego kroku trzeba przeliczać przy imporcie, nie ma vouchera auta (załączniki), a kolejność punktów bez godziny wynika tylko z kolejności w tablicy.

**GO** — warunek: dodać `relativeTo: 'previous'` (albo `afterRef`) w `ItemTime` przed importem planów pisanych tym wzorem.

## Migracja do poprawek A1–A9 (31.10.2026)

Co się zmieniło w `plan.json`:

- **A1** — `time.tz = Europe/Warsaw` przy zbiórce 9:30 i wylocie 11:20 (piątek) oraz przy przylocie 16:15 (niedziela); `tz` w ograniczeniu `c-lotnisko-wro`.
- **A2** — sobota wróciła do zapisu z dokumentu. „0:00 Wyjazd” to `offsetMin: 0, from: anchor`, a kolejne kroki mają `from: previous` z oryginalnymi przesunięciami: +1:20 wyjście, +9:00 powrót do auta, +1:30 Szybenik / +2:00 Zadar. Usunięte przeliczone przesunięcia (0/80/620/710/740) i notatki o przeliczeniu.
- **A3** — `sortKey` w kolejności dokumentu, także dla punktów bez godziny. „Przepakowanie i nadanie bagażu”, „Lądowanie” i „Przylot do Wrocławia” są teraz osobnymi wierszami, jak w dokumencie.
- **A4** — wszystkie przejazdy z sekcji Samochód są w punktach `transport` z `leg`, razem z linkami Google Maps do tras. Loty to `leg.mode: flight` z `ticketBookingRef`. Kolekcja `legs` jest pusta (było 7), a linki „dojazd pod …” przeniesione z miejsc do przejazdów.
- **A5** — rezerwacje mają start/koniec jako data + godzina + strefa; nocleg ma daty 24–26.04 bez godzin.
- **A7** — `lodgingRef` w dniach d1 i d2.
- **A8** — loty i wynajem auta mają `status: unknown`: dokument nie mówi, że bilety są kupione, a przy aucie voucher stoi w sprzeczności z TODO.
- **A9** — „Dinara bez ferraty” wyrzuca ferratę (`excludesRefs`), a „nocleg w Zadarze” wyrzuca przyjazd do Szybenika.
- Link „share” do Booking.com pozostaje usunięty (prywatny).

Zamknięte luki: godziny względne (A2), kolejność punktów bez godziny (A3), strefa godzin we Wrocławiu (A1), przejazdy dublowane przez nogi i brak linków w nogach (A4), zgadywany status lotów (A8, A5). Częściowo zamknięty: nocleg bez dat (A5).

Rozstrzygnięte (31.10.2026): `from: 'previous'` liczy się od **początku** poprzedniego punktu w aktywnym wariancie — tak jak wzór (+1:20 po wyjeździe, choć jazda trwa 1:15). Trasa „(9 h)” dostała `durationMin: 540`; sobota daje 1:20 wyjście, 10:20 powrót do auta, 11:50 Szybenik. Bez zmian zostają: voucher auta (brak załączników), link prywatny „inne trasy”, nieznana podstawa kosztów (osoba/grupa) i waluta.
