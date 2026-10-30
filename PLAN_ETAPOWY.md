# Plan etapowy realizacji — ExpeditionPlan

Na podstawie: [SPECYFIKACJA.md](SPECYFIKACJA.md) v0.2 (z analizą planów z `exaples/`).

Założenia: jeden deweloper z Claude Code, Android + web, TypeScript w monorepo, Supabase. Szacunki są w **dniach skupionej pracy**. FormaSync pokazał, że realne tempo bywa wielokrotnie szybsze niż plan tygodniowy (W10). Daty nie są obietnicą: obietnicą jest kryterium odbioru na urządzeniu.

Kolejność: **Etap 0 → PoC (6 eksperymentów) → bramka decyzyjna → MVP (4 etapy) → v1.0 → v1.x**.

---

## Etap 0 — Przygotowanie (≈ 2–3 dni)

- Decyzje D1–D6 ze specyfikacji (domyślne rekomendacje przyjęte, jeśli brak zmian).
- Konta i klucze: Supabase (projekt `dev`), Vercel, Expo/EAS, dostawcy AI, Geoapify/ORS, Resend z własną domeną (SPF/DKIM). Sekrety tylko w `.env.local` i sekretach Supabase, nigdy w repo.
- Weryfikacja warunków usług: masowe pobieranie kafli offline, przechowywanie danych miejsc (R3, R6), limity darmowych planów. Wynik z datą w README.
- Szkielet monorepo: `apps/web`, `apps/mobile`, `packages/core`, `packages/ai`, `supabase/`. Jest, ESLint, `tsc`, git, `.gitattributes` (stałe końce linii), `CLAUDE.md`.
- Expo: dev build + `eas.json` z profilami `development` / `preview` / `friends` / `production` i skryptami OTA skopiowanymi z FormaSync (W9).
- Przeniesienie wzorca `features/ai` z FormaSync do `packages/ai` (adaptery Claude/Gemini/OpenAI, `transport`, `status`, `models`, `rejected`) w wersji uruchamianej w Deno/Node, bez SecureStore.
- **Wyjazdy referencyjne = własne plany z `exaples/`**: Barcelona, Gruzja, Maroko, Chatka Sylwestrowa, Dinara. Dla każdego spisać `trip_brief`, jaki mógł być na wejściu (cel, daty, uczestnicy z wiekiem, transport, to, co było już kupione). Te same wejścia służą PoC-0, PoC-1 i późniejszym testom regresji AI, a gotowe plany są wzorcem do porównania.

**Rezultat:** repo z pustymi aplikacjami, które budują się i startują; `packages/ai` odpowiada z każdego dostawcy w teście dymnym; 5 briefów referencyjnych w `fixtures/plans/`.

---

## PoC — Sześć eksperymentów technicznych (≈ 10–14 dni)

Cel: przed budową produktu sprawdzić rzeczy, które mogą zmienić architekturę. Każdy eksperyment ma kryterium **go / no-go** i wariant awaryjny. Kod z PoC-0, PoC-1, PoC-4 i PoC-5 przechodzi do produktu (to `packages/core` i `packages/ai`), reszta może być wyrzucona.

### PoC-0 — Schemat danych na własnych planach (≈ 2 dni) — **pierwszy**
- Schematy Zod dla całego modelu z §5 (w tym `Price`, `details` rezerwacji, warianty, ograniczenia, zadania, pakowanie, notatki).
- Import AI (Etap „Import planu”, wersja CLI): każdy z 5 dokumentów z `exaples/` → JSON zgodny ze schematem → `fixtures/plans/*.json`. Poprawki ręczne tam, gdzie AI się pomyli.
- Lista kontrolna per plan: co z dokumentu **nie ma gdzie trafić** w schemacie, co trafia tylko do notatki tekstowej, choć powinno być polem. Silnik harmonogramu (PoC-5) na tych danych odtwarza godziny z dokumentów.

**Go:** każdy z 5 planów mieści się w schemacie bez utraty informacji, które w trakcie wyjazdu są potrzebne na telefonie (godziny, rezerwacje i kody, warianty z warunkami, ograniczenia, ceny dla grupy, kontakty). Reszta może zostać notatką. **No-go:** poprawka schematu przed MVP-1, specyfikacja v0.3.

### PoC-1 — Łańcuch AI z ugruntowaniem (≈ 3–4 dni) — **najważniejszy**
- Skrypt CLI (bez UI): `trip_brief` (JSON) → Etap 1 (warianty) → Etap 2 (pula + harmonogram + audyt) → ugruntowanie (geokodowanie, godziny otwarcia, święta, słońce) → routing (`legs`) → silnik harmonogramu (§7) → raport.
- Schematy Zod dla etapów 1 i 2, walidator z jedną próbą naprawy.
- Uruchomienie na 5 briefach z `exaples/` × 2–3 dostawców × 2 źródła miejsc (OSM/Geoapify vs inne).
- Raport w tabeli: % ugruntowanych punktów, % w godzinach otwarcia, % dni realizowalnych, liczba ostrzeżeń, czas, tokeny i koszt.
- **Porównanie z planami referencyjnymi:** czy AI widzi te same ryzyka co ręczne plany (zachód słońca i jazda po zmroku, kolejki na lotnisku, godziny biura wypożyczalni, limit km, święto i zamknięte sklepy, „kto pierwszy, ten lepszy” w chatce) i czy proponuje sensowne warianty.

**Go:** ≥ 90% punktów ugruntowanych, ≥ 80% dni realizowalnych bez ręcznej poprawki, plan 4-dniowy < 90 s, koszt mieszczący się w budżecie z D2, co najmniej połowa ryzyk z planów referencyjnych wykryta.
**No-go → wariant:** AI tylko wybiera z listy kandydatów pobranych wcześniej z API miejsc (odwrócenie kolejności: najpierw dane, potem model).

### PoC-2 — Mapa offline na Androidzie (≈ 2 dni)
- `@maplibre/maplibre-react-native` (v11, New Architecture) w dev buildzie; region jednego miasta (Marakesz) i jednego regionu (Swanetia albo Góry Bystrzyckie ze śladem do chatki).
- Wariant główny (wg [docs/USLUGI.md](docs/USLUGI.md)): plik `.pmtiles` regionu wycięty z buildu Protomaps (`pmtiles extract`), na R2, pobrany w całości na telefon i otwarty jako `pmtiles://file://…`, z lokalnymi glifami i sprite'ami. Najpierw sprawdzić, czy wrapper RN przepuszcza `pmtiles://` (Android: MapLibre Native od 11.7.0).
- Wariant zapasowy: paczka `OfflineManager` z OpenFreeMap (≤ 3000 kafli / 50 MB na pobranie, ≤ 4 równoległe żądania, własny User-Agent).
- Pomiar: rozmiar dla miasta i regionu przy zoom 10–16/17, czas pobrania, płynność, tryb samolotowy, pozycja GPS na mapie, napisy po polsku bez sieci.

**Go:** miasto ≤ ~150 MB, mapa i pozycja działają w trybie samolotowym, warunki dostawcy pozwalają na ten sposób użycia.

### PoC-3 — Geofencing i bateria (≈ 2 dni + spacer)
- `expo-location` + `expo-task-manager`: 10–15 geofence (100 / 150 m) wokół realnych punktów w mieście, aplikacja w tle, ekran wygaszony.
- Wariant „Tryb spaceru”: usługa pierwszoplanowa, dokładny GPS, promień 30–50 m.
- Spacer 2–3 h z logiem: które wejścia wykryte, opóźnienie wykrycia, zużycie baterii w obu trybach.
- Przy okazji: `expo-speech` po polsku offline (jakość głosu, dostępność głosu bez sieci) i odtwarzanie przy wygaszonym ekranie.

**Go:** ≥ 90% wejść wykrytych w trybie 150 m w ≤ 2 min; „Tryb spaceru” ≤ ~8%/h baterii. Wynik wyznacza, czy autoodtwarzanie jest S czy C.

### PoC-4 — Synchronizacja Supabase ↔ SQLite (≈ 2–3 dni)
- Minimalne tabele `trips`, `days`, `items`, `schedule_events`, `expenses` z RLS (owner/viewer) i testami pgTAP.
- Telefon: migawka z `plan_version`, aktualizacja przyrostowa, outbox dla `schedule_events` i `expenses`.
- Scenariusze: (1) zmiana na webie widoczna na telefonie < 3 s online; (2) telefon offline rejestruje 3 opóźnienia i 2 wydatki, w tym czasie web zmienia plan → po powrocie sieci nic nie ginie i harmonogram liczy się tak samo na obu urządzeniach; (3) zabicie aplikacji w trakcie wysyłki outboxa → brak duplikatów.

**Go:** wszystkie 3 scenariusze przechodzą powtarzalnie. **No-go → wariant:** PowerSync.

### PoC-5 — Silnik harmonogramu i ograniczeń (≈ 2 dni, równolegle z PoC-0/1)
- `packages/core/schedule`: funkcja z §7 + fakty dnia (słońce, zmierzch, Księżyc, DST) + ograniczenia + zapas i cięcia + ceny dla grupy z progów wiekowych.
- Testy: stała godzina, opóźnienie do następnego punktu stałego, godziny otwarcia, zmiana czasu (noc 24/25.10 z Chatki), punkt przez północ, dwie strefy w jednym dniu (lot), przedziały czasu trwania, tryb względny (`+1:20`, Dinara), „bez jazdy po zmroku” (Maroko), limit km auta vs trasa (710 vs 680 km).

**Go:** testy zielone, a godziny odtworzone z `fixtures/plans/` zgadzają się z dokumentami w granicach ±15 min. Ten kod idzie wprost do MVP.

### Bramka decyzyjna po PoC
Krótki dokument `POC_WYNIKI.md`: metryki, wybrani dostawcy (AI, miejsca, routing, kafle), wariant synchronizacji, decyzja o geofencingu, poprawki schematu z PoC-0. Aktualizacja specyfikacji do v0.3. **Bez tej bramki MVP nie startuje.**

---

## MVP — „Planuję na laptopie, podróżuję z telefonem” (≈ 22–31 dni)

**Definicja MVP:** organizator planuje na webie realny 3–5-dniowy wyjazd z pomocą AI, zaprasza osobę towarzyszącą jako widza i oboje przeżywają ten wyjazd z telefonem w trybie samolotowym. Plan ma to, co w `exaples/` okazało się niezbędne w trasie: warianty z warunkiem i terminem decyzji, audyt zapasu czasu, rezerwacje z kodami i warunkami, budżet „zapłacone / do wydania”, zadania i kontakty.
Zakres MVP = wszystkie punkty **M** ze specyfikacji. Schemat bazy obejmuje od razu **wszystkie** tabele z §5 (także portfel, pakowanie, ślady, audio, AI), nawet jeśli UI powstaje później.

### MVP-1 — Fundament danych i konto (≈ 4–5 dni)
- Pełny schemat §5 w migracjach (z poprawkami z PoC-0), triggery (`updated_at`, `plan_version`, `activity_log`), RLS dla wszystkich tabel + testy pgTAP z macierzy uprawnień.
- Typy z Supabase → `packages/db`. Logowanie Google + magic link (Resend) na webie i w aplikacji (deep link).
- Web: lista wyjazdów, tworzenie, uczestnicy (imię, wiek, rodzina, opiekun), zaproszenie linkiem (owner/viewer). Mobile: logowanie, lista wyjazdów, dołączenie z linku zaproszenia.
- Skrypt seed: 5 planów z `fixtures/plans/` ładuje się do bazy `dev` jako wyjazdy testowe.

**Kryterium odbioru:** druga osoba dołącza z linku jako widz, widzi wyjazd i nie może niczego zmienić (sprawdzone testem RLS i ręcznie). Pięć planów referencyjnych jest w bazie.

### MVP-2 — Kreator i AI w produkcie (≈ 5–7 dni)
- Formularz `trip_brief` (Zod) na webie: założenia, uczestnicy, „co już ustalone” (loty, rezerwacje, stałe punkty), ograniczenia (maks. jazdy dziennie, bez jazdy po zmroku).
- Edge Functions `ai-skeleton`, `ai-poi`, `places-search`, `routes` (logika z PoC-1), zapis w `ai_runs`, limity per użytkownik.
- Etap 1: 2–3 warianty układu z tabelą porównania i rekomendacją → wybór.
- Etap 2: pula, harmonogram, warianty w dniu, ograniczenia, priorytety i audyt zapasu → podgląd draftu (dni + pula + mapa) → akceptacja → zapis.
- „Przelicz dzień z poleceniem” (uproszczony Etap 3: regeneracja jednego dnia z zachowaniem punktów `user_locked`).

**Kryterium odbioru:** z formularza do zaakceptowanego planu 4-dniowego w < 3 min, z mapą, godzinami, pulą i audytem zapasu każdego dnia, bez ręcznego poprawiania JSON-a. Dla briefu Maroka AI proponuje co najmniej dwa układy nocy z metrykami.

### MVP-3 — Edytor planu, rezerwacje, budżet, zadania (web) (≈ 7–10 dni)
- Widok dni + pula + mapa MapLibre. Przeciąganie w dniu, między dniami i z puli (`sort_key`). Edycja punktu: precyzja godzin, czas trwania (przedział), bufor, stała godzina, priorytet i kolejność cięcia, cena (`Price`), płatność, linki, uczestnicy.
- Dodanie punktu z wyszukiwarki miejsc albo własnej pinezki.
- Warianty (punkt / blok / dzień): etykiety, rekomendacja, warunek, termin decyzji, przełączanie. Ograniczenia dnia i punktu.
- Panel dnia: przeliczone godziny, km i czas jazdy, zapas, cięcia, naruszone ograniczenia, słońce, święto. Notatki dnia i punktu.
- Rezerwacje: rodzaje, statusy, strefy początku i końca, warunki (bezzwrotna, darmowe odwołanie do, płatność na miejscu, gotówka), co w cenie → punkty „w pakiecie”, `details` dla lotu, auta i noclegu. Dokumenty z widocznością, kod QR wyciągnięty z pliku. Kontakty.
- Budżet planowany: pozycje z rezerwacji i cen punktów + ręczne, status, przedział oszczędnie / wygodnie, kursy z datą → zapłacone / do wydania / na osobę.
- Zadania: todo / pytanie / decyzja, terminy względne, przypisania.
- Notatki praktyczne i źródła z datą sprawdzenia.
- Realtime: otwarty plan odświeża się po zmianie z innego urządzenia.

**Kryterium odbioru:** plan Maroka z `fixtures/plans/` da się w edytorze odtworzyć i edytować: wariant A/B dnia 4, „bez jazdy po zmroku” i lista cięć dnia 2, pakiet Agafay z punktami „w pakiecie”, budżet 7 519 zł zapłacone / ~3 915–5 555 zł do wydania, 8 zadań przed wyjazdem. Przestawienie punktu przelicza godziny i zapas natychmiast, bez przeładowania strony.

### MVP-4 — Pocket Guide offline (Android) (≈ 6–9 dni)
- `offline-manifest` + „Pobierz wyjazd offline”: dane (z pulą, wariantami, notatkami, kontaktami, zadaniami), kafle (wariant z PoC-2), transkrypcje audio, dokumenty `offline`. Postęp, wznawianie, sha256, plakietka „jest nowsza wersja planu”.
- „Tu i teraz”: karty trwa / następny / przejście (z instrukcją i linią), zachód słońca, „Prowadź” (deep link), „Zostajemy dłużej” / „Pomiń” / „Zrobione” / „Wybierz wariant” / „Z puli w pobliżu” jako `schedule_events` w outboxie. Po opóźnieniu, które łamie ograniczenie: propozycja cięć.
- Oś dnia, mapa dnia z pozycją, karta punktu z audio (`expo-speech`), ceną dla grupy, płatnością i dokumentami (QR na pełnym ekranie, max jasność). Karta rezerwacji z kodem i kontaktem.
- Lista zadań z odhaczaniem offline.
- Lokalne powiadomienia z osi dnia i terminów decyzji, przeplanowane po każdym opóźnieniu i po restarcie.
- Transkrypcje audio: Edge Function `ai-audio` (Wikipedia/Wikivoyage + AI, atrybucja), generowane przy akceptacji planu, wspólne per `place_id`.

**Kryterium odbioru:** pełny dzień zwiedzania w trybie samolotowym na fizycznym telefonie: mapa z pozycją, oś dnia, dwa opóźnienia przeliczające resztę dnia (jedno z propozycją cięć), przypomnienie o terminie decyzji i przełączenie wariantu, powiadomienia „za 15 min”, audio przy punkcie, QR biletu przy bramce, telefon do gospodarza z karty noclegu. Po powrocie sieci opóźnienia i wybory są widoczne na webie.

> **Kamień milowy M1 — MVP:** APK przez kanał `friends` + web na Vercel. **Test w terenie:** prawdziwy wyjazd (choćby jednodniowy) przed dalszą rozbudową. Wnioski z niego ustalają kolejność etapów v1.0.

---

## v1.0 — Kompletny produkt (≈ 35–48 dni)

Kolejność orientacyjna. Po teście w terenie może się zmienić.

### Etap 5 — Współpraca (≈ 4–5 dni)
- Rola edytora w UI, ostrzeżenie o współbieżnej zmianie (`version`), obecność (Realtime Presence), dziennik aktywności z cofnięciem.
- Nazwane wersje planu (`plan_snapshots`, „v4”) i porównanie wersji.
- Punkty dla części grupy (`item_participants`: szpica, ekipy zadaniowe).
- Link publiczny: strona SSR w układzie wzoru, podgląd OG, ukrywanie zakresów, unieważnianie.

**Odbiór:** dwie osoby edytują ten sam dzień na dwóch laptopach i żadna zmiana nie ginie bez ostrzeżenia. Link publiczny nie ujawnia kosztów, sejfu, kodów rezerwacji ani kontaktów (test).

### Etap 6 — AI: czat, logistyka, informacje praktyczne, importy (≈ 7–9 dni)
- Etap 3: czat → łatka operacji (z wariantami i powrotem do puli) → diff → akceptacja; `ai_messages`.
- Etap 4: kandydaci do porównania (noclegi per baza, klasy aut, pakiety ubezpieczeń, karnety) z atrybutami, warunkami, plusami, minusami, rekomendacją i deep linkami. Wybór kandydata = status `to_book`.
- Etap 5: notatki praktyczne, kontakty alarmowe, lista pakowania, TODO z terminami, źródła.
- Import rezerwacji przez AI: PDF, zrzut ekranu, wklejony mail → `bookings` + dokument w sejfie.
- Import istniejącego planu DOCX/PDF (z PoC-0) w UI: podgląd per sekcja, akceptacja.
- Kontrole automatyczne: alert przed końcem darmowego odwołania, skład osobowy u operatora vs wiek uczestników, limit km vs trasa, godzina zwrotu vs godziny biura → zadania z `source = check`.

**Odbiór:** „Zmień obiad w dniu 2 na wegański” i „Dzień 3 jest za męczący” dają poprawne łatki, które nie ruszają punktów zablokowanych. Potwierdzenie z Booking (PDF) zamienia się w kartę noclegu z kodem i terminem darmowego odwołania. Dla Gruzji Etap 4 daje porównanie 2–3 noclegów w Mestii w układzie zbliżonym do ręcznego planu. Import `Plan - Chatka Sylwestrowa` daje wyjazd z uczestnikami, harmonogramem, wariantami awaryjnymi, pakowaniem i TODO.

### Etap 7 — Pakowanie, ślady GPX, eksport dokumentu (≈ 5–7 dni)
- Lista pakowania: osobista / wspólna, „kto bierze co”, odhaczanie per osoba offline (rodzic za dziecko), kopiowanie z poprzedniego wyjazdu.
- Ślady GPX: import, statystyki (długość, przewyższenie, czas), mapa offline z własną pozycją i odległością od śladu.
- Eksport DOCX/PDF według `wzór.docx`, eksport ICS.

**Odbiór:** eksport planu Chatki do DOCX ma te same sekcje co oryginał. Ślad do chatki widać w trybie samolotowym razem z pozycją telefonu.

### Etap 8 — Audioprzewodnik pełny (≈ 4–6 dni, zakres zależny od PoC-3)
- Odtwarzacz w tle z kontrolkami w powiadomieniu, kolejka nagrań dnia.
- Geofencing punktów dnia (100–150 m) → powiadomienie „Jesteś przy X”. „Tryb spaceru” z autoodtwarzaniem.
- Wersja transkrypcji dla dzieci. Opcjonalnie TTS w chmurze (MP3 do pakietu offline), wybór głosu, cache per `place_id` + język.

### Etap 9 — Portfel (≈ 4–5 dni)
- Wydatki offline (outbox), podział po równo / udziały / kwoty / na rodziny, kursy z dnia, saldo i minimalne przelewy (`packages/core/settle` z testami), rozliczenia.
- Budżet planowany vs rzeczywisty, per kategoria i dzień. Paragon ze zdjęcia (opcjonalnie AI).

**Odbiór:** 4 osoby, 3 waluty, 30 wydatków, część dodana offline → saldo zgodne z ręcznym przeliczeniem, każda osoba ma tę samą liczbę na swoim telefonie. Zrzutka „150 zł na rodzinę” (Chatka) rozlicza się per rodzina.

### Etap 10 — Pogoda, alerty, push (≈ 3–4 dni)
- Open-Meteo dla dni wyjazdu, alert „deszcz → przełączyć wariant?”, zadanie „go / no-go 2 dni przed” z prognozą, alerty czasowe (zamknięcie, ostatni kurs).
- Push zdalny (Expo Push) o zmianach od innych, zadaniach z terminem i alertach.

### Etap 11 — Planowanie komfortowe (≈ 3–5 dni)
- Widok kalendarza tygodniowego z drag & drop, przeciąganie pinezek na mapie.

### Etap 12 — Stabilizacja i wydanie (≈ 4–6 dni)
- E2E: Playwright (kreator → akceptacja → edycja), Maestro (pobranie offline → dzień w trybie samolotowym).
- Regresja AI na 5 briefach z `exaples/` przy każdej zmianie poleceń lub modelu.
- Polityka prywatności, eksport i usunięcie konta, przegląd RLS i limitów kosztów.
- Jeśli D1 = Google Play: deklaracja lokalizacji w tle (wideo z uzasadnieniem), formularz bezpieczeństwa danych, AAB z profilu `production`.

> **Kamień milowy M2 — v1.0.**

---

## v1.x — Później (COULD)

- Edycja planu z telefonu offline (outbox z kontrolą wersji).
- Równoległe ścieżki dnia dla podgrup, podział na auta (`vehicles`).
- Komunikacja publiczna z realnym routingiem (R5).
- Katalog publicznych planów jako inspiracji, klonowanie.
- Licencjonowane nagrania lektorskie, inne języki audio.
- Widżet Androida „Tu i teraz”.
- iOS.

---

## Harmonogram zbiorczy

| Etap | Zakres | Priorytet | Szac. (dni) | Zależności |
|---|---|---|---|---|
| 0 | Przygotowanie, monorepo, `packages/ai`, briefy z `exaples/` | — | 2–3 | — |
| PoC-0 | Schemat danych na 5 własnych planach | krytyczny | 2 | 0 |
| PoC-1 | Łańcuch AI z ugruntowaniem + porównanie z planami | krytyczny | 3–4 | 0, PoC-0 |
| PoC-2 | Mapa offline | krytyczny | 2 | 0 |
| PoC-3 | Geofencing, bateria, TTS | wysoki | 2 + spacer | 0 |
| PoC-4 | Synchronizacja | krytyczny | 2–3 | 0 |
| PoC-5 | Silnik harmonogramu i ograniczeń | krytyczny | 2 | 0, PoC-0 |
| — | **Bramka decyzyjna** | — | 0,5 | PoC 0–5 |
| MVP-1 | Schemat, RLS, konto, uczestnicy, seed z planów | MUST | 4–5 | bramka |
| MVP-2 | Kreator + AI (warianty, pula, audyt) | MUST | 5–7 | MVP-1, PoC-1 |
| MVP-3 | Edytor, rezerwacje, budżet, zadania | MUST | 7–10 | MVP-2, PoC-5 |
| MVP-4 | Pocket Guide offline | MUST | 6–9 | MVP-3, PoC-2, PoC-4 |
| — | **M1: MVP + test w terenie** | — | — | — |
| 5 | Współpraca, wersje, link publiczny | SHOULD | 4–5 | MVP |
| 6 | AI czat, logistyka, praktyczne, importy, kontrole | SHOULD | 7–9 | MVP |
| 7 | Pakowanie, GPX, eksport DOCX/PDF | SHOULD | 5–7 | MVP |
| 8 | Audio pełne, geofencing | SHOULD | 4–6 | MVP, PoC-3 |
| 9 | Portfel | SHOULD | 4–5 | MVP |
| 10 | Pogoda, alerty, push | SHOULD | 3–4 | MVP |
| 11 | Kalendarz, mapa drag | SHOULD | 3–5 | MVP-3 |
| 12 | Stabilizacja, wydanie | — | 4–6 | wszystkie |

**Łącznie:** Etap 0 + PoC ≈ 2,5–3 tygodnie, MVP ≈ 5–6 tygodni, v1.0 ≈ kolejne 7–10 tygodni. Etapy 5–11 są od siebie niezależne i można je układać według wniosków z testu w terenie.

**Ścieżka krytyczna:** PoC-0 (czy schemat unosi realne plany) → PoC-1 (jakość AI) → MVP-2 → MVP-3 → MVP-4 (offline). Jeśli PoC-1 nie przejdzie bramki, cały produkt zmienia charakter (AI jako doradca do listy realnych miejsc zamiast autora planu). Dlatego PoC-0 i PoC-1 idą pierwsze.
