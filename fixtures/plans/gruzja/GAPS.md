# Gruzja 2027 v4 — luki schematu (PoC-0)

Źródło: `exaples/Gruzja_2027_plan_v4.pdf` → `plan.json` (TripDocument, schemaVersion 1).

| Element dokumentu | Gdzie trafił | Problem | Propozycja zmiany schematu |
|---|---|---|---|
| Kolumna „Nocleg”: „1 noc”, „noc 1/5”, „wymeldowanie rano” | `days[].baseRef` + tekst w `days[].summary` | Nie ma pola „gdzie śpimy tej nocy” bez rezerwacji ani numeru nocy. Licznik nocy da się tylko wyliczyć z kolejności baz. | **częściowo zamknięte — A7 (nocleg dnia przez `lodgingRef`; numeru nocy nadal brak).** `DocDay.night?: { placeRef, index, of }` albo wyliczanie z zakresu dat rezerwacji noclegu (patrz niżej). |
| Nocleg dnia, gdy są 2–3 kandydaci (Mestia, morze) | `days[].lodgingBookingRef` puste | Dzień wskazuje jedną rezerwację; nie da się powiedzieć „nocleg = to, co zostanie wybrane w grupie X”. Po wyborze trzeba ręcznie uzupełnić 10 dni. | **zamknięte — A7.** `DocDay.lodgingVariantGroupRef` albo wyliczanie noclegu dnia z rezerwacji `booked` obejmującej datę. |
| Kandydat noclegu ↔ wariant porównania | `bookings[]` (status `candidate`, `variantGroupRef`) + osobne `variants[]` (pros/cons, `recommended`, `metrics`) | `DocBooking` nie ma `variantRef`, więc kandydat i jego wariant łączą się tylko nazwą. Plusy/minusy są zdublowane w rezerwacji i wariancie. SPECYFIKACJA §5 mówi, że „rezerwacje wskazują wariant przez `variant_id`”. | **zamknięte — A7.** Dodać `DocBooking.variantRef` (walidowany: wariant z tej samej grupy) albo `recommended` w rezerwacji i rezygnacja z osobnego wariantu przy `scope = booking`. |
| Terminy noclegów „5–10.08”, „10–15.08” | `bookings[].start` z godziną z planu dnia (15:00 / ok. 16:30), `end` pominięte, termin w `notes` | `ZonedLocal` wymaga godziny. Dokument podaje daty bez godzin wymeldowania, a godzina zameldowania nad morzem to tylko planowany przyjazd „ok. 16:30”. Brak flagi „przybliżone”. | **zamknięte — A5.** `start`/`end` jako `{ date, time?, tz, approx? }` albo osobne `checkInDate`/`checkOutDate` dla noclegów. |
| „3 185 zł + śniadanie 46 zł/os./dzień (razem ok. 4 335 zł)” | `price` = 3 185 zł `per_group`, reszta w `price.note` i `lodging.breakfast` | Jedna `Price` nie unosi ceny bazowej i dopłaty z inną podstawą (per_person × per_day). Suma 4 335 zł tylko w tekście. | **częściowo zamknięte — A7 (śniadanie jako `addons` z ceną per_person; „za dzień” nadal tylko w notatce).** `Price.extras?: [{ label, price }]` albo `DocBooking.priceComponents[]`. |
| Majestic: „2 011 zł (ok. 2 870 zł za 2 pokoje)” | `price` = 2 011 zł, 2 870 zł w `note` i `metrics` | Dwie konfiguracje tej samej oferty (1 apartament vs 2 pokoje). Przedział min–max by to zafałszował. | `Price.options?: [{ label, amountMinor }]` albo konfiguracje w `lodging.units[]`. |
| Winterfell: „112–120 m²”, „2 łazienki (w domku 120 m²)” | `areaM2: 112`, `bathrooms: 2`, reszta w `notes` | `areaM2` to jedna liczba; liczba łazienek zależy od wariantu domku. | `areaMaxM2`; ewentualnie `lodging.units[]` z warunkami. |
| Golden Fleece: „2 pokoje trzyosobowe, po 22 m²” | `rooms: 2`, `beds: "2 × 3 łóżka"`, 22 m² w `notes` | Niejasne, czy `areaM2` to cały nocleg czy jeden pokój — pole pominięte. | `lodging.units?: [{ type, count, areaM2, beds }]`. |
| Typ jednostki: „willa / domek cały dla nas”, „apartament”, „pokoje” | `variants[].summary`, `lodging.amenities` | Brak pola na rodzaj obiektu i „cały obiekt dla nas”. | `lodging.unitType` + `lodging.wholeUnit: boolean`. |
| „8,7 (138 opinii), 4*” | `rating` + „hotel 4*” w `amenities`, `notes`, `metrics.gwiazdki` | Brak pola na kategorię hotelu. | `lodging.stars`. |
| Płatność: „Tylko gotówka”, „Tylko karta”, „Na miejscu” (bez metody) | `paymentMethod: cash/card`, `payWhen`; „tylko” w `notes` | Enum nie odróżnia „tylko gotówka” od „gotówka (karta też)”; `card` nie znaczy „tylko karta”. Majestic: metoda nieznana. | `paymentMethods: ('cash'│'card'│'credit_card'│'online')[]` + `paymentExclusive: boolean`. |
| Data sprawdzenia cen „Booking.com 28.10.2026” | `price.checkedAt` + `sources[src-booking].appliesToRefs` | `Price.sourceId` to UUID, nie `Ref` — w dokumencie nie da się wskazać źródła ceny. | W formacie dokumentu `Price.sourceRef: Ref` (UUID dopiero w bazie). |
| Status lotów (nie wiadomo, czy kupione) | `bookings[lot-tam/lot-powrot].status = to_book` + notatka | `status` jest wymagany i nie ma wartości „nieznany”. Wybór `to_book` to założenie importu. | **zamknięte — A8.** `status: 'unknown'` albo pole opcjonalne przy imporcie. |
| Wylot 15:40 czasu polskiego w dniu, który żyje w `Asia/Tbilisi` | Tylko w `bookings[lot-tam].start`; punkt dnia `d1-przylot` ma 21:10 | `ItemTime` nie ma strefy — punkt z godziną w innej strefie niż dzień musi być przeliczony albo pominięty. To samo z przylotem 23:30 we Wrocławiu. | **zamknięte — A1.** `ItemTime.tz?` albo punkt dziedziczący godziny z `bookingRef`. |
| „Zameldowanie od 15:00” | `d2-zameldowanie` `approx 15:00` + `constraints[c-zameldowanie-mestia]` (`other`) + `checkInFrom` | Nie ma precyzji „nie wcześniej niż” ani rodzaju ograniczenia `not_before`. | `ConstraintKind: 'not_before'` (albo `earliest_start`); silnik bierze `checkInFrom` z rezerwacji. |
| „Dni w górach (6–9.08) zamieniać wg pogody” | `variantGroups[vg-gory-pogoda]` (`scope: trip`, `weather`, bez wariantów) + zadanie + notatka | Grupa wariantów ma tylko jeden `dayRef`; nie da się wskazać zbioru dni wymiennych ani że wymiana nie rusza noclegu. | `DocVariantGroup.dayRefs[]` albo osobna struktura `daySwapSets: [{ dayRefs, condition }]`. |
| „Rafting dla chętnych” | `vg-d11` (`scope: day`) + `priority: optional` + notatka | To nie jest „albo-albo”, tylko podział grupy na nieznany podzbiór. Model wariantów wymusza wybór jednego. | `DocItem.optIn: true` (dla chętnych) albo `participantRefs` z wartością „do ustalenia”. |
| Status punktów w nierozstrzygniętej grupie (Uszba / Tetnuldi, Tsitsinatela / park dendrologiczny) | `planStatus: candidate` + `variantRef` | Brak reguły: przy Koruldi (jest wariant domyślny) użyto `scheduled` + `alternative`, przy równorzędnych — `candidate`. Import AI może robić to różnie. | Zasada w schemacie: status punktu z `variantRef` wyliczany z `chosenRef`/`recommended` grupy, albo walidacja spójności. |
| Kolumna „Przejazd” z łańcuchem: „Mestia → Zugdidi 3 h → Martwili 1 h → Szekwetili 1,5 h” | 3 × `legs[]` między miejscami | `DocLeg` nie ma `dayRef` ani kolejności — legi z bazy (mestia → …) wiszą poza dniami; nie wiadomo, którego dnia jest który przejazd (Mestia → Zugdidi i Zugdidi → Mestia są w dwóch różnych dniach). | **zamknięte — A4, A3.** `DocLeg.dayRef` + `order` (albo legi tylko między punktami dnia). |
| „ok. 2–2,5 h w jedną stronę” (Uszguli), „Ok. 1–1,5 h” | `legs[].durationMin/durationMaxMin`; powrót tylko w `instructions` | Brak oznaczenia „tam i z powrotem”. `days.statedDriving` nie ma górnej granicy — użyte tylko dla d1, d2. | **częściowo zamknięte — A4 (`roundTrip`; `statedDriving` nadal bez górnej granicy).** `DocLeg.roundTrip: boolean`; `statedDriving.durationMaxMin`. |
| „Pieszo z Mestii albo terenówką” | `legs[].mode = hike`, terenówka w `alternative` (tekst) | Alternatywa przejazdu to wolny tekst, bez trybu i czasu. | **zamknięte — A4.** `alternative` jako `{ mode, durationMin?, instructions? }` albo lista legów-alternatyw. |
| „W poniedziałki jaskinie, kaniony i muzea zwykle zamknięte” | `constraints[c-poniedzialki]` (`other`, d6) + zadanie + notatka | Reguła zamknięć według dnia tygodnia dla kategorii miejsc nie ma struktury; `must_be_open` wymaga konkretnego punktu i godzin otwarcia, których dokument nie podaje. | Strukturalne `openingHours` w `DocPlace` (np. `closedWeekdays`) albo `ConstraintKind: 'weekday_closure'` z kategorią. |
| „Rezerwować zimą (szczyt sezonu)” | `tasks[t-apartament-morze]` bez terminu, „zimą” w `body` | `TaskDue` nie ma przybliżonego okna („zimą”, „do końca lutego”). | `TaskDue { kind: 'window', from?, to, label }`. |
| „Bez wjazdu do centrum Batumi” | `constraints[c-bez-batumi]` (`other`) + tytuł punktu | Brak rodzaju „omijać obszar” (przydatne przy wyznaczaniu trasy). | `ConstraintKind: 'avoid_area'` z miejscem/obszarem. |
| Nagłówek „5 osób”, wersja „v4” | `trip.summary`, `trip.version` | Wersja jest tylko w nazwie pliku. | — |

## Niespójności w dokumencie

- **Odbiór auta:** plan dnia 4.08 mówi „odbiór auta ok. 21:45”, a „Do ustalenia” — „minivan … z odbiorem na lotnisku ok. 21:30”. W `plan.json`: rezerwacja `minivan` od 21:30, punkt `d1-odbior-auta` ok. 21:45.
- **Nocleg w Zugdidi (1 noc):** brak nazwy, kandydata i ceny. Dzień ma tylko bazę `zugdidi`.
- **Baza „Szekwetili” a kandydaci:** dwaj kandydaci są w Ureki, jeden w Kobuleti („poza odcinkiem Ureki–Szekwetili”); zadanie mówi „apartament z basenem w Szekwetili”, a żaden kandydat nie jest w Szekwetili.
- **Skład grupy:** „5 osób”, ceny „dla 5 dorosłych”, ale plusy noclegów to „osobne łóżka dla dzieci” i „plac zabaw” — wiek uczestników nieznany; ceny przy dzieciach mogą być inne.
- **B&B Cottages:** „Tylko gotówka, przed przyjazdem” — nie wiadomo, jak zapłacić gotówką przed przyjazdem (zaliczka? płatność przy zameldowaniu?).
- **DeltaHotel:** odległość do plaży „kilka minut wg gości” vs „Booking: 1,5 km”; ocena 9,0 z zaledwie 3 opinii. Mimo to rekomendowany.
- **Winterfell:** bezpłatne odwołanie tylko do 6.07.2027 (miesiąc wcześniej niż inni) i „ostatnie domki na te daty” — decyzja musi zapaść wcześniej, niż sugeruje kolejność dokumentu. Liczba łazienek zależy od tego, który domek zostanie.
- **Majestic:** apartament „dla 5 os.” 32 m² z 1 łóżkiem podwójnym + sofą — dla 5 osób to 3–4 miejsca do spania; stąd pewnie wariant 2 pokoi za ok. 2 870 zł. Cena porównawcza w tabeli (2 011 zł) jest więc zaniżona.
- **Status lotów i auta:** dokument podaje godziny lotów Wizz Air, ale nie mówi, czy są kupione; minivan jest „do ustalenia”. Brak numerów lotów.
- **10.08:** wyjazd 8:30 + 3 h + 1 h = 12:30, czyli start kanionu bez żadnego zapasu na postoje; kanion do 14:30 + 1,5 h = 16:00, zameldowanie „ok. 16:30”.
- **Zamiana dni w górach (6–9.08) a poniedziałki:** 9.08 to poniedziałek. Po zamianie dni wg pogody Muzeum Swanetii (w planie 6.08) może trafić na poniedziałek, kiedy muzea „zwykle są zamknięte”.
- **Zameldowanie „od 15:00”** podane w planie dnia, niezależnie od kandydata — nie wiadomo, czy dotyczy obu ofert w Mestii.
- **Park dendrologiczny** bez nazwy i lokalizacji; **rafting** bez operatora i ceny; **terenówka z kierowcą** (Uszguli, Koruldi) bez dostawcy i ceny — żadna z tych rzeczy nie jest w „Do ustalenia”.
- Brak cen atrakcji, budżetu i kursu GEL — w dokumencie są tylko ceny noclegów w zł.

## Ocena

Na telefonie w trakcie wyjazdu potrzebne są: oś dnia, przejazdy z czasami, loty w dwóch strefach, odbiór i zwrot auta, nocleg dnia oraz reguła zamiany dni w górach. Wszystko to mieści się w schemacie. Słabe miejsca to nocleg dnia przy niewybranym kandydacie, legi bez przypisania do dnia i reguła zamiany dni jako sam tekst. **GO** — pod warunkiem, że przed wyjazdem kandydat zmieni się w `booked` i trafi do `days.lodgingBookingRef`; `DocLeg.dayRef` i `DocBooking.variantRef` warto dodać przed PoC-1.

## Migracja do poprawek A1–A9 (31.10.2026)

Co się zmieniło w `plan.json`:

- **A1:** wylot 15:40 (4.08) i przylot 23:30 (15.08) to osobne punkty z `time.tz: Europe/Warsaw` (`d1-wylot`, `d12-przylot-wroclaw`). Dni nadal są w `Asia/Tbilisi`.
- **A3:** każdy punkt z dniem ma `sortKey` („0010”, „0020”…) zgodny z kolejnością w dokumencie. Kolejność „wymeldowanie rano” vs „ostatnia kąpiel” w 15.08 dokument zostawia otwartą — przyjęto kąpiel, potem wymeldowanie.
- **A4:** cała kolumna „Przejazd” to teraz punkty `kind: transport` z `leg` (16 przejazdów + 2 loty). Łańcuch 10.08 to trzy punkty po kolei: Mestia → Zugdidi (08:30), Zugdidi → Martwili, kanion, Martwili → Szekwetili. Łańcuch 15.08 tak samo. Uszguli ma `roundTrip: true`, Koruldi ma `alternative: { instructions: "Terenówką na górę…" }`. Kolekcja `legs` jest pusta: w Gruzji nie ma przejść niejawnych.
- **A5:** kandydaci noclegów mają daty: Mestia 2027-08-05 → 2027-08-10, morze 2027-08-10 → 2027-08-15 (bez godzin). Minivan ma start ok. 21:30 z `precision: approx`.
- **A7:** każdy kandydat ma `variantRef` do swojego wariantu w tabeli porównania. B&B Cottages i DeltaHotel mają `recommended: true`. Śniadanie w B&B Cottages to `addons` z ceną 46 zł/os. Dni 5–9.08 mają `lodgingRef: vg-nocleg-mestia`, dni 10–14.08 — `vg-nocleg-morze`. Zameldowanie i wymeldowanie mają `bookingRef` wskazujący grupę.
- **A8:** loty mają `status: unknown`. Minivan zostaje `to_book`, bo jest w „Do ustalenia”. Kandydaci noclegów mają `candidate`.
- **A9:** pola przemianowane na `variantRefs`/`replacesRefs`. Wariant lżejszy Koruldi ma `excludesRefs: [d5-koruldi]`. Przy pozostałych wyborach (Uszba/Tetnuldi, Tsitsinatela/park, rafting) punkty są przypisane do wariantów i nic nie wyrzucają.
- **A2, A6:** nie dotyczą (brak godzin względnych i `in_package`).

Co nadal się nie mieści:

- Lot to dwa punkty (wylot i przylot). `ItemTime` ma jedną strefę na `start` i `end`, więc lot przez strefy nie zmieści się w jednym punkcie.
- Brak numeru nocy („noc 3/5”). Cena dodatku nie ma podstawy „za osobę za dzień”.
- Status punktów w nierozstrzygniętej grupie (`candidate` vs `scheduled`) nadal nie ma reguły.
- Ponadto nadal otwarte: łóżka, powierzchnia i konfiguracje oferty (`units`), tylko gotówka / tylko karta, gwiazdki hotelu, zamiana dni wg pogody (`dayRefs[]`), „dla chętnych”, zamknięcia w poniedziałki, termin „zimą”, `Price.sourceRef`.
