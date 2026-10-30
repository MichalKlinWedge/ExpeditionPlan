# Barcelona 5–7 grudnia — luki schematu (PoC-0)

Źródło: `exaples/Barcelona 5–7 grudnia – plan wyjazdu.docx` → `plan.json` (TripDocument, schemaVersion 1).

| Element dokumentu | Gdzie trafił | Problem | Propozycja zmiany schematu |
|---|---|---|---|
| Wiersze transportu z godziną („~09:30 Pociąg R2 Nord…”, „~16:00 Metro L5…”) | Zdublowane: punkt `kind: transport` z godziną i `bookingRef: t-casual` **oraz** `legs[]` z linią, częstotliwością i `ticketBookingRef` | `DocLeg` nie ma godziny ani dnia, a punkt nie wskazuje swojego legu. Te same dane są w dwóch miejscach i mogą się rozjechać. | **zamknięte — A4.** `DocLeg.dayRef` + `time: ItemTime` (wtedy punkt transportowy niepotrzebny) albo `DocItem.legRefs[]`. |
| „Metro L5 do Diagonal, przesiadka na L3 do Espanya (ok. 25 min)” | Jeden leg, `line: "L5 → L3"`, przesiadka w `instructions` | Brak segmentów: przesiadka jest tekstem, czas tylko łączny. | **zamknięte — A4.** `DocLeg.segments?: [{ mode, line, from, to, durationMin? }]`. |
| „metro L4 do Jaume I albo 20 min pieszo”; „następny za ok. 30 min albo Aerobus z Pl. Catalunya” | `legs[].alternative` (tekst) | Alternatywa przejazdu bez trybu, czasu i miejsca startu (Aerobus jedzie z innego miejsca). | **częściowo zamknięte — A4 (obiekt z trybem i linią; miejsce startu Aerobusu nadal w tekście, tylko jedna alternatywa).** `alternative` jako `{ mode, line?, fromRef?, durationMin?, instructions }[]`. |
| Koszt „T-casual” w kolumnie „Koszt / os.” | Rezerwacja `t-casual` (`transit_pass`, `to_book`), punkty `bookingRef` + `payment: prepaid`, legi `ticketBookingRef` | Dokument nie podaje ceny, liczby karnetów ani tego, czy są kupione — `status` musiał zostać założony (`to_book`). `payment: prepaid` to przybliżenie „w ramach karnetu”. | **częściowo zamknięte — A8 (`unknown`; „pokryte karnetem” nadal jako `prepaid`).** `status: 'unknown'`; `DocItem.payment: 'pass'` (pokryte karnetem). |
| „Plecaki u znajomej, a jeśli się nie da, skrytka przy Pl. Catalunya — 0 € / 5–8 €” | `vg-plecaki` (`availability`), 2 warianty, 2 punkty (drugi `alternative` + `replacesRef`) | Mieści się. Cena skrytki 5–8 € jest w kolumnie „/os.”, ale skrytki zwykle płaci się za schowek — `basis: per_person` przepisany z dokumentu, niepewny. | — (patrz niespójności). |
| Dach Arenas: „ok. 1 € winda, schodami ruchomymi gratis” | `price` 0–1 € `approx` + `note` | Przedział udaje niepewność, a to dwa sposoby wejścia z różną ceną. | `Price.options?: [{ label, amountMinor }]` (nie tylko progi wiekowe). |
| Sagrada: „26 € (do 30 lat 24 €)” | `price.tiers`: „do 30 lat” `maxAge: 29` = 24 €, „od 30 lat” `minAge: 30` = 26 € | „Do 30 lat” można czytać jako ≤ 30 albo < 30 — granice w `PriceTier` są włącznie, więc wybrano 29. Brak progu dla dzieci (dokument go nie podaje). | `PriceTier.maxAgeExclusive` albo opis granicy; ewentualnie warunki niewiekowe (student, karta). |
| „Do 18:00 wejście do muzeum jest gratis po rezerwacji online” (MNAC) | `constraints[c-mnac-gratis]` (`other`, 18:00) + notatka w punkcie | Cena zależna od godziny i rezerwacji — brak warunku w `Price`; brak zadania, bo dokument nie mówi, czy wchodzicie do muzeum. | `Price.conditions?: [{ until?: LocalTime, requiresReservation?: boolean, amountMinor }]`. |
| „Na zachód słońca (ok. 17:20) jesteście na Montjuïc” | `constraints[c-zachod-montjuic]` `arrive_before 17:20` (soft) | Godzina zachodu wpisana na sztywno; schemat nie ma ograniczenia względem zjawiska (silnik liczy słońce sam wg §0.2). | `ConstraintKind: 'at_sunset'` / `before_sunset` z `minutes`. |
| „Font Màgica, ale tylko jeśli tego dnia działa” + plan awaryjny | `vg-font-magica` (`closure`), 2 warianty, punkt alternatywny `d1-gotyk-kolacja` z `replacesRef` | Mieści się. Brak miejsca na „gdzie sprawdzić, czy działa” i terminu decyzji (`decideBy` nieznany). | — |
| Barça Store w sobotę, a jeśli się nie uda — przy stadionie w niedzielę | `d2-barca-store-stadion` `alternative` + `replacesRef: d1-barca-store` | `replacesRef` znaczy „zamiast X”, a tu to plan awaryjny w innym dniu, uruchamiany warunkiem „jeśli nie kupione”. Grupa wariantów ma tylko jeden `dayRef`. | `DocItem.condition?: { kind, text, dependsOnRef }` albo grupa wariantów bez dnia z wariantami w różnych dniach. |
| Stadion Olimpijski „się nie mieści” + powód + „opcja B” w niedzielę | Punkt w puli `p-stadion-olimpijski` (`does_not_fit`, powód w `description` i notatce `rationale`) oraz osobny punkt `d2-b-montjuic` w wariancie B | Brak pola na powód statusu; pula i jej zaplanowana alternatywa to dwa niezależne punkty bez powiązania. | `DocItem.statusReason`; `DocItem.poolRef` (z której pozycji puli pochodzi punkt). |
| Kolejność opcji A bez godzin (Katedra → Fira → … → Barceloneta), Muzeum Picassa bez miejsca w kolejności | Osobne punkty bez `time`, kolejność = kolejność tablicy | W dokumencie nie ma `sortKey` — kolejność przetrwa tylko dzięki kolejności w JSON. | **zamknięte — A3.** `DocItem.order` / `sortKey`. |
| Wiersz „wieczór” z czterema czynnościami (metro, zameldowanie, Barça Store, lokal kolegi) | 4 punkty `part_of_day: evening` | Kolejność wewnątrz „wieczoru” (sklep przed czy po zameldowaniu) nie wynika z dokumentu. | **zamknięte — A3 (kolejność zapisana; dokument jej nie rozstrzyga).** j.w. `order`. |
| Zameldowanie u znajomej „wieczorem” | Rezerwacja `nocleg-znajoma` bez `start` (tylko `end` 7.12 11:00 i `checkOutUntil`) | `ZonedLocal` wymaga godziny; „wieczór” nie da się zapisać w rezerwacji. | **częściowo zamknięte — A5 (data bez godziny; „wieczór” nadal tylko w notatce).** `start`/`end` jako `{ date, time?, partOfDay?, tz }`. |
| Gospodyni („znajoma”) bez telefonu | `contacts[kontakt-gospodyni]` (`host`) | Mieści się; dokument nie podaje danych kontaktowych (i tak byłyby anonimizowane). | — |
| Święto 6.12 (Dzień Konstytucji) — sklepy zamknięte; pierwsza niedziela miesiąca — muzea gratis | Notatki dnia `d2` (`warning`, `tip`) | Święta mają być liczone (§0.2), ale „pierwsza niedziela = muzea gratis” to reguła miejsc, nie dnia — silnik jej nie sprawdzi. | `DocDay.holiday?: { name }` dla importu; reguły darmowego wstępu w `DocPlace` (np. `freeEntry: 'first_sunday'`). |
| „Bramki i kontrola zajmują czas”, wyjazd 15:00 na mecz 17:00 | Notatka w punkcie `d2-wyjazd-mecz` i `d2-mecz` | Brak ograniczenia „być X min przed” — dokument nie podaje liczby minut. | `arrive_before` z `minutes` względem punktu (już jest `minutes`, ale bez wartości w źródle). |
| „Godziny pociągów sprawdźcie dzień wcześniej na rodalies.gencat.cat” | Zadanie `t-pociagi` (`before_item`, 1 dzień) + `sources[src-rodalies]` + notatka | `DocTask` nie ma linków — adres tylko w `body`/źródle. | **częściowo zamknięte — A4 (link do Rodalies w `leg.links` punktu `d3-pociag`; zadanie nadal bez linków).** `DocTask.links[]`. |
| „Najbliższy przystanek sprawdźcie w aplikacji TMB” | Zadanie `on_trip`, `sources[src-tmb]` bez URL | Mieści się. | — |
| Przylot „09:00 Lądowanie na T2” | Rezerwacja `lot-tam` tylko z `end` | Mieści się (start opcjonalny); brak danych w źródle. | — |
| Mecz jako stały punkt | Punkt `d2-mecz` (`exact 17:00`, `isFixed`, `priority: must`) + rezerwacja `mecz` (`ticket`) | Mieści się; status biletów `booked` przyjęty z `brief.json`, dokument go nie podaje. | `status: 'unknown'`. |

## Niespójności w dokumencie

- **Imię gospodyni** występuje w źródle — w `plan.json` zastąpione przez „znajoma / gospodyni”.
- **Lot tam:** podane tylko lądowanie na T2 o 09:00 — bez lotniska wylotu, przewoźnika, numeru i godziny wylotu. Lot powrotny W6 1812 ma komplet.
- **Status biletów:** dokument nie mówi, czy bilety na mecz, Sagradę (wejście na konkretną godzinę 14:30–16:00) i T-casual są kupione. Dla Sagrady nie ma rezerwacji ani zadania, choć wejście jest na godzinę.
- **Skład grupy:** forma „wy”, bez liczby osób i wieku — próg „do 30 lat” w Sagradzie nie da się policzyć.
- **Skrytka 5–8 €** w kolumnie „Koszt / os.” — nie wiadomo, czy za osobę, czy za schowek.
- **Lokalizacja noclegu** tylko pośrednio (Jaume I na L4, „spacer pieszo od drzwi noclegu” na Gotyk); w sobotę wieczorem metro jedzie do Liceu, a w poniedziałek rano odjazd z Jaume I.
- **17:45 → 20:00:** po Arenas ponad 2 h bez planu przed Font Màgica; plan awaryjny („od razu na Gotyk”) zakłada, że ta luka zniknie. Barça Store wypada dopiero po 20:00 (po fontannie) — sklep może być już zamknięty.
- **Niedziela 6.12 to święto, „większość sklepów zamknięta”** — a plan awaryjny na koszulki to Barça Store przy stadionie w niedzielę; otwarcie w święto nie jest potwierdzone.
- **Mecz 17:00, powrót „~19:00”:** mecz z przerwą trwa ok. 2 h, więc wyjście ze stadionu o 19:00 nie zostawia zapasu na tłok przy metrze, o którym dokument sam ostrzega.
- **Stadion Olimpijski:** „otwarty 10–17” w opcji B i „zimą do 17:00” w uwadze są spójne; zdanie „Barça już tam nie gra” zakłada, że mecz jest na Camp Nou — dokument nie podaje adresu stadionu meczu.

## Ocena

Na telefonie w trakcie wyjazdu potrzebne są: oś dnia z godzinami różnej precyzji, przejazdy z linią, częstotliwością i biletem, warunkowe punkty z planem awaryjnym, opcje A/B, stały mecz, wylot i kontakt z gospodynią. Wszystko to mieści się w schemacie. Uwiera dublowanie punkt + leg (leg bez godziny) i kolejność punktów bez godzin oparta tylko na kolejności w tablicy. **GO**.

## Migracja do poprawek A1–A9 (31.10.2026)

Co się zmieniło w `plan.json`:

- **A1:** przylot do Wrocławia 12:35 to osobny punkt `d3-przylot-wroclaw` z `time.tz: Europe/Warsaw`.
- **A3:** wszystkie punkty dni mają `sortKey`, w tym opcja A bez godzin (Katedra → Fira → Sant Felip Neri → Plaça Reial → El Born → Santa Maria → Barceloneta → Picasso na końcu, bo dokument nie podaje jego miejsca) i cztery czynności „wieczoru”. Alternatywy (skrytka, powrót na Gotyk, opcja B) dostały klucze tuż po punktach, które zastępują.
- **A4:** każdy wiersz transportu z osi dnia to punkt `kind: transport` z `leg`:
  - linia, częstotliwość i `ticketBookingRef: t-casual`;
  - przesiadka L5 → L3 i „V17 + 10 min pieszo” jako `segments`;
  - „20 min pieszo” i Aerobus jako `alternative` (obiekt);
  - link do Rodalies w `leg.links`.

  Zdublowane legi usunięte. W `legs` zostało jedno przejście niejawne: Santa Maria del Mar → Barceloneta, 10 min pieszo. „Zejście pieszo do Sagrady (ok. 40 min)” ma w tym dokumencie własny wiersz z godziną ~12:45, więc zgodnie z regułą A4 jest punktem, a nie legiem — choć komentarz w schemacie podaje je jako przykład przejścia niejawnego.
- **A5:** nocleg u znajomej: start 2026-12-05 bez godziny („wieczorem”), koniec 2026-12-07 11:00. Loty i mecz mają `{ date, time, tz }`.
- **A8:** T-casual ma `status: unknown`. Loty, mecz i nocleg zostają `booked` (zgodnie z `brief.json`).
- **A9:** pola przemianowane na `variantRefs`/`replacesRefs`. „Skrytka” ma `excludesRefs: [d1-plecaki]`, „fontanny nie działają” ma `excludesRefs: [d1-font-magica]`. Punkty domyślne (plecaki u znajomej, Font Màgica) nie są przypięte do wariantu.
- **A2, A6, A7:** nie dotyczą (brak godzin względnych, pakietów i kandydatów rezerwacji). `days.lodgingRef` wskazuje rezerwację `nocleg-znajoma`.

Co nadal się nie mieści:

- Ceny warunkowe i opcje cenowe: Arenas (winda / schody), MNAC (gratis do 18:00 po rezerwacji), granica „do 30 lat”.
- Plan awaryjny w innym dniu (Barça Store) opiera się tylko na `replacesRefs`. Powód `does_not_fit` nie ma pola.
- „Pokryte karnetem” jest zapisane jako `payment: prepaid`. Nie ma ograniczenia „na zachód słońca” ani „być X min przed bramkami”.
