# Chatka Sylwestrowa — luki schematu (PoC-0)

Źródło: `exaples/Plan - Chatka Sylwestrowa 24-25.10.2026.docx` → `plan.json` (TripDocument v1).
Uczestnicy zanonimizowani: Dorosły A–E, Dziecko A1, B1, C1–C3, D1 (rodziny A–E).

## Luki

| Element dokumentu | Gdzie trafił | Problem | Propozycja zmiany schematu |
|---|---|---|---|
| Szpica: „2 dorosłych + Dziecko B1 i Dziecko D1”; grupa główna: „3 dorosłych + 4 dzieci” | `items` `szpica-*`, `grupa-glowna-*` z `participantRefs` tylko dzieci; dorośli w `notes` | Dokument mówi *ilu* dorosłych, ale nie *których* („skład szpicy” jest w Do ustalenia). `participantRefs` nie unosi „2 nieprzypisanych dorosłych” — lista wygląda na kompletną, a nie jest | `participantSlots: [{ role: 'adult' \| 'child', count }]` obok `participantRefs`, albo kolekcja `travelerGroups` (szpica, grupa główna) z liczebnością i częściowym składem |
| Ekipy po dojściu (Drewno / Ogień / Kuchnia / Latryna), 14:15–16:00 | parasol `praca` + 4 punkty `ekipa-*` z tym samym przedziałem i `participantRefs` (dzieci); „część bloku PRACA” w `notes` | Brak relacji rodzic–dziecko między punktami i równoległych ścieżek dnia — oś czasu pokaże 5 punktów nałożonych na siebie. Dorośli w ekipach znów nieprzypisani | **zamknięte — PoC-5:** `parentRef: "praca"` w czterech ekipach; silnik liczy je równolegle w czasie bloku. Otwarte: `participantSlots` (nieprzypisani dorośli). Alternatywnie zadania `on_trip` z `assigneeRefs` — ale tu też brak „1 dorosły, jeszcze nie wiadomo który” |
| Twardy cel „w chatce najpóźniej o 14:00–15:00” | `constraints` `c-chatka-14` (soft) + `c-chatka-15` (hard) | Ograniczenie ma jedną godzinę; przedział trzeba rozbić na dwa wpisy | `timeEnd` albo `window: { from, to }` w `DocConstraint` (dolna granica = cel, górna = twardy limit) |
| „Od 18:20 ciemno — wszyscy w chatce albo w zasięgu wzroku” | `constraints` `c-ciemno-1820`, `kind: other` | Brak rodzaju „wszyscy w bazie od godziny X” (curfew) — silnik nie sprawdzi `other` | `ConstraintKind`: `be_at_base_by` / `curfew` (z odwołaniem do zmierzchu zamiast stałej godziny) |
| Nocleg w chatce — niekomercyjny, bez rezerwacji, „kto pierwszy, ten lepszy” | `bookings` `nocleg-chatka`, `status: not_required`, cena 0, daty bez godzin | **zamknięte — A8, A5.** (Było: `status: idea` i godziny start/end wzięte z harmonogramu) | ewentualnie `availabilityRisk: text` |
| Plan B (schronisko) i rezerwa absolutna, decyzja do 15:00 | `variantGroups` `vg-plan-b` (`scope: day`, `availability`, `decideBy: {time: '15:00'}`), warianty A/B/C, punkty `alternative` z `replacesRef` | Pasuje dobrze. Jedyny brak: decyzja zapada w terenie, gdy szpica dotrze (13:10) — nie ma powiązania „wyzwalacz = punkt X” | opcjonalne `triggerItemRef` w `DocVariantGroup` |
| Deszcz („to nadal OK”), mgła, ktoś odpada, zapas czasu | `vg-deszcz` (1 wariant, `chosenRef`), `vg-mgla` (3), `vg-ktos-odpada` (2), `vg-zapas-sobota` (2) | Deszcz to procedura awaryjna, a nie wybór — grupa z jednym wariantem jest sztuczna | `DocNote.kind: 'contingency'` z `conditionKind` + `trigger`, albo dopuszczenie grupy bez wariantów z polem `actions` |
| „Ktoś odpada” — dotyczy dowolnej jednej osoby | `vg-ktos-odpada` | Warianty nie wiedzą, kogo dotyczą (osoba wybierana w chwili zdarzenia) | brak zmiany w PoC; w M12 akcja „wybierz uczestnika” przy materializacji wariantu |
| Opiekunowie dzieci | `travelers[].guardianRef` wg tabeli rodzin; pytanie w `tasks` `u-opiekunowie` | Dokument pokazuje rodziny, ale w Bezpieczeństwie mówi „ustalamy, który dorosły odpowiada za które dziecko” — `guardianRef` może być nieostateczny. Opieka zmienna per punkt (spacer: dorośli na początku i na końcu; strych: „kto z dorosłych z nimi”) | `guardianRef` per punkt (`DocItem.guardians: [{ childRef, adultRef }]`) albo para „buddy” w punkcie |
| Wiek dzieci „5–13 lat”, najstarsi: B1, D1, C1 | tylko `age: 5` u Dziecka C3; reszta w `notes` | Dokument nie podaje wieku poszczególnych dzieci — progi wiekowe cen i „dla 6-latka” nie mają danych | brak (luka w danych); import powinien utworzyć zadanie „uzupełnij wiek” |
| Podział na auta, dojazd własny | `tasks` `u-godzina-zero-auta` | Brak kolekcji pojazdów | `vehicles` (spec: C) — `label`, `driverRef`, `passengerRefs`, `seats` |
| Dojazd 130 km, 2:15–2:30 z przerwą w Bystrzycy | punkt `zbiorka-wyjazd` (`kind: transport`, `leg`: 130 km, 135–150 min, skąd/dokąd), `days.d1.statedDriving` = 130 km / 135 min | **częściowo zamknięte — A4** (przejazd jest w osi dnia, `leg.links` i `durationMaxMin` są). Zostaje: `statedDriving` bez górnej granicy, brak punktów pośrednich (Bystrzyca); wiersz „zbiórka i wyjazd” stracił rodzaj `meetup` | `statedDriving.durationMaxMin`; `leg.via: Ref[]` |
| Trasa 1 do chatki: brak szlaku, opis rozdroży, „811 m → 780 m”, 45 min / 1:00–1:15 z plecakami | `tracks` `trasa-chatka`: `descentM: 31` (wyliczone), `durationMin/MaxMin` 45–75, opis w `routeNotes` | Dwa czasy zależne od obciążenia zlane w przedział; wysokości start/meta tylko w tekście; brak śladu (GPX/geometrii) — a to on decyduje, czy chatkę da się znaleźć po ciemku; „do zweryfikowania” tylko w tekście | `DocTrack`: `gpxPath` / `geojson` (spec ma je w tabeli `tracks`), `startElevationM`/`endElevationM`, `durations: [{ label, min, max }]`, `verified` + `checkedAt` |
| Trasa 2 na Jagodną: 4,2 km w jedną / 8,4 km w obie, 1:30 w górę, 3:00–3:30 całość | `tracks` `trasa-jagodna` (8,4 km, 180–210 min) + punkty wejścia/zejścia z `activity` | Brak pojęcia „tam i z powrotem” — czas w jedną stronę tylko w punktach | `DocTrack.shape: 'one_way' \| 'out_and_back' \| 'loop'` + `oneWayKm`, `ascentDurationMin` |
| Chatka bez współrzędnych („jest na mapy.cz”), parking z pinezką | `places` `chatka` (`provider: unknown`), `parking-spalona` (`provider: user`, 50.2767, 16.5373) | Najważniejszy punkt wyjazdu nie ma pinezki w dokumencie (nie zgadywałem). Po geokodowaniu (31.10.2026) OSM zna „Chatkę Sylwestrową” — `provider: osm`, ok. 1,8 km od schroniska, zgodnie z opisem w dokumencie | Walidator importu: miejsce noclegu / cel trasy bez `lat/lng` → automatyczne zadanie „dodaj punkt” |
| Menu: posiłki + „Kto bierze” | posiłki jako `items` `meal` (menu w `description`, „Kto bierze” w `notes`); produkty jako `packing` kategoria „Prowiant” bez `assigneeRef` | Brak powiązania produktu z posiłkiem; „każdy swoje” vs „do ustalenia” vs „gotówka” to trzy różne znaczenia tej samej kolumny | `DocPackingItem.itemRef` (do którego posiłku), `assigneeRef` + stan `unassigned` / `everyone`; posiłek płatny → `payment` (użyte `cash_only`) |
| Woda: 2,5 l/os./dobę × 11 os. ≈ 28 l; 3 baniaki 5 l + butelki | `packing` „Woda” `quantity: 28, unit: 'l'` + notatka | Liczba wpisana na sztywno — zmiana składu grupy jej nie przeliczy | `DocPackingItem.perPerson: { quantity, unit, perDay }` — silnik liczy z uczestników i długości |
| Pakowanie osobiste różne dla dzieci i dorosłych (plecak 20–30 l vs 50–65 l, cieplejszy śpiwór dla dzieci, gwizdek tylko dzieci) | `packing` `scope: personal`, różnice w `note` | Brak rozróżnienia odbiorcy — odhaczanie per osoba pokaże gwizdek dorosłym | `DocPackingItem.audience: 'all' \| 'adult' \| 'child'` (lub `minAge/maxAge`) |
| Sprzęt wspólny do podziału („kto bierze co” otwarte) | `packing` `scope: shared` bez `assigneeRef` + `tasks` `u-sprzet-wspolny` | Pasuje. Duplikat tabeli „Wspólny sprzęt” z sekcji Transport pominięty | — |
| Wrzutka „ok. 150 zł na rodzinę” | `budgetLines` `b-wrzutka-chatka`, `perPerson: false` + `note` | Brak podstawy „na rodzinę” — kwota dla grupy (5 × 150) nie wyliczy się | `basis: 'per_household'` w `Price` i `perHousehold` w `DocBudgetLine` (spec ma `split_mode: households` w wydatkach, ale nie w budżecie) |
| Parking (płatny?), obiad w schronisku, paliwo („zebrać kasę”) | tylko `notes` / `tasks` | `DocBudgetLine` wymaga kwot — pozycji „koszt nieznany” nie da się wpisać | `lowMinor/highMinor` opcjonalne przy `status: 'unknown'` (albo `amountUnknown: true`) |
| Słońce, Księżyc 98%, zmiana czasu 3:00 → 2:00, „17:45 zachód” w osi soboty | `notes` dnia (`topic: time`); nie jako punkty | Zgodnie ze spec liczone lokalnie, ale wpis „3:00 → 2:00” z osi soboty dzieje się 25.10 — nie ma gdzie go zostawić jako znacznika | Brak zmiany (silnik liczy). Ewentualnie `DocItem.kind: 'marker'` dla wpisów informacyjnych w osi |
| Dyżur przy piecu „cała noc”, rotacja co ~2 h | `items` `dyzur-piec`, `part_of_day: night`, wszyscy dorośli | Punkt przez północ (z d1 na d2, przez zmianę czasu) nie ma końca; grafik rotacji tylko w tekście | `ItemTime.end` jako `LocalDateTime` / `endDayOffset`; ewentualnie `rota: [{ from, to, travelerRef }]` |
| „Młodsi do śpiworów” 22:30 | `items` `mlodsi-spac`, `kind: lodging` | Brak rodzaju na sen/odpoczynek | `ItemKind: 'rest'` |
| Pula: „z chatki wprost na Jagodną” (raczej odpada), Czerniec i Orlica „na przyszłość” | `items` bez dnia, `planStatus: does_not_fit`, `area` | „Na przyszłość (nie teraz)” to nie „nie mieści się” — to pomysł na inny wyjazd | `planStatus: 'future'` albo eksport do listy pomysłów konta |
| Go / no-go 2 dni przed (prognoza) | `tasks` `t-prognoza` (`decision`, `before_trip: 2`) | `decideBy` wymaga godziny — grupa wariantów „jedziemy / nie jedziemy” bez godziny niemożliwa | `decideBy: { kind: 'before_trip', days }` w `DocVariantGroup` |
| TODO „przed wyjazdem” bez daty | `tasks` z `due: { kind: 'before_trip', days: 1 }` (umownie) | `days` jest wymagane — „kiedyś przed wyjazdem” trzeba zamienić na konkretny dzień | `before_trip.days` opcjonalne (= dowolnie przed startem) |
| Kontakt do schroniska PTTK | `contacts` `kontakt-schronisko` bez numeru | Dokument nie podaje numeru (luka danych) | — |
| Źródła bez daty sprawdzenia + zastrzeżenie o aktualności | `sources` (6, z URL, `appliesToRefs`) + notatka `warning` | `checkedAt` brak w dokumencie | — |
| Obraz w dokumencie (1) | pominięty | Brak miejsca na ilustracje / okładkę | `trip.coverPath` / `attachments` (spec: `trips.cover_path`, `documents`) |

## Niespójności w dokumencie

- **Wiek Dziecka C3:** „5-letni” (Założenia), „(5)” (Uczestnicy), ale „z 6-latkiem” (Trasa 1), „dla 6-latka” (Trasa 2) i „6 lat” (Bezpieczeństwo). W `plan.json` `age: 5` + notatka.
- **Liczba dorosłych w ekipach:** Drewno 3 + Ogień 1 + Kuchnia 1 + Latryna 1 = **6 dorosłych**, a grupa ma 5.
- **Czas dojazdu:** „ok. 130 km, 2:15–2:30 z jedną przerwą”, a harmonogram 8:00 → 11:30 daje 3:30 (z przerwą 10:15 w Bystrzycy). Zapas niejawny.
- **Szpica:** wyjście 12:30, w chatce 13:10 = 40 min, a Trasa 1 podaje „45 min bez bagażu”.
- **Skład szpicy:** harmonogram już przypisuje Dziecko B1 i Dziecko D1, a „skład szpicy — kto idzie po miejsca” jest w Do ustalenia.
- **Opiekunowie:** tabela Uczestnicy łączy dzieci z dorosłymi w rodziny, a Bezpieczeństwo mówi „ustalamy, który dorosły odpowiada za które dziecko”.
- **Woda:** 3 × 5 l = 15 l + 6 dzieci × 1 l = 21 l; „razem ok. 28 l” wymaga ok. 7 l w butelkach dorosłych — nie wynika to z tekstu. Do ustalenia pyta „dorośli po 5 l?” (5 × 5 l = 25 l), a sekcja Woda mówi o 3 baniakach niesionych przez dorosłych.
- **Zmiana czasu 3:00 → 2:00** wpisana w oś soboty, choć następuje w niedzielę 25.10.
- **Kolumna „Kto bierze” w menu** miesza trzy znaczenia: osoba (do ustalenia), „każdy swoje”, „gotówka” (sposób płatności).
- **Wspólny sprzęt** wymieniony dwa razy (tabela w Transporcie i lista w Sprzęcie), w nieco innym brzmieniu.
- **Plan B / TODO:** telefon do schroniska jest jednocześnie w Zakwaterowaniu („TODO przed wyjazdem”) i na liście TODO — w `plan.json` jedno zadanie.
- Literówka „przed wyorawą” (Transport).

## Ocena

Na telefonie w trakcie wyjazdu potrzebne są: oś obu dni z godzinami, kto idzie w szpicy, termin decyzji 15:00 i Plan B, opis dojścia do chatki, pinezka parkingu, numery ratunkowe, zasady bezpieczeństwa, menu i lista wspólnego sprzętu. Wszystko to się mieści. Słabsze miejsca: ślad trasy do chatki (`DocTrack` nie ma geometrii, a dokument i tak nie podaje ani śladu, ani współrzędnych chatki), dorośli bez przypisania do szpicy i ekip oraz przedział 14:00–15:00 rozbity na dwa ograniczenia.

**GO** — schemat unosi plan na telefon. Przed PoC-1 warto dodać `participantSlots` i geometrię śladu w `DocTrack`.

## Migracja do poprawek A1–A9 (31.10.2026)

Co się zmieniło w `plan.json`:

- **A3** — każdy punkt z dniem ma `sortKey` („0010”, „0020”…) w kolejności dokumentu. Warianty awaryjne są na końcu dnia.
- **A4** — przejazdy z osi dnia są punktami `kind: transport` z `leg`: „Zbiórka i wyjazd” 8:00 (auto, 130 km, 135–150 min), wyjście szpicy 12:30 i grupy głównej 12:45 (pieszo, 2 km, 45 / 60–75 min), zejście do parkingu 9:30 (2 km, 45 min) oraz wyjazd 15:30 (auto, 130 km). Usunięte zdublowane nogi `dojazd`, `dojscie-szpica`, `dojscie-grupa` i `powrot`. W `legs` została tylko `odwrot-plan-b` (chatka → schronisko), bo w osi nie ma dla niej wiersza.
- **A5 / A8** — chatka ma `status: not_required` i daty bez godzin (wcześniej `idea` i godziny wzięte z harmonogramu).
- **A7** — `days.d1.lodgingRef` (wcześniej `lodgingBookingRef`).
- **A9** — `variantRef` / `replacesRef` zamienione na listy. Warianty wyrzucają punkty przez `excludesRefs`:
  - „pętla Sasin” → spacer przy chatce;
  - „mgła: skrócona” i „mgła: od razu obiad” → wejście, szczyt i zejście z Jagodnej (obiad także zastąpiony wcześniejszym);
  - Plan B i Plan C → punkty związane z chatką: blok PRACA i 4 ekipy, dyżur przy piecu, sprzątanie, zejście z chatki. To interpretacja importu: dokument nie wylicza, co odpada.
- **A1, A2, A6** — nie dotyczą tego planu: wszystko jest w Europe/Warsaw, nie ma godzin względnych ani `in_package`.

Zamknięte luki z tabeli: nocleg w chatce (A8, A5) i częściowo dojazd (A4). Bez zmian zostają: nieprzypisani dorośli (`participantSlots`), ekipy jako podpunkty bloku, przedział 14:00–15:00 w ograniczeniu, geometria śladu do chatki, podstawa „na rodzinę” i punkt przez północ (dyżur).
