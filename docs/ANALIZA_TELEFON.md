# Analiza aplikacji na telefon — offline i w trasie

Stan kodu: 10.11.2026 (`apps/mobile`, APK 0.3.0). Punkt odniesienia: SPECYFIKACJA §1 („przeżyć wyjazd
z telefonem w ręku, także bez zasięgu”), M6, M7, M13, §6, §9 oraz kryterium odbioru MVP-4 w PLAN_ETAPOWY.
Założenie: **planowanie zostaje na webie**, telefon ma działać w trasie, w trybie samolotowym i przy słabym zasięgu.

Oznaczenia: **OTA** = sama zmiana JS (`npm run ota`), **APK** = nowy moduł natywny albo uprawnienie
(podbicie `version` + `eas build` obu profili).

---

## 1. Co już działa w trasie (offline)

| Obszar | Stan | Offline |
|---|---|---|
| Plan dnia: godziny z silnika, warianty, scenariusz, wschód/zachód, zapas czasu, propozycje cięć | jest | tak (SQLite + `packages/core`) |
| „Teraz / Następny”: +15/+30 min, Zrobione, Pomiń, Cofnij, „Z puli w pobliżu” | jest (tylko organizator/edytor) | tak (outbox `schedule_events`) |
| Mapa wyjazdu i mapa dnia, pozycja GPS, pula na mapie | jest | tak, po „Pobierz offline” (paczki OpenFreeMap, styl zapisany w pliku) |
| Ślady GPX: profil, „gdzie jestem na śladzie”, woda/schroniska/zejścia z OSM | jest | tak (linia i POI w planie) |
| Rezerwacje: termin, kod, warunki, kontakty, „Zadzwoń” | jest | tak |
| Sejf: kod QR/kreskowy na pełnym ekranie, pełna jasność, pliki „offline” z sha256 | jest | tak, tylko dokumenty oznaczone „offline” |
| Przewodnik: tekst, czytanie na głos (`expo-speech`), spacer z powiadomieniem przy miejscu | jest | tekst tak; zdjęcia z pamięci podręcznej; głos zależy od telefonu |
| Wydatki, podziały, rozliczenie, kursy z pliku, budżet dzień po dniu | jest | tak (outbox); paragon przez AI — tylko z siecią |
| Sprzęt i zakupy: odhaczanie, „Biorę” | jest | tak (outbox) |
| Zadania: odhaczanie | jest | tak (outbox, sam status) |
| Dziennik: wpisy i zdjęcia, kolejność, zdjęcia przy punkcie | jest | tak; własne zdjęcia z kolejką wysyłki |
| Info: numery alarmowe, kontakty, notatki, źródła | jest | tak, o ile organizator je wpisał |
| Pogoda dni wyjazdu, alert go/no-go, podpowiedź wariantu na niepogodę | jest | ostatnia pobrana prognoza |
| Przypomnienia lokalne: „za 15 min”, termin decyzji, zadania z datą | jest (wyłączone domyślnie) | tak |
| Głosowanie nad wariantami, „Co nowego”, Posiłki (odczyt) | jest | głos — outbox; „Co nowego” — online |
| Edycja planu, knajpy w pobliżu, dodawanie pozycji sprzętu | jest | **nie** — tylko online (zgodnie z §6) |

Wniosek: zakres funkcji MVP-4 jest w kodzie prawie w całości. Braki dotyczą głównie **odporności**
(słaby zasięg, powrót sieci, aplikacja nieotwierana przez dzień) i **wygody w terenie**, a nie nowych modułów.

---

## 2. Braki krytyczne (P1) — psują założenie „offline w trasie”

### P1.1. Przy słabym zasięgu zakładki Plan, Mapa i Start wiszą na „Wczytuję…” — OTA
`loadMyTrips` (`features/trips/my-trips.ts`) najpierw czeka na `select my_trips` z serwera, a listę z telefonu
zwraca dopiero po błędzie. W trybie samolotowym błąd przychodzi od razu, ale przy jednej kresce zasięgu
(góry, metro, roaming) zapytanie może wisieć dziesiątki sekund — klient Supabase nie ma limitu czasu
(w kodzie nie ma `AbortSignal`/timeoutu). Plan na ekranie pojawia się dopiero potem. To łamie wymaganie
§9 „start do Tu i teraz < 2 s z danych lokalnych”.

Poprawka: lista z `localStorage` od razu, serwer w tle (stale-while-revalidate), plus `fetch` z limitem
(np. 8 s) w `createClient(..., { global: { fetch } })`. To samo dotyczy `StatsCard` na Start.

### P1.2. Zapisy z terenu nie wysyłają się same po powrocie sieci — OTA + APK
Outbox wysyła się tylko przy otwarciu planu, powrocie aplikacji na pierwszy plan i sygnale Realtime.
Zdjęcia dziennika i paragonów (`uploadPhotos`) — tylko po wejściu w zakładkę Dziennik albo Wydatki.
Kto doda wydatki w górach i wróci do zasięgu z aplikacją w tle albo bez wchodzenia w te zakładki, nie wyśle
nic; inni nie widzą wydatków i rozliczenie się rozjeżdża.

Poprawka: (OTA) jedna wspólna pętla „wyślij outbox + zdjęcia”, ponawiana co kilka minut, póki
`pendingCount > 0` albo kolejka zdjęć niepusta, uruchamiana na starcie aplikacji, nie w zakładkach;
(APK) nasłuch sieci (`expo-network`) i zadanie w tle (`expo-background-task`) do wysyłki.

### P1.3. Przypomnienia „za 15 min” mogą przyjść za późno albo wcale — APK + OTA
- W manifeście nie ma `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (`expo-notifications` dodaje tylko
  `POST_NOTIFICATIONS` i `RECEIVE_BOOT_COMPLETED`), więc Android planuje je niedokładnie; w trybie Doze
  opóźnienie bywa kilkunastominutowe. Specyfikacja M13 wprost wymaga dokładnych alarmów „jak w FormaSync”.
- Przypomnienia są domyślnie **wyłączone** (włącza się je w Ustawieniach) — łatwo wyjechać bez nich.
- Oś dnia sięga 25 powiadomień i przelicza się tylko przy starcie/powrocie aplikacji; telefon nieotwierany
  przez dzień nie dostanie przypomnień na następny.

Poprawka: uprawnienie dokładnych alarmów w `app.json` + prośba o nie przy włączaniu (APK); propozycja
włączenia przypomnień przy „Pobierz offline” i przy pierwszym otwarciu trwającego wyjazdu (OTA);
przeplanowanie raz na dobę w zadaniu w tle (APK, razem z P1.2).

### P1.4. „Nawiguj” prowadzi tylko do Google Maps przez https — OTA
Wszystkie przyciski (`on-trip.tsx`, `map-parts.tsx`, `item-details.tsx`, `track-card.tsx`) otwierają
`google.com/maps/dir/?api=1&destination=…` bez trybu podróży. Bez internetu działa to tylko wtedy, gdy ktoś
pobrał ten obszar także w Google Maps (PROBA-OFFLINE §4 to obchodzi instrukcją). Specyfikacja M5 zakłada
wybór Google Maps / mapy.com / OsmAnd — mapy.com i OsmAnd/Organic Maps nawigują offline.

Poprawka: `geo:lat,lng?q=lat,lng(nazwa)` (Android sam pokaże wybór aplikacji, jak już przy POI śladu)
albo zapamiętana „aplikacja do nawigacji” w Ustawieniach; Google Maps z `travelmode` z rodzaju przejazdu
(`walking` dla pieszych, `driving` dla aut, `transit` dla komunikacji).

### P1.5. Pakiet offline nie zawiera wszystkiego, co się ogląda w trasie — OTA
- **Zdjęcia dziennika innych osób** idą przez podpisany URL (`photoUri`) — offline się nie pokażą.
- **Zdjęcia przewodnika** leżą tylko w pamięci podręcznej `expo-image` (`Image.prefetch(…, 'disk')`), którą
  biblioteka może wyczyścić (limit rozmiaru) — pewniej jako pliki w katalogu aplikacji, jak dokumenty sejfu.
- **Dokumenty bez „offline”** znikają bez ostrzeżenia. Przycisk „Pobierz offline” powinien powiedzieć
  „3 dokumenty tej rezerwacji nie są oznaczone offline — na webie: Sejf”.
- Brak **rozmiaru przed pobraniem** i **kontroli wolnego miejsca** (wymóg M7 i §9).
- Brak **przypomnienia „pobierz wyjazd offline”** (np. 2 dni przed startem, gdy pakiet niepełny albo „nowsza
  wersja planu”) — dziś trzeba o tym pamiętać.

### P1.6. Kryterium odbioru MVP-4 nie zostało sprawdzone w terenie — proces
PLAN_ETAPOWY: „zrobione w kodzie, do sprawdzenia testem w terenie”; pomiary PoC-2 (rozmiar paczek, napisy
offline) i PoC-3 (bateria, opóźnienie geofence) nie są zapisane w `docs/POC-2-3.md`. Bez tego nie wiadomo,
czy P1.3 i spacer z przewodnikiem działają na zablokowanym ekranie. Do zrobienia: PROBA-OFFLINE w domu,
potem pełny dzień według kryterium MVP-4; wyniki do `POC-2-3.md` i tego pliku.

---

## 3. Braki ważne (P2) — wygoda i bezpieczeństwo w terenie

| # | Brak | Gdzie | Poprawka | Rodzaj |
|---|---|---|---|---|
| P2.1 | Uczestnik (widz) nie zapisze „+15 min / Pominąć / Zrobione” — tylko organizator i edytor. Gdy telefon organizatora padnie albo idzie on z inną podgrupą, plan grupy stoi. | `now-card.tsx` (`onEvent` przy `canAct`), RLS `schedule_events` | Decyzja: prawo do zdarzeń dnia dla wszystkich uczestników z kontem (zdarzenia są tylko dopisywane, więc bez konfliktów) albo osobna flaga jak `can_add_expenses`. | migracja + OTA |
| P2.2 | Opóźnienie tylko +15 / +30; brak +60, własnej wartości i przesunięcia „następnego” (np. „ruszamy o 10:30”). Spec M6: +15/+30/+60/własna. | `now-card.tsx` | Dodać +60 i „Inne…” (minuty), a przy „Następny” — „później o…”. | OTA |
| P2.3 | Karta „Teraz” w Planie nie ma „Nawiguj” ani przejścia do następnego punktu (linia, odjazdy, czas dojścia) — jest tylko na Start. | `now-card.tsx`, `on-trip.tsx` | Przenieść „Nawiguj: X”, linię i `leg.departures` do karty; jedna wspólna karta dla Startu i Planu. | OTA |
| P2.4 | Małe cele dotyku: `Button small` ma ok. 32 dp; karta „Teraz” używa tylko małych przycisków. Spec §9: ≥ 48 dp, obsługa jedną ręką. | `components/button.tsx` | Rozmiar „terenowy” dla karty „Teraz”, portfela i sprzętu (`minHeight: 48`), najważniejsze akcje niżej. | OTA |
| P2.5 | Zakładka „Spacer” pokazuje wszystkim diagnostykę PoC-3 (log, bateria, „Jestem przy punkcie”). | `app/walk.tsx` | Zostawić „Spacer z przewodnikiem”, diagnostykę schować za przełącznikiem w Ustawieniach. | OTA |
| P2.6 | Data „dziś” w UTC: `pickTrip` i `refreshCurrentReminders` używają `toISOString().slice(0,10)`. W Gruzji (UTC+4) między 0:00 a 4:00 „dziś” to wczoraj — zły wybór trwającego wyjazdu i przypomnień na granicy dnia/wyjazdu. | `my-trips.ts`, `reminders.ts` | `localToday()` z core albo data w strefie pierwszego/ostatniego dnia wyjazdu. | OTA |
| P2.7 | Numery alarmowe tylko z planu — pusto, gdy organizator ich nie wpisał. | `info-view.tsx` | Stała tabela w core: 112 + numery krajów z planu (pogotowie górskie, policja), zawsze na górze Info. | OTA |
| P2.8 | Brak „Gdzie jestem” do przekazania ratownikom: współrzędne dużym tekstem i „Wyślij SMS-em” (SMS działa bez internetu). Ważne przy trekkingach. | Info / ślad | Przycisk w Info i na karcie śladu: pozycja GPS, `sms:` z treścią i linkiem do mapy, kopiowanie. | OTA |
| P2.9 | Polski głos syntezatora nie jest sprawdzany; bez niego „Posłuchaj” milczy albo czyta złym głosem. | `item-details.tsx` | `Speech.getAvailableVoicesAsync()` przy „Pobierz offline”: komunikat „zainstaluj polski głos offline w ustawieniach mowy”. | OTA |
| P2.10 | Zapisy telefonu dla pakowania i zadań wymagają logowania; po wygaśnięciu sesji bez sieci aplikacja przechodzi w „tylko odczyt”. | `session.ts`, `plan.tsx` | Sprawdzić w teście: czy sesja przeżywa tydzień offline; jeśli nie — zapisy do outboxa także bez ważnego tokenu (wysyłka po zalogowaniu). | test, ew. OTA |

---

## 4. Uzupełnienia (P3) — po teście w terenie

- **Odpowiedź na zadanie „pytanie”** z telefonu (`DocTask.answer` jest w schemacie, telefon zmienia tylko status) — np. „czy w chatce jest drewno?” sprawdza się na miejscu.
- **Szybka notatka do punktu / dnia** bez edycji planu — dziś zastępuje ją Dziennik; wystarczy, jeśli wpisy dziennika przy punkcie są widoczne na webie w planie.
- **Przelogowanie na inne konto kasuje outbox** (`forgetLocal` czyści też `outbox`) — ostrzeżenie, gdy coś czeka na wysłanie.
- **Push zdalny** o zmianach od innych (Etap 10) — w trasie przydaje się przy zmianie godziny zbiórki; offline i tak nie dojdzie, więc niżej niż P1.2.
- **Odtwarzacz przewodnika w tle** z kontrolkami w powiadomieniu i kolejką dnia (Etap 8).
- **Widżet „Tu i teraz”** na ekran główny (v1.x).
- **Testy E2E Maestro**: pobranie offline → dzień w trybie samolotowym (Etap 12) — automatyczna wersja PROBA-OFFLINE.

---

## 5. Co świadomie zostaje na webie

Telefonu nie rozbudowywać o: kreator i „Zaplanuj z AI”, Propozycje AI, rezerwacje i import potwierdzeń,
budżet planowany, opisy miejsc (generowanie, zdjęcia), GPX i trasy (wgrywanie, przeliczanie), głosowanie
terminu, zmianę terminu, uczestników i zaproszenia, pokaz/film i Pamiątkę. Obecna edycja planu na telefonie
(online, prosty edytor) wystarcza na drobne poprawki w trasie; edycja offline z kontrolą wersji zostaje w v1.x.

Do rozważenia odchudzenie: wyszukiwanie knajp i edycja planu na telefonie działają tylko z siecią — powinny
mówić to od razu (wyszarzone z „wymaga internetu”), a nie dopiero błędem po zapisie.

---

## 6. Stan poprawek

**Pakiet OTA (10.11.2026), w kodzie, niesprawdzony na telefonie:**
- P1.1 — lista wyjazdów z telefonu od razu, serwer w tle (`loadMyTrips(…, onCached)`); limit czasu zapytań 30 s, pliki 120 s (`lib/supabase.ts`).
- P1.2 (część OTA) — `features/sync/sync-loop.ts`: start aplikacji, powrót na pierwszy plan i co 2 min, gdy coś czeka — outbox, potem zdjęcia; otwarty plan odświeża się i pokazuje odrzucone zapisy.
- P1.3 (część OTA) — po „Pobierz offline” propozycja włączenia przypomnień; przypomnienie „Pobierz wyjazd offline” 2 dni i dzień przed startem o 19:00, dopóki pakiet nie był kompletny.
- P1.4 — `lib/navigate.ts`: tryb podróży z przejazdu, w Ustawieniach „Nawiguj w”: Google Maps albo inna aplikacja (`geo:`).
- P1.5 — zdjęcia przewodnika (`guide-images.ts`), dziennika i paragonów jako pliki; po pobraniu: dokumenty bez „offline”, niepobrane zdjęcia, brak polskiego głosu; szacunek rozmiaru i wolnego miejsca przed pobraniem (pytanie od 20 MB, odmowa przy braku miejsca z zapasem 300 MB).
- P2.2–P2.4 — karta „Teraz”: +15/+30/+60/„Inne…”, w przerwie „Ruszamy później”, „Nawiguj” do następnego punktu z przejściem, duże przyciski (`Button big`, ≥ 48 dp).
- P2.5 — diagnostyka PoC-3 w „Spacer” zwinięta. P2.6 — data telefonu zamiast UTC (`pickTrip`, przypomnienia). P2.7 — 112 zawsze w Info. P2.9 — sprawdzenie polskiego głosu.

**Zostaje:** APK 0.4.0 (dokładne alarmy, `expo-network`, `expo-background-task`), P2.1 (decyzja), P2.8, P2.10, P3, test w terenie.

## 7. Proponowana kolejność

1. **OTA, ~1–2 dni:** P1.1 (cache-first + timeout), P1.2 część OTA (wspólna pętla wysyłki), P1.4 (nawigacja `geo:` / wybór aplikacji / tryb), P1.5 (pliki zdjęć, ostrzeżenia o dokumentach, rozmiar i miejsce, przypomnienie o pobraniu), P2.2–P2.7, P2.9.
2. **APK 0.4.0:** dokładne alarmy (P1.3), `expo-network` i `expo-background-task` (P1.2, P1.3). Jedna przebudowa dla obu profili, potem OTA korzystające z nowych modułów.
3. **Decyzja + migracja:** P2.1 (kto zapisuje zdarzenia dnia).
4. **Test w terenie** (P1.6): PROBA-OFFLINE, potem pełny dzień według kryterium MVP-4; wnioski ustalają kolejność P3.
