# ExpeditionPlan — specyfikacja v0.3

Źródła: wstępna specyfikacja (30.10.2026), doświadczenia z FormaSync (`D:\AI\Kardio`) oraz pięć własnych planów wyjazdów z katalogu [`exaples/`](exaples/) (analiza w §0.2).
Plan realizacji: [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md).

**Zmiany w v0.3 (PoC-0, 31.10.2026):** model danych sprawdzony na pięciu własnych planach — poprawki A1–A9 z [POC_WYNIKI.md](POC_WYNIKI.md): strefa przy godzinie punktu, czas względny od poprzedniego kroku, obowiązkowa kolejność punktów w dniu, przejazd z godziną jako punkt `transport`, daty rezerwacji bez godziny, koniec statusu `in_package`, wybór z kandydatów rozwiązywany w dniach i punktach, dodatki do rezerwacji, status rezerwacji `unknown` / `not_required`, warianty wyrzucające punkty. Format dokumentu wyjazdu: `packages/core/src/schemas/trip-document.ts`.

**Zmiany względem v0.1:** model danych rozszerzony o elementy, których wymagają realne plany: pula atrakcji ze statusami, warianty dowolnego zasięgu (nie tylko Plan B pogodowy), ograniczenia i audyt zapasu czasu, precyzja godzin, ceny jako przedziały z progami wiekowymi, statusy rezerwacji i warunki anulowania, budżet „zapłacone / do wydania”, zadania i decyzje, lista pakowania, notatki praktyczne, kontakty, ślady GPX, źródła z datą sprawdzenia. Do tego nowy etap AI (informacje praktyczne), import istniejących planów i eksport dokumentu według własnego wzoru.

---

## 0. Wnioski

### 0.1. Z FormaSync

| # | Co się stało w FormaSync | Konsekwencja tutaj |
|---|---|---|
| W1 | Garmin Training/Health API okazało się niedostępne dla osób prywatnych (program dla firm, płatny). Skończyło się na nieoficjalnym przepływie, który może paść z dnia na dzień. | Booking, Airbnb, GetYourGuide, Skyscanner i inne API partnerskie wymagają statusu partnera albo afiliacji. **Żadna funkcja MUST nie zależy od akceptacji partnera.** Rezerwacje = link + ręczny wpis + ekstrakcja AI z PDF/maila. |
| W2 | Health Connect potrafił pominąć trening bez śladu i został porzucony. | Każda integracja jest zastępowalna i ma test „czy nie gubi danych”. Surowa odpowiedź źródła zostaje w `raw` (jsonb). |
| W3 | Timery JS nie działają w tle (R5). Rozwiązanie: znaczniki czasu i lokalne powiadomienia planowane z góry. | Harmonogram dnia jest **liczony** ze znaczników czasu, a nie odliczany. Powiadomienia planowane z wyprzedzeniem i odtwarzane po każdej zmianie i po restarcie. Geofencing przez systemowe API Androida, nie przez odpytywanie GPS w JS. |
| W4 | AI: trzech dostawców (Gemini, Claude, ChatGPT) za jednym `askAi()` i jednym walidatorem. Listy modeli pobierane z API, nie wpisane z pamięci. Wycofany model jest rozpoznawany, jest limit czasu, ponawia się tylko przy 5xx. | Przenosimy wzorzec `features/ai` (client / transport / status / models / rejected) do `packages/ai`. Wykonuje się **na serwerze**, bo jest web i grupa (klucz nie może siedzieć w przeglądarce). |
| W5 | „Przeliczenie planu zastępuje poprzedni, zamiast dokładać drugi”; „Korekta planu widzi, co z planu wyszło”. | AI tworzy **propozycje** (draft) i **łatki** (operacje), nigdy nie nadpisuje po cichu. Ręczne zmiany użytkownika są chronione (`user_locked`). |
| W6 | Sesja treningu to migawka planu z chwili startu. | Pakiet offline to migawka z numerem `plan_version`. Telefon wie, z której wersji korzysta, i mówi, że jest nowsza. |
| W7 | Backend serverless z etapu 7 pominięto, wystarczyła mała skrytka PHP na szyfrowane kopie. | Tu backend jest nieunikniony (wspólna baza, role, realtime, pliki), ale **wyłącznie zarządzany** (Supabase), bez własnego serwera aplikacji. |
| W8 | Szyfrowanie kopii w tle zamrażało UI na kilkanaście sekund po starcie. | Ciężkie operacje (pobieranie pakietu offline, kafle, audio) idą z paskiem postępu, poza ścieżką startu aplikacji, w kawałkach. |
| W9 | Kanały EAS `preview`/`friends`, OTA, `runtimeVersion = appVersion`, APK przez GitHub Releases. | Przenosimy 1:1 (skrypty `ota`, `apk:friends`, `release:friends`). |
| W10 | Plan zakładał ~20 tygodni, a realnie zrobiono to w ~1 miesiąc (196 commitów, 29.09–28.10). | Etapy są krótkie i mają twarde kryterium odbioru **na urządzeniu**. Szacunki w PLAN_ETAPOWY są podane w dniach pracy. |
| W11 | Poczta: `mail()` na hostingu, SPF/DKIM, spam. | Wbudowany SMTP Supabase Auth ma bardzo niski limit wysyłek. Od MVP logowanie przez Google + magic link przez własny SMTP (np. Resend). |
| W12 | Tokeny w SecureStore. Na serwerze minimum danych, kopie szyfrowane E2E. | Sejf: prywatny bucket + RLS + widoczność per dokument. Lokalizacja użytkownika nie opuszcza telefonu. |

### 0.2. Z własnych planów (`exaples/`)

Przeanalizowane: **Barcelona** (3 dni, miasto, komunikacja, mecz), **Gruzja 2027 v4** (12 dni, 3 bazy, auto, trekking, porównanie noclegów), **Maroko** (5 dni, objazd autem, rodzina, 21 stron: warianty, audyt czasu, pula atrakcji, auto, budżet), **Chatka Sylwestrowa** (2 dni, 11 osób, góry, nocleg niekomercyjny), **wzór.docx / Dinara** (3 dni, via ferrata, szablon dokumentu).

| Element w planach | Gdzie występuje | Stan w v0.1 | Rozstrzygnięcie w v0.2 |
|---|---|---|---|
| Godziny przybliżone `~09:30`, przedziały `11:45–12:45`, pora dnia („wieczór”), cały dzień jednym wpisem | Barcelona, Gruzja | tylko dokładna godzina | `time_precision` w punkcie (§5, §7) |
| Godziny względne `+1:20`, „godzina zero do ustalenia” | Dinara | brak | kotwica dnia `days.anchor_time` (nullable). Bez niej plan pokazuje przesunięcia `+h:mm` |
| Opcja A / B w ramach dnia, warianty dnia, warianty całego układu nocy z tabelą porównania i uzasadnieniem | Barcelona, Maroko, Chatka | Plan B tylko pogodowy, per punkt | **grupy wariantów** o zasięgu: punkt / blok / dzień / wyjazd / rezerwacja, z warunkiem, terminem decyzji i rekomendacją |
| Warunkowe punkty („Font Màgica, jeśli działa”, „jeśli ruszycie po 12:30 — odpuśćcie suki”) | Barcelona, Maroko | brak | wariant z `condition_kind` = closure / schedule_slip / availability / weather / wellbeing |
| Termin decyzji („decyzja najpóźniej o 15:00”, „go / no-go 2 dni przed”) | Chatka | brak | `variant_groups.decide_by` + zadania z terminem względnym; przypomnienie na telefonie |
| Audyt zapasu czasu per dzień: ile luzu, co ciąć najpierw, czego nie przesuwać | Maroko (każdy dzień) | ostrzeżenia silnika | `items.priority` + `cut_rank`, tabela `constraints`, zapas liczony przez silnik, opis od AI w notatce `slack_audit` |
| Ograniczenia: „nie jechać po zmroku”, „wyjazd nie później niż 15:00”, „biuro wypożyczalni otwiera 07:00” | Maroko, Chatka | brak | `constraints` sprawdzane przez silnik (§7) |
| Wschód, zachód, koniec zmierzchu, faza Księżyca, zmiana czasu w nocy wyjazdu, strefa kraju | wszystkie | brak | liczone lokalnie (biblioteka astronomiczna) per dzień i miejsce, w pakiecie offline. DST obsługuje silnik |
| Pula atrakcji per obszar ze statusem: W PLANIE / ALTERNATYWA / NIE MIEŚCI SIĘ / W PAKIECIE / DROGO / ZAMIAST X | Maroko (4 strony) | tylko punkty zaplanowane | punkty bez dnia: `plan_status` + `area` + `replaces_item_id`. Na telefonie: „mamy wolną godzinę — co w pobliżu z puli?” |
| Ceny: per osoba / dla grupy, przedziały (`€95–165`, `od ok. 850 MAD`), progi wiekowe różne u każdej kasy (dziecko <12, 7–13, dorosły od 13) | Maroko, Barcelona | jedna kwota | typ `Price` (§5): podstawa, przedział, „od”, progi wiekowe → kwota dla grupy liczona z wieków uczestników |
| Płatność tylko gotówką, waluta zamknięta, kaucja na karcie kredytowej | Maroko, Gruzja | brak | `payment` w punkcie i rezerwacji, notatki praktyczne |
| Rezerwacje: numer, zapłacone po rabacie, w cenie (kolacja, quad), język, skład osobowy wg operatora, bezzwrotna, darmowe odwołanie do daty, płatność na miejscu, zameldowanie od 14:00 | Maroko, Gruzja | podstawowe pola | rozbudowane `bookings` (§5) + alert przed końcem darmowego odwołania + kontrola składu (wiek wg operatora vs uczestnicy) |
| Porównanie kandydatów (2–3 noclegi, klasy aut, pakiety ubezpieczeń) z atrybutami, plusami, minusami i rekomendacją | Gruzja, Maroko | brak | rezerwacje ze statusem `candidate` w grupie wariantów `scope = booking`, atrybuty w `details` |
| Auto: limit km vs długość trasy, kaucja, wiek kierowcy, paliwo pełny-do-pełnego | Maroko | brak | `details` dla `car_rental` + automatyczna kontrola: suma km z `legs` vs limit, godziny biura vs zwrot |
| Lot: numer, lotniska, godziny w dwóch strefach, bagaż | Barcelona, Maroko, Gruzja, Dinara | jedno `tz` | `start_tz` / `end_tz`, `details` dla `flight` |
| Budżet: zapłacone vs do wydania, scenariusze „oszczędnie / wygodnie”, na osobę, kursy z datą | Maroko, Dinara | `budgets` (kategoria, kwota) | `budget_lines` ze statusem i przedziałem (§5). Portfel (wydatki rzeczywiste) osobno |
| „Do ustalenia” i „TODO” z terminami i osobami, „kto bierze co” | wszystkie | brak | `tasks` (todo / question / decision), terminy względne, przypisania |
| Lista pakowania: osobista (każdy, też dzieci) vs wspólna do podziału, kategorie | Maroko, Chatka, Dinara | brak | `packing_items` + odhaczanie per osoba |
| Uczestnicy z imionami, wiekiem, rodziny (dorosły + dzieci), kto odpowiada za które dziecko, zrzutka „na rodzinę” | Chatka, Dinara, Maroko | `travelers` z wiekiem | `household`, `guardian_traveler_id`. Podział kosztów per osoba lub per rodzina |
| Rozdzielenie grupy (szpica idzie wcześniej, ekipy zadaniowe) | Chatka | brak | `item_participants` (podzbiór uczestników punktu). Równoległe ścieżki dnia (C) |
| Podział na auta, dojazd własny | Chatka | brak | `vehicles` (C) |
| Trasy piesze: długość, czas, przewyższenie, oznakowanie, opis dojścia, ślad z mapy, „punkt u 3 osób offline” | Chatka, Dinara, Gruzja | brak | `tracks` (GPX, geojson, statystyki), widoczne offline na mapie z własną pozycją |
| Własne punkty spoza baz miejsc (chatka „nie na każdej mapie”, parking ze współrzędnymi) | Chatka | tylko miejsca z dostawcy | `places.provider = 'user'`, pinezka ręczna |
| Linki: Google Maps, mapy.com, Booking share, voucher na Google Drive | Dinara | jedno `url` | `links` (lista z etykietami) |
| Notatki: wstęp dnia, porady, ostrzeżenia, bezpieczeństwo, pogoda sezonowa, dokumenty, wiza, gniazdka, zasady (chatka) | wszystkie | `description` / `notes` | `notes` z zasięgiem i tematem (§5) |
| Numery alarmowe, gospodarz, operator | Chatka, Barcelona | brak | `contacts` |
| Źródła z datą sprawdzenia, zastrzeżenia o aktualności cen | Maroko, Chatka | brak | `sources` + `source_links`. Plakietka „cena sprawdzona 16.10”, ostrzeżenie o starych danych |
| Wersje planu („v4”, „wcześniejsze wersje zakładały…”) | Gruzja, Maroko | `activity_log` | `plan_snapshots` (nazwane wersje, porównanie) |
| Podsumowanie wyjazdu: koszt lotów, km za kierownicą, najdłuższy dzień, całość, już zapłacone | Maroko | brak | pulpit wyjazdu liczony z danych |
| Stały układ dokumentu: Założenia, Termin, Uczestnicy, Transport, Zakwaterowanie, Sprzęt, Harmonogram, Trasy, Koszty, Inne, Do ustalenia, TODO, Źródła | wzór.docx, Chatka | eksport PDF jako C | **eksport DOCX/PDF według wzoru** (S), ten sam układ na stronie linku publicznego |
| Plany istnieją już jako DOCX/PDF | wszystkie | brak | **import istniejącego planu** przez AI do struktury (S). Pięć przykładów to zarazem test schematu (PLAN_ETAPOWY, PoC-0) |

Wniosek ogólny: realne plany to nie tylko oś czasu z punktami. To **dokument decyzyjny**: warianty z uzasadnieniem, audyt ryzyka czasowego, logistyka i budżet z rozróżnieniem „pewne / szacunek”, zadania przed wyjazdem. Model danych i AI muszą to unieść od pierwszej migracji.

---

## 1. Cel, użytkownicy, zakres

**Cel:** zaplanować wyjazd na dużym ekranie z pomocą AI, a potem „przeżyć” go z telefonem w ręku, także bez zasięgu.

| Persona | Gdzie | Co robi |
|---|---|---|
| Organizator (właściciel) | web + Android | tworzy wyjazd, generuje i edytuje plan, zaprasza, zarządza sejfem, budżetem i zadaniami |
| Współorganizator (edytor) | web + Android | edytuje plan, dodaje wydatki, dokumenty i zadania |
| Uczestnik (widz) | Android, rzadziej web | widzi harmonogram, mapę i audio offline; odhacza swoją listę pakowania; dodaje wydatki (jeśli dostał takie prawo) |
| Uczestnik bez konta (np. dziecko) | — | istnieje w `travelers`: liczy się do cen, podziału kosztów i pakowania |
| Odbiorca linku publicznego | przeglądarka, bez konta | ogląda plan tylko do odczytu (bez kosztów, sejfu i adresów noclegów) |

**Typy wyjazdów, które muszą się zmieścić** (na podstawie §0.2): city break z komunikacją, objazdówka autem z wieloma noclegami, wyjazd z bazami i wycieczkami jednodniowymi, wyprawa górska / trekking z noclegiem w terenie, wyjazd sportowy (via ferrata).

**Platformy:** web (desktop, responsywny tylko do podglądu) i Android. iOS jest poza zakresem, ale Expo zostawia otwartą drogę.

**Poza zakresem:** rezerwacje i płatności w aplikacji, nawigacja zakręt po zakręcie (zastępuje ją deep link do Google Maps / mapy.com / OsmAnd), funkcje społecznościowe.

---

## 2. Architektura

```
┌──────────────────────┐      ┌──────────────────────┐
│ Planner Hub (web)     │      │ Pocket Guide (Android)│
│ Next.js + MapLibre GL │      │ Expo + MapLibre Native│
│                       │      │ SQLite (Drizzle)      │
│                       │      │ outbox + pakiet offline│
└──────────┬────────────┘      └──────────┬────────────┘
           │   supabase-js (Auth, PostgREST, Realtime, Storage)
           └───────────────┬──────────────┘
                 ┌─────────▼──────────┐
                 │ Supabase            │
                 │ Postgres + RLS      │
                 │ Realtime, Storage   │
                 │ Edge Functions ─────┼──► LLM (Claude / Gemini / OpenAI)
                 │  (ai-*, places-*,   │──► geokodowanie / POI / routing
                 │   offline-manifest, │──► Open-Meteo, święta, kursy walut, TTS
                 │   share-public,     │
                 │   export-doc)       │
                 └─────────────────────┘
       Kafle offline: PMTiles / paczki regionów (CDN, np. Cloudflare R2)
```

### Stos i decyzje

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Mobile | **Expo SDK 58 + Expo Router + TypeScript** (New Architecture) | sprawdzony w FormaSync na SDK 57 (dev build, EAS, OTA, kanały); wspólny TS z webem; MapLibre RN v11 wymaga New Architecture i SDK ≥ 54 | Flutter, Kotlin: brak współdzielenia kodu, nowa nauka |
| Web | **Next.js (React, TS)** | ten sam język i typy co mobile; SSR dla linku publicznego (OG, podgląd w komunikatorach) | Vue: brak współdzielenia z RN |
| Backend | **Supabase** (Postgres, Auth, RLS, Realtime, Storage, Edge Functions) | role i uprawnienia w bazie (RLS), realtime bez własnego serwera, pliki z uprawnieniami | Firebase: NoSQL utrudnia rozliczenia i raporty. Własny PHP/MySQL (jak skrytka FormaSync): brak realtime i auth |
| Lokalna baza (mobile) | `expo-sqlite` + **Drizzle** | ten sam wzorzec migracji co FormaSync | WatermelonDB: kolejny paradygmat |
| Stan | Zustand (mobile i web) + TanStack Query (web) | jak w FormaSync | Redux |
| Walidacja i schematy | **Zod** w `packages/core`: jedno źródło dla formularzy, odpowiedzi AI, pól `jsonb` i API | jeden walidator dla wszystkich dostawców AI (W4) | — |
| Mapy | **MapLibre** (GL JS na webie, Native na Androidzie), kafle wektorowe OSM | darmowe, działa offline, brak zakazu łączenia z danymi spoza Google | Mapbox: płatne MAU. Google Maps: patrz R3 |
| Słońce i Księżyc | biblioteka astronomiczna w `packages/core` (np. suncalc) | liczone offline, bez API | — |
| Eksport dokumentu | DOCX (biblioteka `docx`) i PDF z tego samego modelu sekcji | wzór użytkownika jest w DOCX | — |
| Testy | Vitest w pakietach i na webie, Jest (`jest-expo`) w aplikacji mobilnej, `supabase test db` (pgTAP) dla RLS, Playwright (web), Maestro (Android) | pakiety to czysty TS (ESM, importy z `.ts` dla Deno) — Vitest uruchamia je bez konfiguracji; RLS to warstwa bezpieczeństwa, musi mieć testy | Jest w pakietach: osobna konfiguracja ESM/TS bez zysku |
| Hosting | Supabase (Pro od MVP, patrz R8), Vercel (web), R2/CDN (kafle, audio) | — | — |

### Struktura repozytorium (monorepo, npm workspaces)

```
apps/web/            Next.js — Planner Hub + strona linku publicznego
apps/mobile/         Expo — Pocket Guide
packages/core/       czysty TS: typy domeny, schematy Zod (w tym Price, BookingDetails),
                     silnik harmonogramu i ograniczeń, słońce/Księżyc, ceny dla grupy,
                     rozliczenia, czas i strefy, łatki planu (testowany bez sieci)
packages/ai/         polecenia, adaptery dostawców, walidacja i naprawa JSON
packages/db/         typy wygenerowane z Supabase, wspólne zapytania
packages/export/     model sekcji dokumentu → DOCX / PDF / HTML (link publiczny)
supabase/
  migrations/        SQL: tabele, RLS, triggery (updated_at, plan_version)
  functions/         Edge Functions (Deno): ai-*, places-*, offline-manifest, share-public, export-doc
  tests/             pgTAP: testy polityk RLS
fixtures/plans/      przykładowe plany z exaples/ w postaci danych (test schematu i regresji AI)
```

Zasada: **logika domenowa żyje w `packages/core` i jest identyczna na webie, telefonie i w Edge Functions** (np. przeliczenie harmonogramu po opóźnieniu działa offline na telefonie i daje ten sam wynik co na serwerze).

---

## 3. Moduły funkcjonalne

Priorytety: **M** = MUST (MVP), **S** = SHOULD (v1.0), **C** = COULD (później).

### M1. Konto i wyjazdy
- M: logowanie przez Google oraz magic link (własny SMTP, W11). Profil: nazwa, język, waluta domowa.
- M: lista wyjazdów, tworzenie, archiwizacja, kopiowanie wyjazdu jako szablonu.
- M: status wyjazdu: `draft` → `planned` → `active` → `done` → `archived`.
- M: pulpit wyjazdu: daty, uczestnicy, noclegi (np. „1 + 5 + 5 = 11 nocy”), km za kierownicą i najdłuższy dzień, koszt całości / zapłacone / do wydania, otwarte zadania, najbliższe terminy (koniec darmowego odwołania, decyzje).

### M2. Kreator wyjazdu (Prompt Builder) — web
Ustrukturyzowany formularz, zapisywany jako `trip_brief` i walidowany schematem Zod:
- M: **założenia** (cel wyjazdu wolnym tekstem: „nocka w chatce to główna atrakcja”, „zdobyć Dinarę”).
- M: lokalizacja (kraj, miasto, region lub trasa jako lista punktów), daty konkretne albo elastyczne („4 dni w maju”), profil wyjazdu (wielokrotny wybór), transport, budżet (low / medium / premium + waluta), ograniczenia (dieta i alergie, bariery architektoniczne, godzina startu i końca dnia, tempo, maks. godzin za kierownicą dziennie, bez jazdy po zmroku).
- M: **uczestnicy** z imieniem i wiekiem (wiek decyduje o cenach i trudności tras), rodziny, najmłodszy jako miara tempa.
- M: **co już jest ustalone**: kupione loty, zarezerwowane noclegi, stałe punkty (mecz o 17:00). Wchodzą do planu jako stałe, AI planuje wokół nich.
- S: punkty obowiązkowe i wykluczone.
- Elastyczne daty: AI proponuje termin, ale do generowania planu użytkownik wybiera konkretne daty (potrzebne do godzin otwarcia, świąt, słońca i pogody).

### M3. Silnik AI — szczegóły w §4
- M: Etap 1 (warianty szkieletu), Etap 2 (pula + harmonogram + audyt zapasu), „przelicz dzień z poleceniem”.
- S: Etap 3 (czat dostrajający jako łatki), Etap 4 (logistyka i kandydaci do porównania), Etap 5 (informacje praktyczne, pakowanie, TODO).
- S: import rezerwacji: PDF, zrzut ekranu albo wklejony mail → AI wyciąga dane do `bookings` (jak zdjęcie posiłku w FormaSync).
- S: **import istniejącego planu** (DOCX/PDF jak w `exaples/`) → pełna struktura wyjazdu do przejrzenia i akceptacji.

### M4. Edytor planu (Planner Hub) — web
- M: widok dni (kolumny lub lista) i mapa obok. Przeciąganie punktów w obrębie dnia i między dniami. Edycja punktu: precyzja i godziny, czas trwania (także przedział), bufor, stała godzina, priorytet, cena, płatność, notatka, linki, uczestnicy.
- M: **pula** obok dni: kandydaci, alternatywy, „nie mieści się”, „w pakiecie”, pogrupowane po obszarach. Przeciągnięcie z puli do dnia = zaplanowanie.
- M: **warianty**: tworzenie grupy (punkt / blok / dzień), etykiety A/B, rekomendacja, warunek, termin decyzji, przełączanie aktywnego wariantu.
- M: dodanie punktu z wyszukiwarki miejsc albo **własnej pinezki** na mapie.
- M: automatyczne przeliczenie godzin i przejść po każdej zmianie. Panel dnia: suma jazdy (km, h), zapas czasu, naruszone ograniczenia, słońce (wschód, zachód, zmierzch), święto.
- M: notatki dnia i punktu (wstęp, porady, ostrzeżenia), audyt zapasu czasu.
- S: widok kalendarza (tydzień, siatka godzin, drag & drop), przeciąganie pinezek na mapie, cofnij/ponów, nazwane wersje planu i porównanie wersji.
- S: **eksport DOCX/PDF według wzoru** (sekcje: Założenia, Termin, Uczestnicy, Transport, Zakwaterowanie, Sprzęt, Harmonogram, Trasy, Koszty, Inne, Do ustalenia, TODO, Źródła), eksport ICS.

### M5. Mapy, miejsca, trasy i ślady
- M: geokodowanie i wyszukiwanie miejsc, karta miejsca (adres, godziny otwarcia, strona, źródło danych). Własne pinezki (`provider = 'user'`).
- M: czasy i dystanse przejść pieszo, autem i rowerem z serwisu routingu. Komunikacja publiczna jako szacunek + deep link (patrz R5).
- M: przejście z instrukcją („R2 Nord do Passeig de Gràcia, co ~30 min, potem L4”), linią, częstotliwością i biletem lub karnetem, który je pokrywa.
- M: przejścia (`legs`) liczone przy zmianie planu i zapisywane z linią trasy, żeby działały offline.
- S: **ślady GPX** (import pliku albo eksport z mapy.com / Komoot): długość, przewyższenie, szacowany czas, trudność, oznakowanie, opis dojścia. Widoczne offline na mapie z własną pozycją i odległością od śladu.
- Nawigacja: przycisk „Prowadź” = deep link do Google Maps / mapy.com / OsmAnd.

### M6. Pulpit „Tu i teraz” — Android
- M: ekran główny zależny od czasu i pozycji: „Trwa teraz”, „Następny punkt za 45 min”, „Przejście: pieszo 12 min”, przycisk „Prowadź”, zachód słońca dziś.
- M: **„Zostajemy dłużej”** (+15 / +30 / +60 min, własna wartość) → zdarzenie `schedule_events` i natychmiastowe przeliczenie reszty dnia (§7). Działa offline. Jeśli opóźnienie łamie ograniczenie („dojazd po zmroku”), aplikacja proponuje cięcia według `cut_rank`.
- M: „Pomiń punkt”, „Zrobione”, przełączenie wariantu, „Co w pobliżu z puli?” przy wolnym czasie.
- M: przypomnienie o terminie decyzji („15:00 — decyzja: chatka czy schronisko”).
- M: oś dnia (lista), mapa dnia z własną pozycją.
- M: obsługa jedną ręką: najważniejsze akcje w dolnej połowie ekranu, duże cele dotyku.
- S: widżet na ekran główny Androida.

### M7. Offline-first — Android
- M: **„Pobierz wyjazd offline”** ściąga jeden pakiet według manifestu (`offline-manifest`):
  1. dane planu (migawka z `plan_version`, w tym pula, warianty, notatki, kontakty, zadania, pakowanie) do SQLite,
  2. kafle mapy obszaru (bbox wszystkich punktów i śladów + margines; patrz PoC-2),
  3. ślady GPX (S),
  4. transkrypcje audio (M) i pliki audio (S),
  5. dokumenty z sejfu oznaczone „offline” oraz treść kodów QR.
- M: pobieranie z postępem, wznawialne, z rozmiarem pokazanym przed startem i kontrolą wolnego miejsca. Pliki weryfikowane przez sha256.
- M: plakietka „plan zmienił się od pobrania” i aktualizacja przyrostowa (tylko dane, bez ponownych kafli).
- M: zapisy offline (opóźnienia, statusy, wydatki, odhaczone pakowanie i zadania, notatki) trafiają do outboxa i wysyłają się po powrocie sieci (§6).

### M8. Audioprzewodnik
- M: transkrypcja dla punktu (generowana przez AI z ugruntowaniem w Wikipedii/Wikivoyage, ze źródłami i licencją), odczyt **syntezatorem w telefonie** (`expo-speech`): zero kosztów, działa offline. Ręczne uruchamianie z listy lub z karty punktu.
- S: odtwarzanie w tle przy wygaszonym ekranie, sterowanie z powiadomienia.
- S: wyzwalanie geofencingiem: systemowe geofence 100–150 m budzi aplikację → powiadomienie „Jesteś przy X — odtworzyć?” (patrz R4). W tle zdarzenie przychodzi z opóźnieniem ok. 2–3 min, a po restarcie telefonu geofence trzeba zarejestrować ponownie. Autoodtwarzanie tylko w jawnie włączonym „Trybie spaceru” (usługa pierwszoplanowa, dokładniejszy GPS, wyższe zużycie baterii).
- S: nagrania premium (TTS w chmurze generowany w fazie planowania, MP3 w Storage). Wersja dla dzieci (prostszy język), bo w planach są dzieci 5–16 lat.
- C: licencjonowane ścieżki lektorskie.

### M9. Współpraca i udostępnianie
- M (schemat + minimum UI): role `owner` / `editor` / `viewer` egzekwowane przez RLS, zaproszenie linkiem z rolą i terminem ważności.
- M: uczestnicy (`travelers`) z imieniem, wiekiem, rodziną i opiekunem. Powiązanie z kontem opcjonalne.
- M: realtime: zmiana na laptopie widoczna na telefonie z siecią (Supabase Realtime, subskrypcja per `trip_id`).
- S: edytor w UI (współbieżna edycja: ostrzeżenie „ktoś zmienił ten punkt”), obecność („Anna edytuje dzień 2”), dziennik aktywności.
- S: link publiczny tylko do odczytu: SSR w układzie wzoru, ładny podgląd, ukrywane zakresy (koszty, sejf, adres noclegu, imiona), unieważnialny.
- S: punkty dla części grupy (`item_participants`), np. szpica idzie wcześniej po miejsca.
- C: równoległe ścieżki dnia dla podgrup, podział na auta (`vehicles`), katalog publicznych planów.

### M10. Budżet i portfel
- M: **budżet planowany** (`budget_lines`): pozycje z kategorią i statusem `estimate` / `committed` / `paid`, kwota jako przedział (scenariusz oszczędnie / wygodnie), waluta i kurs z datą. Pozycje z rezerwacji i cen punktów zasilają budżet automatycznie, reszta to wpisy ręczne (paliwo, jedzenie, bramki).
- M: widok: zapłacone / do wydania (od–do) / całość / na osobę, per kategoria.
- S: **portfel** (wydatki rzeczywiste): kto zapłacił, kwota, waluta, kategoria, podział (po równo / udziały / kwoty / **na rodziny**), powiązanie z punktem lub rezerwacją, zdjęcie paragonu.
- S: kurs waluty zapamiętany z dnia wydatku (kursy EBC). Kwota bazowa liczona i zapisana raz.
- S: saldo osób lub rodzin i minimalna liczba przelewów do rozliczenia, oznaczanie rozliczeń.
- S: plan vs rzeczywistość per kategoria i dzień.
- Działa offline: wydatki są zdarzeniami dopisywanymi (§6).

### M11. Rezerwacje i sejf (Vault)
- M: rezerwacje (`bookings`): lot, pociąg, autobus, prom, nocleg, wynajem auta, transfer, kierowca z terenówką, pakiet atrakcji, bilet, karnet komunikacji, ubezpieczenie, eSIM, bagaż. Status: `idea` → `candidate` → `to_book` → `booked` → `paid` (lub `cancelled`).
- M: pola, które decydują o podróży: kod potwierdzenia, początek i koniec z **osobnymi strefami**, miejsce odbioru i zwrotu, zameldowanie od / wymeldowanie do, cena i zapłacona kwota, sposób i moment płatności (gotówka na miejscu, karta, przedpłata), bezzwrotność, **darmowe odwołanie do**, co jest w cenie (powiązane punkty dostają status „w pakiecie”), skład osobowy zgłoszony u operatora.
- M: szczegóły zależne od rodzaju (Zod, `details`): lot (numer, lotniska, bagaż), auto (klasa, limit km, cena za km ponad limit, kaucja, ubezpieczenie, polityka paliwa, minimalny wiek kierowcy, godziny biura), nocleg (pokoje, łóżka, łazienki, udogodnienia).
- M: dokumenty: PDF i obrazy powiązane z rezerwacją lub punktem. Karta hotelu ma przycisk „Pokaż kod rezerwacji”. Kod QR/kreskowy wyciągnięty z pliku i renderowany natywnie w pełnej jasności ekranu.
- M: widoczność dokumentu: `all` / `owner` / wybrane osoby (paszport ≠ bilet grupowy).
- M: kontakty (gospodarz, operator, wypożyczalnia, numery alarmowe) na karcie rezerwacji i wyjazdu, z jednym dotknięciem „Zadzwoń”.
- S: **porównanie kandydatów** (2–3 noclegi, klasy aut, pakiety ubezpieczeń): tabela atrybutów, plusy, minusy, rekomendacja, data sprawdzenia ceny. Wybór kandydata = status `to_book`.
- S: kontrole automatyczne: alert przed końcem darmowego odwołania, skład osobowy u operatora vs wiek uczestników, suma km trasy vs limit auta, godzina zwrotu vs godziny biura.
- S: import rezerwacji przez AI (M3).

### M12. Warianty, ograniczenia, bufory, pogoda
- M: **grupy wariantów** (zastępują „Plan B” z v0.1): zasięg punkt / blok punktów / dzień / układ wyjazdu / rezerwacja. Warunek (wybór, pogoda, zamknięte, opóźnienie, dostępność miejsca, samopoczucie), rekomendowany wariant, termin decyzji, uzasadnienie.
- M: **ograniczenia** (`constraints`): dotrzeć przed, wyjechać nie później niż, zakończyć przed zachodem, bez jazdy po zmroku, minimum czasu w miejscu, biuro otwarte o godzinie zwrotu. Twarde i miękkie.
- M: bufory: `buffer_after_min` per punkt, domyślne bufory per typ (muzeum +15 min na kolejkę, odbiór auta 30 min, kontrola paszportowa 30–60 min).
- M: **audyt zapasu czasu** per dzień: zapas liczony przez silnik (§7), lista cięć według `cut_rank`, opis od AI („dzień ciasny, najprostsze cięcie: jeden zabytek zamiast dwóch”).
- S: prognoza Open-Meteo (do 16 dni wprzód) → alert „Dzień 3: deszcz od 13:00, przełączyć wariant?”. Zadanie „go / no-go 2 dni przed” z prognozą w treści.
- S: alerty czasowe: „nie zdążycie przed zamknięciem X”, „ostatni pociąg o 22:10”.

### M13. Powiadomienia
- M: lokalne powiadomienia z osi dnia („Za 15 min wyjście do X”) i terminów decyzji, planowane z góry na dzień, odtwarzane po opóźnieniu, restarcie i aktualizacji (W3). Uprawnienia Androida 13+ i dokładne alarmy jak w FormaSync.
- S: push zdalny (Expo Push / FCM) o zmianach od innych członków, zadaniach z terminem i alertach.

### M14. Zadania i decyzje (przed wyjazdem i w trakcie)
- M: `tasks` w trzech rodzajach: **todo** („zadzwonić do schroniska”), **pytanie** („czy w chatce jest drewno?”, z miejscem na odpowiedź), **decyzja** („godzina zero w sobotę”, powiązana z grupą wariantów).
- M: termin absolutny albo względny: „dzień przed punktem”, „2 dni przed wyjazdem”, „przed rezerwacją”. Osoby przypisane, powiązanie z rezerwacją lub punktem, priorytet.
- M: lista na webie i telefonie, odhaczanie offline.
- S: przypomnienia push, zadania generowane przez AI (Etap 5) i przez kontrole automatyczne (np. „wpisz faktyczne wieki dzieci w rezerwacji bezzwrotnej”).

### M15. Lista pakowania
- S: `packing_items` w kategoriach (dokumenty i pieniądze, ubrania, sprzęt, apteczka, auto, drobiazgi). Zasięg: **osobista** (każdy uczestnik, też dzieci) albo **wspólna** z przypisaniem „kto bierze”. Ilość i notatka („2 siatki suchego drewna”).
- S: odhaczanie per osoba na telefonie, offline. Rodzic odhacza za dziecko.
- S: generowanie przez AI pod warunki wyjazdu (Etap 5) i kopiowanie z poprzedniego wyjazdu.

### M16. Informacje praktyczne i źródła
- M: notatki z zasięgiem (wyjazd / dzień / punkt / rezerwacja) i tematem: pogoda sezonowa, dokumenty i wiza, pieniądze (waluta zamknięta, gotówka), zdrowie, bezpieczeństwo, kultura i ubiór, transport, zasady miejsca.
- M: źródła (`sources`): URL, tytuł, data sprawdzenia. Przypinane do ceny, godzin otwarcia, opisu. Plakietka „sprawdzone 16.10.2026”, ostrzeżenie, gdy dane są starsze niż N dni przed wyjazdem.
- S: generowanie przez AI (Etap 5) z wymogiem podania źródeł.

---

## 4. Silnik AI

### Zasady
1. **Łańcuch etapów, nie jedno zapytanie.** Każdy etap to osobny wpis w `ai_runs` (wejście, wyjście, model, tokeny, koszt, czas, status). Daje to wznawialność, podgląd postępu i mieszczenie się w limicie czasu Edge Function.
2. **Structured Outputs.** Każdy etap ma schemat JSON (z Zod w `packages/core`). Odpowiedź przechodzi przez walidator: niezgodna → jedna próba naprawy z błędami walidacji w poleceniu → status `invalid`.
3. **AI nie zna godzin otwarcia, współrzędnych, świąt ani zachodu słońca.** Model proponuje *nazwy i intencje*, a krok **ugruntowania** (kod, nie AI) dopasowuje je do realnych miejsc i dokłada fakty: godziny otwarcia, święta państwowe, słońce, strefę czasową. Punkty niedopasowane są oznaczone i nie trafiają na mapę bez potwierdzenia. Fakty liczone przez kod idą do modelu jako wejście kolejnego etapu (por. plan Maroka: zachód słońca o godzinę inny, niż w starych przewodnikach).
4. **Propozycja → akceptacja.** Wynik etapu to draft pokazany jako podgląd lub diff. Do tabel planu trafia dopiero po akceptacji. Ponowne przeliczenie zastępuje draft, nie dokłada drugiego (W5).
5. **Ręczne zmiany są święte.** Punkty edytowane ręcznie i elementy „już ustalone” (kupione loty, rezerwacje) dostają `user_locked = true`, a AI dostaje je jako ograniczenia, których nie wolno ruszać.
6. **Uczciwość co do niepewności.** Ceny i fakty bez źródła są oznaczone jako szacunek (`SZAC.`), każda cena ma datę sprawdzenia albo flagę „rząd wielkości”. AI ma wprost mówić, czego się nie da zmieścić, zamiast udawać, że się mieści.
7. **Dostawca wymienny** (W4): Claude, Gemini i OpenAI za jednym interfejsem, model wybierany z listy pobranej z API, klucze w sekretach Edge Functions, limit wywołań i koszt per użytkownik/dzień.

### Etapy

| Etap | Wejście | Wyjście (schemat) | Po stronie kodu |
|---|---|---|---|
| 1. Szkielet | `trip_brief` + elementy ustalone | **2–3 warianty** układu: dni, bazy i noclegi per noc, przejazdy między bazami, metryki (km, najdłuższy dzień za kierownicą, liczba zmian noclegu), rekomendacja, uzasadnienie, „czego nie da się zrobić” | czasy przejazdów z routingu, kontrola metryk, grupa wariantów `scope = trip` z tabelą porównania; wybór użytkownika materializuje `days` |
| 2. Punkty i harmonogram | wybrany szkielet + brief + fakty dni (słońce, święta) + punkty zablokowane | **pula** atrakcji per obszar (czas, cena z progami wiekowymi, płatność, status: w planie / alternatywa / nie mieści się / zamiast X), harmonogram dni, warianty A/B w dniu, ograniczenia („nie wyjeżdżać po 15:00”), priorytety i kolejność cięć, notatki dnia i **audyt zapasu** | ugruntowanie → `places`; routing → `legs`; silnik (§7) → godziny, zapas, naruszenia; ceny dla grupy z wieków uczestników |
| 3. Dostrajanie (czat) | plan + historia rozmowy + polecenie | **łatka**: lista operacji (niżej) + krótka odpowiedź | walidacja operacji, podgląd diffu, zastosowanie po akceptacji, ponowne ugruntowanie zmienionych punktów |
| 4. Logistyka | plan + brief + rezerwacje | **kandydaci** do porównania (noclegi per noc lub baza, auta, pakiety, karnety) z atrybutami, warunkami (anulowanie, płatność, kaucja, limit km), plusami, minusami i rekomendacją; budżet oszczędnie / wygodnie | deep linki wyszukiwania, **bez rezerwacji** (W1); kontrole: limit km vs trasa, godziny biura vs zwrot |
| 5. Informacje praktyczne | plan + brief + kraj + sezon | notatki tematyczne, kontakty alarmowe, lista pakowania (osobista / wspólna, pod warunki i skład grupy), TODO z terminami względnymi, źródła | walidacja źródeł (URL odpowiada), terminy zadań liczone od dat wyjazdu |
| Audio | punkt + fragment z Wikipedii/Wikivoyage + wiek odbiorców | transkrypcja 1–3 min (opcjonalnie wersja dla dzieci), źródła | zapis atrybucji (CC BY-SA), opcjonalnie TTS |
| Import rezerwacji | PDF / obraz / tekst maila | `booking` (rodzaj, kod, daty i strefy, adres, cena, warunki, skład osobowy, co w cenie) | dopasowanie do dnia lub punktu, potwierdzenie przez użytkownika |
| Import planu | DOCX / PDF istniejącego planu | cały wyjazd: uczestnicy, dni, punkty z precyzją godzin, warianty, rezerwacje, budżet, notatki, zadania, pakowanie, źródła | ugruntowanie miejsc, podgląd do akceptacji per sekcja |

Operacje łatki (Etap 3):
```json
{ "ops": [
  { "op": "replace_item", "itemId": "…", "with": { "kind": "meal", "query": "wegańska restauracja blisko Duomo", "diet": ["vegan"] } },
  { "op": "remove_item",  "itemId": "…", "reason": "dzień 3 za męczący", "toPool": true },
  { "op": "move_item",    "itemId": "…", "toDayId": "…", "position": 2 },
  { "op": "add_item",     "dayId": "…", "after": "…", "item": { "kind": "visit", "query": "…", "durationMin": 60 } },
  { "op": "set_field",    "itemId": "…", "field": "durationMin", "value": 90 },
  { "op": "add_variant",  "scope": "block", "itemIds": ["…", "…"], "label": "B · Paradise Valley", "condition": "choice" }
], "message": "Zamieniłem obiad w dniu 2 na wegański…" }
```
Łatka zamiast całego planu: tańsza, reviewowalna i nie rusza reszty. Usunięty punkt domyślnie wraca do puli, a nie znika.

### Wnioski z PoC-1 (szczegóły w POC_WYNIKI.md)
- Etap 2 w częściach po 1–2 dni, równolegle, jako zadanie w tle z postępem — nie jedno długie żądanie.
- Miejsca z AI mają `searchName` (nazwa lokalna/angielska) i kategorię z ustalonej listy; opisowe („restauracja w centrum”) bez `searchName`.
- Kotwice czasu w każdym dniu (`dayStart`, `dayEnd`, posiłki z przybliżoną godziną) — bez nich harmonogram ściska się do południa.
- Kod sprząta pomyłki formalne (odwołania do rezerwacji w etapie 2, przedrostki, doklejony tekst po JSON-ie), naprawa przez model zostaje na merytoryczne.

### Kontrola jakości AI (mierzona od PoC)
- % punktów ugruntowanych (dopasowanych do realnego miejsca w promieniu X m),
- % punktów zaplanowanych w godzinach otwarcia (gdzie godziny są znane),
- realizowalność dnia: suma czasów + przejścia + bufory ≤ okno dnia, brak naruszonych ograniczeń twardych,
- zgodność z planami referencyjnymi z `exaples/` (czy AI widzi te same ryzyka: zachód słońca, kolejki, godziny biura, limity km),
- koszt i czas wygenerowania planu 4-dniowego per dostawca.

---

## 5. Model danych (Postgres)

### Konwencje (od pierwszej migracji)
- `id uuid` generowany **na kliencie** (UUIDv7), żeby obiekty tworzone offline miały stały identyfikator.
- Każda tabela wyjazdu ma `trip_id`: proste RLS i proste wycinanie pakietu offline.
- `created_at`, `updated_at` (trigger), `updated_by`, `deleted_at` (miękkie usuwanie, potrzebne do synchronizacji; twarde `DELETE` odebrane rolom klienta).
- `row_version bigint` (trigger): każdy zapis w wyjeździe podbija `trips.sync_version` i stempluje nim wiersz — po tym telefon pobiera zmiany (§6, sprawdzone w PoC-4).
- `trips.plan_version` podbijany triggerem przy każdej zmianie planu.
- **Pieniądze w rozliczeniach:** `amount_minor bigint` + `currency char(3)`. Nigdy float.
- **Ceny w planie:** pole `price jsonb` o schemacie `Price` (Zod):
  ```
  Price = { currency, basis: per_person | per_group | per_unit | per_night | per_day,
            min_minor, max_minor,            // równe = cena dokładna
            from: bool,                      // „od ok. 850 MAD”
            approx: bool,                    // SZAC. / rząd wielkości
            tiers?: [{ label, min_age?, max_age?, amount_minor }],  // dorosły od 13, dziecko 7–13…
            note?, checked_at?, source_id? }
  ```
  Kwota dla grupy jest liczona w `packages/core` z wieków uczestników (i z `item_participants`, jeśli punkt dotyczy części grupy).
- **Czas:** zdarzenia planu jako **czas lokalny + strefa IANA**; prawdziwe chwile (wydatek, opóźnienie) jako `timestamptz`. Wyjazd przez kilka stref jest od początku przewidziany.
- **Precyzja czasu punktu** (`time_precision`): `exact` (09:45), `approx` (~09:30), `range` (11:45–12:45), `part_of_day` (rano / południe / popołudnie / wieczór / noc), `day` (cały dzień, bez godzin), `relative` (`+1:20` od kotwicy dnia albo od końca poprzedniego kroku — `relative_from`). Godzina może mieć własną strefę (`time_tz`), gdy różni się od strefy dnia: punkt na lotnisku wylotu w dniu, który żyje w strefie celu.
- Kolejność: `sort_key text` (fractional indexing), żeby przeciąganie zmieniało jeden wiersz.
- Pola `jsonb` mają zawsze schemat Zod w `packages/core` i są walidowane przy zapisie (Edge Function lub check w kliencie).
- Surowe odpowiedzi zewnętrznych źródeł w `raw jsonb` (W2).

### Tabele — rdzeń

| Tabela | Kluczowe kolumny | Uwagi |
|---|---|---|
| `profiles` | `id` (= auth.uid), `display_name`, `locale`, `home_currency` | |
| `trips` | `owner_id`, `title`, `subtitle`, `goal` (założenia), `status`, `start_date`, `end_date`, `primary_tz`, `base_currency`, `plan_version`, `cover_path` | |
| `trip_members` | `trip_id`, `user_id`, `role` (owner/editor/viewer), `can_add_expenses` | PK (trip_id, user_id) |
| `trip_invites` | `trip_id`, `role`, `token_hash`, `expires_at`, `max_uses`, `used_count` | w bazie tylko hasz tokena (jak skrytka FormaSync) |
| `public_shares` | `trip_id`, `token_hash`, `hide` (jsonb: costs, vault, lodging_address, names), `enabled` | odczyt tylko przez Edge Function `share-public` |
| `travelers` | `trip_id`, `user_id` (nullable), `name`, `nickname`, `age` (w chwili wyjazdu), `household` (rodzina), `guardian_traveler_id`, `is_driver`, `diet`, `notes` | uczestnicy, także bez konta |
| `trip_brief` | `trip_id`, `goal`, `location`, `dates`, `profiles`, `transport`, `budget_level`, `currency`, `constraints`, `fixed` (już ustalone), `must_see`, `avoid` | dane z formularza, schemat Zod |
| `days` | `trip_id`, `date`, `day_index`, `tz`, `title`, `summary` (wstęp dnia), `base_place_id`, `lodging_booking_id` albo `lodging_group_id` (grupa kandydatów — dzień pokazuje wybranego), `anchor_time` (godzina zero, nullable), `day_start`, `day_end` | słońce, Księżyc, święta liczone, nie przechowywane |
| `places` | `provider` (osm/geoapify/…/user), `provider_id`, `name`, `lat`, `lng`, `address`, `category`, `opening_hours` (raw + parsed), `website`, `wikidata_id`, `raw`, `fetched_at`, `created_by` | wspólna pamięć podręczna miejsc. Pinezki `user` widoczne tylko w swoim wyjeździe |

### Tabele — plan

| Tabela | Kluczowe kolumny | Uwagi |
|---|---|---|
| `items` | `trip_id`, `day_id` (**nullable = pula**), `area` (obszar puli: „Essaouira”), `kind` (visit/activity/meal/transport/lodging/errand/meetup/free/decision), `plan_status` (scheduled/candidate/alternative/does_not_fit/rejected), `replaces_item_ids uuid[]`, `variant_ids uuid[]` (pusto = we wszystkich wariantach), `parent_item_id` (blok z podpunktami równoległymi), `title`, `description`, `place_id`, `lat`/`lng`, `sort_key` (**wymagany** przy punkcie z dniem), `time_precision`, `time_tz`, `start_time`, `end_time`, `part_of_day`, `offset_min`, `relative_from` (anchor/previous), `leg` (jsonb: szczegóły przejazdu przy `kind = transport` — tryb, linia, instrukcja, częstotliwość, przesiadki, alternatywa, karnet), `duration_min`, `duration_max`, `buffer_after_min`, `is_fixed`, `priority` (must/should/optional), `cut_rank`, `status` (planned/done/skipped), `price` (Price), `payment` (cash_only/card/prepaid/included/free; punkt w pakiecie = `booking_id` + `included`), `booking_id` albo `booking_group_id` (grupa kandydatów, np. „zwrot auta”), `weather` (outdoor/indoor/any), `activity` (jsonb: dystans, przewyższenie, trudność, `track_id`), `links` (jsonb `[{label,url}]`), `source` (ai/user/import), `ai_run_id`, `user_locked` | `errand` = bankomat, tankowanie, zakupy; `decision` = punkt decyzji w osi dnia |
| `item_participants` | `item_id`, `traveler_id` | brak wierszy = cała grupa |
| `variant_groups` | `trip_id`, `scope` (item/block/day/trip/booking), `day_id`, `title`, `condition_kind` (choice/weather/closure/schedule_slip/availability/wellbeing), `condition_text`, `decide_by_local` + `decide_by_tz`, `chosen_variant_id`, `rationale` (markdown), `comparison` (jsonb: kolumny i wartości tabeli porównania) | `scope = trip` jest opisowy (porównanie układów z Etapu 1). Wybrany wariant materializuje dni |
| `variants` | `group_id`, `label` („A · pustynia drugiej nocy”), `summary`, `recommended`, `pros`, `cons`, `metrics` (jsonb), `excludes_item_ids uuid[]` (punkty, które wariant wyrzuca), `sort_key` | punkty wskazują warianty przez `variant_ids`, kandydat-rezerwacja przez `variant_id` |
| `constraints` | `trip_id`, `day_id`, `item_id`, `booking_id`, `kind` (arrive_before/depart_before/finish_before_sunset/no_driving_after_dark/latest_start/min_time_at/must_be_open/office_open_at), `value` (jsonb), `severity` (hard/soft), `reason` | sprawdzane przez silnik (§7) |
| `legs` | przejścia **niejawne** (bez własnego wiersza w planie); przejazd z godziną jest punktem `transport`. `trip_id`, `from_item_id`, `to_item_id`, `mode` (walk/hike/car/rental_car/taxi/hired_driver/bus/metro/tram/train/ferry/boat/cable_car/flight/bike), `duration_min`, `distance_m`, `polyline`, `instructions`, `line`, `frequency_min`, `ticket_booking_id` (karnet), `price` (Price), `source` (routing/estimate/manual), `computed_at` | |
| `schedule_events` | `trip_id`, `day_id`, `item_id`, `kind` (delay/skip/done/choose_variant/pull_from_pool), `minutes`, `payload`, `created_by`, `device_id`, `occurred_at` | **tylko dopisywane**, bezkonfliktowe offline (§6) |
| `tracks` | `trip_id`, `item_id`, `name`, `gpx_path`, `geojson` (uproszczony), `distance_m`, `ascent_m`, `descent_m`, `est_duration_min`, `difficulty`, `waymarking`, `route_notes`, `source_url`, `offline` | S |
| `plan_snapshots` | `trip_id`, `label` („v4”), `snapshot` (jsonb), `created_by`, `created_at` | S, porównanie wersji |

### Tabele — logistyka, pieniądze, organizacja

| Tabela | Kluczowe kolumny | Uwagi |
|---|---|---|
| `bookings` | `trip_id`, `kind` (flight/train/bus/ferry/lodging/car_rental/transfer/driver_hire/activity/package/ticket/transit_pass/insurance/esim/luggage/other), `status` (idea/candidate/to_book/booked/paid/cancelled/unknown/not_required), `variant_group_id` (porównanie kandydatów), `variant_id`, `recommended`, `provider`, `title`, `confirmation_code`, `start_date`, `start_time` (nullable), `start_precision`, `start_tz`, to samo dla końca, `start_place_id`, `end_place_id`, `check_in_from`, `check_out_until`, `price` (Price), `paid_minor`, `paid_at`, `paid_by_traveler_id`, `payment_method` (cash/card/credit_card_only/online), `pay_when` (prepaid/on_site/before_arrival), `refundable`, `free_cancellation_until`, `party` (jsonb: skład zgłoszony u operatora), `includes` (text[]), `addons` (jsonb: ubezpieczenie z udziałem własnym, pakiet km, sprzęt — kupowane razem z rezerwacją), `language`, `details` (jsonb, schemat per `kind`), `pros`, `cons`, `rating`, `links`, `raw` | punkty „w pakiecie” wskazują `booking_id` |
| `documents` | `trip_id`, `booking_id`, `item_id`, `storage_path`, `file_name`, `mime`, `size`, `sha256`, `visibility` (all/owner/members), `visible_to uuid[]`, `offline`, `code_payload`, `code_format` | prywatny bucket, ścieżka `trip_id/…` |
| `contacts` | `trip_id`, `booking_id`, `name`, `role` (host/operator/rental/guide/emergency/other), `phone`, `email`, `messenger`, `notes` | numery alarmowe = `role = emergency` |
| `budget_lines` | `trip_id`, `category` (flights/lodging/car/fuel/tolls_parking/tickets/activities/food/luggage/insurance/other), `title`, `booking_id`, `item_id`, `status` (estimate/committed/paid), `low_minor`, `high_minor`, `currency`, `fx_rate`, `fx_date`, `base_low_minor`, `base_high_minor`, `per_person`, `source_id`, `auto` (wyliczona z rezerwacji/punktu) | zastępuje `budgets` z v0.1 |
| `expenses` | `trip_id`, `payer_traveler_id`, `amount_minor`, `currency`, `fx_rate`, `fx_source`, `base_amount_minor`, `category`, `item_id`, `booking_id`, `budget_line_id`, `paid_at`, `note`, `receipt_document_id`, `split_mode` (equal/shares/exact/households) | S |
| `expense_splits` | `expense_id`, `traveler_id` / `household`, `weight` / `amount_minor` | S |
| `settlements` | `trip_id`, `from_traveler_id`, `to_traveler_id`, `amount_minor`, `currency`, `settled_at` | S |
| `tasks` | `trip_id`, `kind` (todo/question/decision), `title`, `body`, `answer`, `status` (open/done/dropped), `due_kind` (absolute/before_trip/before_item/before_booking/on_trip), `due_at_local`, `due_offset_min`, `anchor_item_id`, `anchor_booking_id`, `variant_group_id`, `assignees uuid[]` (travelers), `priority`, `source` (user/ai/check), `sort_key` | |
| `packing_items` | `trip_id`, `category`, `title`, `note`, `scope` (personal/shared), `quantity`, `unit`, `assignee_traveler_id` (dla wspólnych), `sort_key` | S |
| `packing_checks` | `packing_item_id`, `traveler_id`, `packed`, `checked_at` | S, odhaczanie per osoba |
| `notes` | `trip_id`, `scope` (trip/day/item/booking/variant_group), `entity_id`, `kind` (info/tip/warning/safety/rationale/slack_audit/practical), `topic` (weather/documents/money/health/safety/culture/transport/rules/packing/other), `title`, `body` (markdown), `sort_key` | |
| `sources` | `trip_id`, `url`, `title`, `checked_at`, `note` | |
| `source_links` | `source_id`, `entity`, `entity_id`, `field` | do czego odnosi się źródło |
| `vehicles` | `trip_id`, `booking_id`, `label`, `driver_traveler_id`, `seats`, `notes` + `vehicle_passengers` | C |

### Tabele — AI, audio, pogoda, historia

| Tabela | Kluczowe kolumny | Uwagi |
|---|---|---|
| `audio_guides` | `trip_id`, `item_id`/`place_id`, `lang`, `audience` (adult/child), `title`, `text`, `sources`, `license`, `audio_path`, `voice`, `duration_s`, `trigger_radius_m`, `status` | |
| `ai_runs` | `trip_id`, `stage`, `provider`, `model`, `input`, `output`, `status` (pending/ok/invalid/failed/accepted/rejected), `validation_errors`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `parent_run_id`, `created_by` | audyt, koszty, wznawianie |
| `ai_messages` | `trip_id`, `role`, `content`, `ai_run_id`, `created_by` | czat Etapu 3 |
| `weather_snapshots` | `trip_id`, `day_id`, `lat`, `lng`, `forecast`, `fetched_at` | |
| `activity_log` | `trip_id`, `actor_id`, `action`, `entity`, `entity_id`, `diff`, `created_at` | historia zmian, „kto co zmienił”, cofanie |

### Uprawnienia (RLS)

| Zasób | owner | editor | viewer | link publiczny |
|---|---|---|---|---|
| plan (days, items, legs, places, variants, constraints, notes, tracks) | RW | RW | R | R (przez Edge Function, z ukryciami) |
| `schedule_events` (opóźnienia, statusy, wybór wariantu) | RW | RW | R (S: opcja „może przesuwać”) | — |
| członkowie, zaproszenia, link publiczny | RW | R | R | — |
| travelers | RW | RW | R | imiona wg `hide` |
| bookings, contacts | RW | RW | R | — |
| documents | RW | RW wg `visibility` | R wg `visibility` | — |
| budget_lines | RW | RW | R | — |
| expenses | RW | RW | dodawanie własnych, jeśli `can_add_expenses` | — |
| tasks | RW | RW | odhaczanie przypisanych do siebie | — |
| packing | RW | RW | odhaczanie własnych i swoich dzieci | — |
| ai_runs, ai_messages | RW | RW | — | — |

Każda polityka ma test pgTAP (np. „widz nie zmieni punktu”, „członek innego wyjazdu nie widzi dokumentu”, „dokument `owner` nie jest widoczny dla edytora”, „widz odhacza tylko własne pakowanie”).

---

## 6. Synchronizacja i offline

Kluczowa obserwacja: **planowanie odbywa się online (web), a podróż offline (telefon)**. Większość danych ma na telefonie charakter „do odczytu”. Zamiast ogólnego silnika synchronizacji z CRDT:

| Klasa danych | Kierunek | Strategia konfliktów |
|---|---|---|
| Plan (days, items, legs, variants, constraints, bookings, places, notes, contacts, tracks, audio) | serwer → telefon | migawka, potem aktualizacja przyrostowa po `row_version > ostatnia widziana` jednym wywołaniem `pull_changes` (jedna migawka bazy), miękkie usunięcia |
| Zdarzenia dnia (`schedule_events`: opóźnienia, pominięcia, wybór wariantu, punkt z puli) | telefon ↔ serwer | **tylko dopisywane**, bez konfliktów. Harmonogram = plan + zdarzenia, liczony w `packages/core` identycznie wszędzie |
| Wydatki, odhaczenia zadań i pakowania, notatki, zdjęcia paragonów | telefon ↔ serwer | dopisywanie bez konfliktów. Edycja: last-write-wins per wiersz (`updated_at` serwera) + wpis w `activity_log` |
| Edycja planu z telefonu (S) | telefon → serwer | tylko online w MVP. Później outbox z kontrolą `version` (odrzucenie, gdy wiersz zmienił się w międzyczasie, z pokazaniem obu wersji) |

Mechanizm na telefonie:
- **Outbox** w SQLite: każda lokalna zmiana to wiersz w kolejce, wysyłany w kolejności, idempotentny (UUID z klienta, `upsert`).
- Po powrocie sieci: wyślij outbox → pobierz zmiany → przelicz harmonogram → przeplanuj powiadomienia.
- Online: Realtime (zmiany w `trip_id`) wyzwala pobranie przyrostowe zamiast stosowania payloadów bezpośrednio (prostsze, odporne na zgubione komunikaty).
- **Dlaczego `row_version`, a nie `updated_at > last_sync`:** znacznik czasu nadaje się w chwili zapisu, a transakcja może zatwierdzić się później niż inna z nowszym znacznikiem — wtedy jej zmiana przepada. Licznik wyjazdu podbijany w triggerze bierze blokadę wiersza `trips` do końca transakcji, więc zapisy jednego wyjazdu dostają wersje w kolejności zatwierdzania.
- Realtime: telefon subskrybuje tylko wiersz swojego wyjazdu (zmienia się przy każdym zapisie) i po sygnale gotowości subskrypcji robi dodatkowe pobranie — bez tego zmiana z chwili łączenia (zimny start Realtime) potrafi przepaść.
- Kod: `packages/sync` (outbox, pobieranie, składanie `TripDocument` z wierszy — ten sam na webie i na telefonie). PoC-4: GO, wariant własny zamiast PowerSync ([POC_WYNIKI.md](POC_WYNIKI.md)).

---

## 7. Silnik harmonogramu i ograniczeń (`packages/core`)

### Fakty dnia (liczone, nie przechowywane)
Wschód, zachód, koniec zmierzchu cywilnego, faza Księżyca dla miejsca bazy dnia. Zmiana czasu (DST) w danym dniu lub nocy. Święto państwowe (z pamięci podręcznej API świąt). Strefa i przesunięcie względem strefy domowej („Gruzja = Polska +2 h”).

### Wyliczanie godzin
Dla aktywnego wariantu każdego dnia, po kolei, z punktów `plan_status = scheduled`:
```
kotwica = anchor_time dnia (jeśli brak: tryb względny, wynik jako +h:mm)
start(i) = max( koniec(i-1) + przejście(i-1→i) + bufor(i-1),
                stała_godzina(i)          jeśli is_fixed,
                otwarcie(i)               jeśli znane )
koniec(i) = start(i) + czas_trwania(i) [przedział: min i max] + suma opóźnień dla i
```
- Kolejność punktów w dniu wyznacza `sort_key`, nie godzina — punkty bez godziny też mają miejsce w kolejności. Punkt `relative` z `from = previous` startuje `offset_min` po **początku** poprzedniego punktu aktywnego wariantu (wzór użytkownika: „0:00 wyjazd”, „+1:20 wyjście na trasę”, choć jazda trwa 1:15; „Trasa (9h)”, „+9:00 powrót do auta”). Gdy koniec poprzedniego punktu wypada później niż wynik, silnik ostrzega o nakładaniu; z `from = anchor` — od kotwicy dnia. Godzina z `time_tz` jest przeliczana na strefę dnia przed porównaniem.
- Punkty wyrzucone przez aktywny wariant (`excludes_item_ids`) nie wchodzą do wyliczeń; punkty z `variant_ids` wchodzą tylko w swoich wariantach.
- Precyzja wyświetlania wynika z `time_precision`: `approx` → „~10:30”, `part_of_day` → pora dnia sprawdzana tylko co do okna, `day` → bez godzin (wyłącznie kontrola sumy czasu dnia).
- Czas trwania jako przedział daje **dwa scenariusze** (optymistyczny i pesymistyczny). Zapas dnia liczy się dla obu.
- Opóźnienie przesuwa wszystko po punkcie **aż do najbliższego punktu ze stałą godziną**, który się nie rusza.
- Punkty z `item_participants` (część grupy) liczone na osobnej ścieżce; cała grupa schodzi się w następnym wspólnym punkcie. Podpunkty bloku (`parent_item_id`) dzieją się równolegle w czasie bloku i nie przesuwają dnia.
- Godzina z planu działa jak „nie wcześniej niż”; pora dnia jak okno. Początek dnia: `day_start`, inaczej pierwsza podana godzina pomniejszona o punkty przed nią, inaczej 08:00.
- Implementacja: `packages/core/src/engine/` (PoC-5).

### Sprawdzanie ograniczeń i ostrzeżenia
- `constraints`: przyjazd przed, wyjazd nie później niż, koniec przed zachodem / zmierzchem, bez jazdy po zmroku (odcinki `legs` w trybie auta po końcu zmierzchu), minimum czasu w miejscu, obiekt otwarty, biuro otwarte o godzinie zwrotu.
- Automatyczne: punkt po zamknięciu, koniec dnia po `day_end`, kolizja ze stałą godziną, brak czasu na przejście, termin decyzji po czasie, którego dotyczy, suma km trasy vs `details.km_limit` auta, zameldowanie przed `check_in_from`.

### Zapas czasu i cięcia
- **Zapas dnia** = okno dnia (lub najbliższe ograniczenie twarde) − (czasy + przejścia + bufory), dla scenariusza pesymistycznego. Klasyfikacja: duży / mały / brak / ujemny.
- Przy braku zapasu silnik proponuje cięcia rosnąco po `cut_rank` (najpierw `optional`, potem `should`, nigdy `must`) i pokazuje, ile każde cięcie zwalnia. To samo działa na telefonie po „Zostajemy dłużej”.

Ta sama funkcja liczy plan na webie, „Tu i teraz” offline na telefonie i walidację wyniku AI. Pokrycie testami jest tu obowiązkowe: strefy czasowe, zmiana czasu (noc 24/25.10 z planu Chatki), punkty przez północ, dwie strefy w jednym dniu (lot), przedziały, tryb względny. Plany z `exaples/` są przypadkami testowymi.

---

## 8. Bezpieczeństwo i prywatność

- RLS na każdej tabeli od pierwszej migracji, testowane (pgTAP). Klucz `service_role` wyłącznie w Edge Functions.
- Klucze AI, routingu i TTS wyłącznie w sekretach Edge Functions (W4). Limity per użytkownik (wywołania/dzień, koszt/miesiąc) w tabeli i sprawdzane w funkcji.
- Link publiczny: token losowy, w bazie tylko hasz, odczyt wyłącznie przez Edge Function z zastosowaniem `hide`. Unieważnienie = nowy token.
- Sejf: prywatny bucket, polityki Storage oparte na `documents.visibility`, krótkotrwałe podpisane URL-e. Na telefonie pliki w katalogu prywatnym aplikacji, kasowane razem z wyjazdem z urządzenia.
- Kody rezerwacji i dane kontaktowe gospodarzy są widoczne tylko członkom wyjazdu (nigdy w linku publicznym).
- Lokalizacja użytkownika jest liczona wyłącznie na telefonie i nie trafia na serwer (brak „gdzie są inni” w zakresie).
- RODO: polityka prywatności (lokalizacja, dokumenty tożsamości, dane dzieci w `travelers`: imię i wiek, bez nazwisk), eksport i usunięcie konta (kaskadowo z plikami).

---

## 9. Wymagania niefunkcjonalne

| Obszar | Wymaganie |
|---|---|
| Offline | Cały dzień wyjazdu (oś, pula, mapa, ślady, audio-transkrypcje, dokumenty, kontakty, opóźnienia, wydatki, zadania, pakowanie) działa w trybie samolotowym. |
| Bateria | Bez ciągłego GPS poza „Trybem spaceru”. Cel: ≤ 5% baterii na godzinę w tle przy aktywnym geofencingu (mierzone w PoC-3). |
| Wydajność | Start aplikacji do „Tu i teraz” < 2 s z danych lokalnych. Brak pracy blokującej UI przy starcie (W8). |
| Rozmiar | Pakiet offline miasta ≤ ~150 MB (do weryfikacji w PoC-2), rozmiar pokazany przed pobraniem. |
| AI | Plan 4-dniowy (etapy 1–2) < 90 s. Koszt per plan mierzony i z limitem. |
| Czas | Poprawna obsługa stref IANA i zmiany czasu, wyjazdy wielostrefowe. |
| Skala planu | Bez spadku wydajności przy planie 12-dniowym z ~150 punktami w puli i ~10 rezerwacjach (Gruzja, Maroko). |
| Języki | UI po polsku, treści AI i audio w języku wybranym dla wyjazdu (PL/EN na start). Teksty UI przez i18n od początku. |
| Dostępność | Cele dotyku ≥ 48 dp, tryb ciemny, obsługa jedną ręką na kluczowych ekranach. |

---

## 10. Zewnętrzne usługi i koszty

Stan na 30.10.2026, zweryfikowany na oficjalnych stronach: szczegóły, liczby i źródła w [docs/USLUGI.md](docs/USLUGI.md). Werdykty zakładają D1 (użycie niekomercyjne, APK poza Google Play) — zmiana D1 wymaga przeglądu (R12).

| Usługa | Do czego | Wybór | Kluczowe warunki |
|---|---|---|---|
| Baza / auth / pliki | wszystko | Supabase: Free do rozwoju, **Pro (25 USD/mies.) przed pierwszym wyjazdem** | Free: pauza po 7 dniach bezczynności (R8). Edge Functions: 150 s (Free) / 400 s (płatne) wall clock, **idle timeout 150 s na każdym planie**, 2 s CPU (R9) |
| LLM | etapy 1–5, audio, importy | Claude, Gemini, OpenAI | koszt per plan mierzony w PoC-1 |
| Miejsca i geokodowanie | ugruntowanie POI, wyszukiwarka | **Geoapify** (główne), Photon (zapas), Nominatim tylko do pojedynczych zapytań | Geoapify Free: 3000 kredytów/dzień, 5 req/s, wyniki wolno przechowywać, atrybucja OSM + Geoapify. Nominatim: max 1 req/s, **zakaz autouzupełniania**. Google Places — NIE (R3). Foursquare — na teraz nie (cache niepotwierdzony) |
| Routing | przejścia | OpenRouteService, Geoapify; GraphHopper jako zapas | ORS: 2000 tras/dzień, 40/min, macierz 500/dzień. GraphHopper Free: 500/dzień, tylko niekomercyjnie |
| Komunikacja publiczna | przejścia (R5) | szacunek + deep link; Transitous (MOTIS) później | Transitous: tylko FOSS / niekomercyjnie, projekt powinien być open source, User-Agent z kontaktem |
| Kafle mapy | web | **OpenFreeMap** | bez klucza i limitu wyświetleń |
| Kafle mapy | offline | **regionalny PMTiles z buildu Protomaps na własnym CDN (R2)**, pobierany w całości na telefon (R6) | dane ODbL (atrybucja OSM), style CC0. Paczki offline z OpenFreeMap tylko małe (≤ 3000 kafli / 50 MB na pobranie). MapTiler — NIE (zakaz bulk). **Zakaz pobierania offline z tile.openstreetmap.org** |
| Pogoda | alerty, go / no-go | Open-Meteo | 10 000 wywołań/dzień, tylko niekomercyjnie, CC BY 4.0, prognoza do 16 dni; cache prognoz po stronie serwera |
| Święta państwowe | fakty dnia | Nager.Date (`nagerholidays.com/api/v4`) | komercyjnie tylko ze sponsoringiem; **Maroko bez świąt islamskich** → święta ruchome z innego źródła albo z danych kraju, z oznaczeniem „±1 dzień” (R13) |
| Kursy walut | budżet, portfel | **Frankfurter API v2** | MAD i GEL dostępne, bez klucza, także komercyjnie. Nie używać v1 (tylko kursy EBC, bez MAD/GEL) |
| TTS | audio premium | OpenAI TTS / ElevenLabs / Google TTS; w MVP `expo-speech` w telefonie | |
| E-mail | magic link, zaproszenia | **Resend** od pierwszego testu ze znajomymi | Free: 3000/mies., 100/dzień; weryfikacja domeny (SPF, DKIM, zalecany DMARC). Wbudowany SMTP Supabase: 2 maile/h i **tylko do członków zespołu projektu** (W11) |

---

## 11. Ryzyka

| # | Ryzyko | Wpływ | Odpowiedź |
|---|---|---|---|
| R1 | Halucynacje AI: nieistniejące miejsca, złe godziny, nierealne czasy, nieaktualne fakty (np. strefa czasowa Maroka w starych źródłach). | Plan nie do zrealizowania, utrata zaufania. | Ugruntowanie w danych (§4 p.3), fakty dnia liczone przez kod, silnik jako sędzia, metryki od PoC-1, porównanie z planami referencyjnymi. |
| R2 | API partnerskie (rezerwacje) niedostępne dla osób prywatnych (W1). | Brak automatycznych rezerwacji i aktualnych cen. | Poza zakresem. Linki + import AI z PDF/maila. Ceny z datą sprawdzenia. |
| R3 | Licencja Google Maps Platform dla rachunku w EOG: treści Places API (poza lat/lng i `place_id`) **nie wolno używać z żadną mapą, także Google**, dozwolone zastosowania to zamknięta lista. Cache: `place_id` bez limitu, lat/lng do 30 dni; nazw, adresów i godzin nie wolno zapisywać. Wyjątek: Places UI Kit (bez offline). | Google Places jest nie do pogodzenia z mapą offline i pamięcią podręczną miejsc. | **Google Places wykreślone** (D4). Dane OSM (Geoapify, Overpass, Wikidata). Google wyłącznie jako deep link do nawigacji. |
| R4 | Geofencing na Androidzie (potwierdzone): promień ≥ 100 m, zalecane 100–150 m (30 m zawodne), limit 100 aktywnych geofence na aplikację, w tle opóźnienie ok. 2–3 min (do ~6 min po bezruchu), po restarcie telefonu rejestracja od nowa. Lokalizacja w tle wymaga osobnej zgody; w Google Play także deklaracji i wideo (przy D1 nie dotyczy). | Autoodtwarzanie przy 30 m niewykonalne w tle; audio może zacząć się już za punktem. | Geofence 100–150 m → powiadomienie. Precyzja tylko w jawnym „Trybie spaceru”. Rejestrujemy wyłącznie punkty dnia dzisiejszego i odtwarzamy je po restarcie. PoC-3. |
| R5 | Brak darmowego, globalnego routingu komunikacji publicznej. | Czasy przejazdów komunikacją niedokładne. | MVP: szacunek (AI + dystans) oznaczony jako szacunek + instrukcja + deep link do Google Maps. Później: Transitous/MOTIS, Navitia albo płatne API. |
| R6 | Rozmiar i licencje kafli offline. Źródła PMTiles **nie działają z paczkami offline MapLibre**, a obsługa `pmtiles://` na Androidzie zależy od wersji MapLibre Native (od 11.7.0). | Duże pobrania, naruszenie warunków dostawcy, mapa bez napisów offline. | Offline = cały plik `.pmtiles` regionu (`pmtiles extract` z bbox i maxzoom) z własnego CDN, otwierany z pamięci telefonu (`pmtiles://file://…`). Lokalne glify i sprite'y w pakiecie. PoC-2 sprawdza, czy `@maplibre/maplibre-react-native` przepuszcza `pmtiles://`. |
| R7 | Synchronizacja offline (konflikty, zgubione zapisy). | Utrata danych (W2). | Zdarzenia tylko dopisywane + outbox + idempotencja. PoC-4. Plan B: PowerSync. |
| R8 | Darmowy Supabase wstrzymuje projekt po 7 dniach bezczynności (potwierdzone; okno przywrócenia niejednoznaczne: 90 dni albo rok). Free: 1 GB Storage, 5 GB egress. | Aplikacja „martwa” w trakcie albo po wyjeździe. | Pro (25 USD/mies., bez pauzy) przed pierwszym realnym wyjazdem. Duże pliki (kafle, audio) poza Supabase Storage (R2). |
| R9 | Edge Functions: 150 s (Free) / 400 s (płatne) wall clock, **idle timeout 150 s na każdym planie**, 2 s CPU. | Długie generowanie planu przerwane. | Każde wywołanie (etap albo dzień planu) musi zwrócić odpowiedź lub zacząć strumień w < 150 s. Etapy jako osobne wywołania zapisane w `ai_runs`, orkiestracja z klienta z postępem. Limit czasu `packages/ai` (120 s) poniżej progu. |
| R10 | Koszt AI i TTS przy grupie znajomych. | Rachunki. | Limity per użytkownik, cache miejsc i transkrypcji per `place_id` (wspólne między wyjazdami), TTS w telefonie domyślnie. |
| R11 | Model danych staje się zbyt rozbudowany dla UI (warianty, pula, ograniczenia, przedziały). | Edytor trudny w obsłudze, MVP się rozrasta. | Schemat pełny od początku, ale UI warstwami: MVP pokazuje warianty i pulę w najprostszej formie. Import planów z `exaples/` jako test, czy struktura nie jest nadmiarowa. |
| R12 | Darmowe plany części usług dopuszczają tylko użycie niekomercyjne: Open-Meteo, Nager.Date, GraphHopper, Stadia, MapTiler, Transitous (ten także wymaga open source). | Zmiana D1 na produkt publiczny lub płatny łamie warunki. | Przy D1 bez zmian. Przy zmianie D1: przegląd [docs/USLUGI.md](docs/USLUGI.md), płatne plany albo zamienniki. Usługi wybrane jako główne (Geoapify, ORS, Frankfurter v2, OpenFreeMap, Protomaps) nie mają tego ograniczenia. |
| R13 | Nager.Date nie zwraca świąt islamskich dla Maroka (Id al-Fitr, Id al-Adha, Nowy Rok islamski, Mawlid); daty zależą od obserwacji Księżyca. | Silnik nie ostrzeże o zamkniętych zabytkach i sklepach. | Święta ruchome z drugiego źródła albo z danych kraju, oznaczone „data przybliżona ±1 dzień”. Test na planie Maroka. |

---

## 12. Decyzje do potwierdzenia (z rekomendacją)

| # | Pytanie | Rekomendacja (przyjęta, dopóki nie zmienisz) |
|---|---|---|
| D1 | Odbiorcy: ja + znajomi (jak FormaSync) czy produkt publiczny w Google Play? | **Ja + znajomi.** APK przez GitHub Releases. Sklep dopiero w etapie wydania (deklaracja lokalizacji w tle, polityka prywatności). |
| D2 | Klucze AI: serwerowe (płaci właściciel) czy każdy wkleja własny (jak FormaSync)? | **Serwerowe z limitem per osoba.** Własny klucz jako opcja później. |
| D3 | Dostawca AI domyślny | **Claude** do planowania. Gemini jako tańsza alternatywa za tym samym walidatorem. Po PoC-1: **Haiku 5.5 dla etapu 2** (~0,05 USD za plan, silnik audytuje wynik), **Opus 5.5 dla etapu 1 i importu planu** (100% ryzyk, najlepszy import, zwięzły — szybszy i tańszy od Sonneta). Sonnet odpada; Fable nie używamy. |
| D8 | Klucz AI w produkcji | PoC-1 szedł przez abonament Claude Code, który **nie zasili Edge Functions**. Przed MVP-2: kredyty Anthropic (koszt planu na Haiku ≈ 0,03–0,07 USD) albo dostawca z darmowym pakietem — do decyzji właściciela. |
| D4 | Źródło miejsc | **OSM przez Geoapify.** Google Places wykluczone przez warunki dla EOG (R3); w PoC-1 porównanie z Google tylko jakościowe, bez zapisywania danych. |
| D5 | Web: Next.js | **Tak.** Wspólny TS z Expo, SSR linku publicznego. |
| D6 | iOS | **Nie w v1.** |
| D7 | Format eksportu | **DOCX według `wzór.docx` + PDF.** Ten sam model sekcji zasila stronę linku publicznego. |
