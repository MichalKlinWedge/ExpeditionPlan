# Plan etapowy realizacji — ExpeditionPlan

Na podstawie: [SPECYFIKACJA.md](SPECYFIKACJA.md) v0.4 (z analizą planów z `examples/`).

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
- **Wyjazdy referencyjne = własne plany z `examples/`**: Barcelona, Gruzja, Maroko, Chatka Sylwestrowa, Dinara. Dla każdego spisać `trip_brief`, jaki mógł być na wejściu (cel, daty, uczestnicy z wiekiem, transport, to, co było już kupione). Te same wejścia służą PoC-0, PoC-1 i późniejszym testom regresji AI, a gotowe plany są wzorcem do porównania.

**Rezultat:** repo z pustymi aplikacjami, które budują się i startują; `packages/ai` odpowiada z każdego dostawcy w teście dymnym; 5 briefów referencyjnych w `fixtures/plans/`.

---

## PoC — Sześć eksperymentów technicznych (≈ 10–14 dni)

Cel: przed budową produktu sprawdzić rzeczy, które mogą zmienić architekturę. Każdy eksperyment ma kryterium **go / no-go** i wariant awaryjny. Kod z PoC-0, PoC-1, PoC-4 i PoC-5 przechodzi do produktu (to `packages/core` i `packages/ai`), reszta może być wyrzucona.

### PoC-0 — Schemat danych na własnych planach (≈ 2 dni) — **pierwszy**
- Schematy Zod dla całego modelu z §5 (w tym `Price`, `details` rezerwacji, warianty, ograniczenia, zadania, pakowanie, notatki).
- Import AI (Etap „Import planu”, wersja CLI): każdy z 5 dokumentów z `examples/` → JSON zgodny ze schematem → `fixtures/plans/*.json`. Poprawki ręczne tam, gdzie AI się pomyli.
- Lista kontrolna per plan: co z dokumentu **nie ma gdzie trafić** w schemacie, co trafia tylko do notatki tekstowej, choć powinno być polem. Silnik harmonogramu (PoC-5) na tych danych odtwarza godziny z dokumentów.

**Stan:** zrobione, werdykt GO (poprawki A1–A9 wprowadzone), szczegóły w `POC_WYNIKI.md`. Pięć planów i ich `plan.json` leży w `fixtures/plans/`, test `fixtures.test.ts` pilnuje schematu.

**Go:** każdy z 5 planów mieści się w schemacie bez utraty informacji, które w trakcie wyjazdu są potrzebne na telefonie (godziny, rezerwacje i kody, warianty z warunkami, ograniczenia, ceny dla grupy, kontakty). Reszta może zostać notatką. **No-go:** poprawka schematu przed MVP-1, specyfikacja v0.3.

### PoC-1 — Łańcuch AI z ugruntowaniem (≈ 3–4 dni) — **najważniejszy**
- Skrypt CLI (bez UI): `trip_brief` (JSON) → Etap 1 (warianty) → Etap 2 (pula + harmonogram + audyt) → ugruntowanie (geokodowanie, godziny otwarcia, święta, słońce) → routing (`legs`) → silnik harmonogramu (§7) → raport.
- Schematy Zod dla etapów 1 i 2, walidator z jedną próbą naprawy.
- Uruchomienie na 5 briefach z `examples/` × 2–3 dostawców × 2 źródła miejsc (OSM/Geoapify vs inne).
- Raport w tabeli: % ugruntowanych punktów, % w godzinach otwarcia, % dni realizowalnych, liczba ostrzeżeń, czas, tokeny i koszt.
- **Porównanie z planami referencyjnymi:** czy AI widzi te same ryzyka co ręczne plany (zachód słońca i jazda po zmroku, kolejki na lotnisku, godziny biura wypożyczalni, limit km, święto i zamknięte sklepy, „kto pierwszy, ten lepszy” w chatce) i czy proponuje sensowne warianty.

**Stan:** zrobione, werdykt GO z warunkami (`POC_WYNIKI.md`; czas < 90 s niezmierzony na kluczu API). Łańcuch żyje w `packages/planner`, CLI `npm run plan-ai`; produkcja na Gemini (D8).

**Go:** ≥ 90% punktów ugruntowanych, ≥ 80% dni realizowalnych bez ręcznej poprawki, plan 4-dniowy < 90 s, koszt mieszczący się w budżecie z D2, co najmniej połowa ryzyk z planów referencyjnych wykryta.
**No-go → wariant:** AI tylko wybiera z listy kandydatów pobranych wcześniej z API miejsc (odwrócenie kolejności: najpierw dane, potem model).

### PoC-2 — Mapa offline na Androidzie (≈ 2 dni)
> Stan 31.10.2026: kod gotowy (`apps/mobile`, zakładki Mapa i Spacer), test na telefonie według [docs/POC-2-3.md](docs/POC-2-3.md).
- `@maplibre/maplibre-react-native` (v11, New Architecture) w dev buildzie; region jednego miasta (Marakesz) i jednego regionu (Swanetia albo Góry Bystrzyckie ze śladem do chatki).
- Wariant główny (wg [docs/USLUGI.md](docs/USLUGI.md)): plik `.pmtiles` regionu wycięty z buildu Protomaps (`pmtiles extract`), na R2, pobrany w całości na telefon i otwarty jako `pmtiles://file://…`, z lokalnymi glifami i sprite'ami. Najpierw sprawdzić, czy wrapper RN przepuszcza `pmtiles://` (Android: MapLibre Native od 11.7.0).
- Wariant zapasowy: paczka `OfflineManager` z OpenFreeMap (≤ 3000 kafli / 50 MB na pobranie, ≤ 4 równoległe żądania, własny User-Agent).
- Pomiar: rozmiar dla miasta i regionu przy zoom 10–16/17, czas pobrania, płynność, tryb samolotowy, pozycja GPS na mapie, napisy po polsku bez sieci.

**Stan:** kod PoC jest (`apps/mobile/src/poc`), wynik pomiaru w terenie nie jest zapisany w `POC_WYNIKI.md` (tam „w toku”). Produkt użył wariantu zapasowego: paczek OpenFreeMap (`apps/mobile/src/features/map/offline-packs.ts`); PMTiles został w kodzie PoC.

**Go:** miasto ≤ ~150 MB, mapa i pozycja działają w trybie samolotowym, warunki dostawcy pozwalają na ten sposób użycia.

### PoC-3 — Geofencing i bateria (≈ 2 dni + spacer)
- `expo-location` + `expo-task-manager`: 10–15 geofence (100 / 150 m) wokół realnych punktów w mieście, aplikacja w tle, ekran wygaszony.
- Wariant „Tryb spaceru”: usługa pierwszoplanowa, dokładny GPS, promień 30–50 m.
- Spacer 2–3 h z logiem: które wejścia wykryte, opóźnienie wykrycia, zużycie baterii w obu trybach.
- Przy okazji: `expo-speech` po polsku offline (jakość głosu, dostępność głosu bez sieci) i odtwarzanie przy wygaszonym ekranie.

**Stan:** kod jest (`apps/mobile/src/poc/tasks.ts`; w produkcie „spacer z przewodnikiem”, `features/walk/guide-walk.ts`, zadanie w tle, powiadomienie w promieniu 100 m). Pomiar baterii i wykrywalności w terenie nie jest zapisany w `POC_WYNIKI.md` (tam „w toku”).

**Go:** ≥ 90% wejść wykrytych w trybie 150 m w ≤ 2 min; „Tryb spaceru” ≤ ~8%/h baterii. Wynik wyznacza, czy autoodtwarzanie jest S czy C.

### PoC-4 — Synchronizacja Supabase ↔ SQLite (≈ 2–3 dni)
- Minimalne tabele `trips`, `days`, `items`, `schedule_events`, `expenses` z RLS (owner/viewer) i testami pgTAP.
- Telefon: migawka z `plan_version`, aktualizacja przyrostowa, outbox dla `schedule_events` i `expenses`.
- Scenariusze: (1) zmiana na webie widoczna na telefonie < 3 s online; (2) telefon offline rejestruje 3 opóźnienia i 2 wydatki, w tym czasie web zmienia plan → po powrocie sieci nic nie ginie i harmonogram liczy się tak samo na obu urządzeniach; (3) zabicie aplikacji w trakcie wysyłki outboxa → brak duplikatów.

**Stan:** zrobione, werdykt GO, wariant własny (`packages/sync`, `npm run test:sync`; `POC_WYNIKI.md`).

**Go:** wszystkie 3 scenariusze przechodzą powtarzalnie. **No-go → wariant:** PowerSync.

### PoC-5 — Silnik harmonogramu i ograniczeń (≈ 2 dni, równolegle z PoC-0/1)
- `packages/core/schedule`: funkcja z §7 + fakty dnia (słońce, zmierzch, Księżyc, DST) + ograniczenia + zapas i cięcia + ceny dla grupy z progów wiekowych.
- Testy: stała godzina, opóźnienie do następnego punktu stałego, godziny otwarcia, zmiana czasu (noc 24/25.10 z Chatki), punkt przez północ, dwie strefy w jednym dniu (lot), przedziały czasu trwania, tryb względny (`+1:20`, Dinara), „bez jazdy po zmroku” (Maroko), limit km auta vs trasa (710 vs 680 km).

**Stan:** zrobione, werdykt GO (`POC_WYNIKI.md`; test `bramka PoC-5` w `packages/core`).

**Go:** testy zielone, a godziny odtworzone z `fixtures/plans/` zgadzają się z dokumentami w granicach ±15 min. Ten kod idzie wprost do MVP.

### Bramka decyzyjna po PoC
Krótki dokument `POC_WYNIKI.md`: metryki, wybrani dostawcy (AI, miejsca, routing, kafle), wariant synchronizacji, decyzja o geofencingu, poprawki schematu z PoC-0. Aktualizacja specyfikacji do v0.3. **Bez tej bramki MVP nie startuje.**

---

## MVP — „Planuję na laptopie, podróżuję z telefonem” (≈ 22–31 dni)

**Definicja MVP:** organizator planuje na webie realny 3–5-dniowy wyjazd z pomocą AI, zaprasza osobę towarzyszącą jako widza i oboje przeżywają ten wyjazd z telefonem w trybie samolotowym. Plan ma to, co w `examples/` okazało się niezbędne w trasie: warianty z warunkiem i terminem decyzji, audyt zapasu czasu, rezerwacje z kodami i warunkami, budżet „zapłacone / do wydania”, zadania i kontakty.
Zakres MVP = wszystkie punkty **M** ze specyfikacji. Schemat bazy obejmuje od razu **wszystkie** tabele z §5 (także portfel, pakowanie, ślady, audio, AI), nawet jeśli UI powstaje później.

### MVP-1 — Fundament danych i konto (≈ 4–5 dni)
- Pełny schemat §5 w migracjach (z poprawkami z PoC-0), triggery (`updated_at`, `plan_version`, `activity_log`), RLS dla wszystkich tabel + testy pgTAP z macierzy uprawnień.
- Typy z Supabase → `packages/db`. Logowanie Google + magic link (Resend) na webie i w aplikacji (deep link).
- Web: lista wyjazdów, tworzenie, uczestnicy (imię, wiek, rodzina, opiekun), zaproszenie linkiem (owner/viewer). Mobile: logowanie, lista wyjazdów, dołączenie z linku zaproszenia.
- Skrypt seed: 5 planów z `fixtures/plans/` ładuje się do bazy `dev` jako wyjazdy testowe.

**Kryterium odbioru:** druga osoba dołącza z linku jako widz, widzi wyjazd i nie może niczego zmienić (sprawdzone testem RLS i ręcznie). Pięć planów referencyjnych jest w bazie.

**Stan (31.10.2026):** część danych gotowa na lokalnym Supabase — pełny schemat §5 (migracje `*_mvp1_*`), RLS z testami pgTAP macierzy uprawnień (52 testy), zaproszenia linkiem, `packages/db` (typy), seed 5 planów (`npm run seed:dev`), test kryterium odbioru w `packages/sync` (`mvp1.integration.test.ts`: widz z linku dostaje z bazy ten sam plan i nie może go zmienić). Logowanie jest: Google i link z maila (`apps/web/src/app/login`, `apps/mobile/src/features/auth/login-card.tsx`), na projekcie Supabase w chmurze; wysyłka e-mail przez SMTP (`apps/web/src/lib/mail.ts`). Ekrany web i mobile powstały w kolejnych etapach.

### MVP-2 — Kreator i AI w produkcie (≈ 5–7 dni)
- Formularz `trip_brief` (Zod) na webie: założenia, uczestnicy, „co już ustalone” (loty, rezerwacje, stałe punkty), ograniczenia (maks. jazdy dziennie, bez jazdy po zmroku).
- Logika z PoC-1 jako akcje serwera Next (`planWithAi`, Geoapify, ORS) na `packages/planner`, nie jako Edge Functions (SPECYFIKACJA §5 „Odstępstwa w MVP-1”); zapis w `ai_runs`, dostęp do AI przez `AI_ALLOWED_EMAILS` (limitu wywołań na użytkownika nie ma).
- Etap 1: 2–3 warianty układu z tabelą porównania i rekomendacją → wybór.
- Etap 2: pula, harmonogram, warianty w dniu, ograniczenia, priorytety i audyt zapasu → podgląd draftu (dni + pula + mapa) → akceptacja → zapis.
- „Przelicz dzień z poleceniem” (uproszczony Etap 3: regeneracja jednego dnia z zachowaniem punktów `user_locked`).

**Stan (31.10.2026):** część bez AI — kreator briefu na webie (`/trips/[id]/brief`, pięć kroków, zapis do `trip_brief` przez `TripBrief`) i pełny parser OSM `opening_hours` w silniku (`engine/opening-hours.ts`: dni, sezony, daty, przerwy, przez północ, PH, słońce; zapis OSM daje twarde ostrzeżenie „zamknięte”, opis spoza OSM — miękkie). **1.11.2026:** „Zaplanuj z AI” — przycisk na stronie wyjazdu i briefu, akcja serwera Next → `packages/planner` (etap 1 warianty, fakty dni, etap 2 dni i punkty, ugruntowanie miejsc przez Geoapify) na Gemini (D8) → nowy wyjazd „Szkic AI: …” + wpis w `ai_runs`. Sprawdzone na lokalnej bazie (Dinara: 3 dni, 21 punktów, szkic wraca z `pull_changes` poprawny). Szkic obok planu (`/trips/[id]/compare?draft=…`, link ze szkicu „Szkic AI: X” do planu „X” albo wybór na stronie wyjazdu): dni po dacie, godziny i zapas z silnika dla obu stron, „→ do planu” (punkt z miejscem, brakujący dzień powstaje), „Dodaj brakujące”, „Zastąp dzień” — zostają punkty zmienione ręcznie i powiązane (budżet, zadanie, ograniczenie, przejście), w miejscu odpowiednika ze szkicu; punkty jednego wariantu tylko pojedynczo. Przejazdy z OpenRouteService (`packages/planner/src/routing.ts`): w „Zaplanuj z AI” po ugruntowaniu miejsc i przyciskiem „Przelicz przejazdy” na stronie planu (punkty zmienione ręcznie pominięte); czas optymistyczny = trasa, pesymistyczny +30%; trasa niepasująca do dystansu z planu (×2,5) nie nadpisuje szacunku. „Uzupełnij współrzędne miejsc” na stronie planu: Geoapify dla miejsc bez współrzędnych (kraj z briefu albo ze strefy wyjazdu, środek obszaru z miejsc już znanych); wynik Geoapify z pewnością < 0,2 to brak trafienia (było: „Plaża Sidi Kaouki” → „Poznań Plaza”). Ręczne przypinanie (strona planu, „Miejsca bez współrzędnych”): wklejone współrzędne albo link z Google Maps/OSM/`geo:` (`parseCoordinates` w packages/core) → `provider: user`, albo szukanie pod inną nazwą (zapisuje się jako `searchName`). Strona „Rezerwacje, budżet i zadania” edytowalna dla organizatora i edytora (`app/logistics-actions.ts`): pozycje budżetu (dodaj, zmień, usuń), zadania (dodaj, zmień, odhacz, usuń; termin „do dnia”), rezerwacje (status, kod, zapłacona kwota i data, darmowe odwołanie, zwrotność — bez usuwania, zamiast tego „anulowane”); każda zmiana waliduje cały dokument. **Etap 5 AI** (`packages/planner/src/practical.ts`, strona `/trips/[id]/practical`): notatki tematyczne, kontakty alarmowe, pakowanie, zadania z terminem „N dni przed wyjazdem” i źródła; strefa, różnica czasu i słońce idą do modelu jako fakty z kodu (wcześniej Gemini podawał z pamięci „UTC+1” dla Maroka), źródła sprawdzane HEAD/GET (martwe odrzucone); szkic w `ai_runs` (`stage: practical`), do planu tylko zaznaczone, bez duplikatów pakowania i zadań. Maroko na Flash-Lite: ok. 6 s, 3,3 tys./1,9 tys. tokenów. **Etap 4 AI** (`packages/planner/src/logistics.ts`, strona logistyki, sekcja „Do porównania”): grupy decyzji (noclegi per baza, auto, transfer, karnety, eSIM, ubezpieczenie) z 2–4 kandydatami — rodzaj oferty, nie wymyślony obiekt; ceny jako szacunek, warunki do sprawdzenia, plusy/minusy, tabela porównania, dokładnie jeden polecany; kod dokłada linki wyszukiwania (Booking.com z datami i składem grupy, Google; bez rezerwacji — W1), sprawdza limit km auta wobec tras planu i odsiewa rzeczy kupowane raz na wyjazd, które plan już ma; zapis jak w planach wzorcowych (grupa `scope: booking` + wariant + rezerwacja-kandydat), „Wybieram” = `chosenRef` i status „do rezerwacji”. Maroko na Flash-Lite: ok. 10 s, 6,1 tys./4,8 tys. tokenów. **Etap 3 AI** (`packages/planner/src/tune.ts`, strona `/trips/[id]/tune` „Dostrajanie z AI”): polecenie → łatka (`remove_item` domyślnie do puli, `move_item`, `add_item` z miejscem po nazwie, `replace_item`, `set_field`) → podgląd (✓/✗ z powodem, koniec dnia i zapas przed/po) → „Zastosuj” (łatka liczona od nowa na świeżym planie, nowe miejsca ugruntowane w Geoapify, zapis różnicy przez `saveMergeEdit`, punkty `source: ai`) albo „Odrzuć”; punkty `user_locked` nietykalne; rozmowa w `ai_messages`. Etapy 3–5 gotowe; `add_variant` z §4 jeszcze nie. Zostało: etapy 3–5 (ceny, rezerwacje, informacje praktyczne), limit wywołań na użytkownika.

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

**Stan (31.10.2026):** widok „Plan dzień po dniu” (`/trips/[id]/plan`: godziny z silnika, ostrzeżenia, zapas, cięcia, słońce, scenariusze, warianty dnia, pula) z edycją punktów — w górę/w dół (`keyBetween`), do innego dnia i do puli, edycja godziny z precyzją, czasu trwania, bufora, priorytetu, nowy punkt, usunięcie z czyszczeniem odwołań. Logika w `packages/core/src/plan-edits.ts`, zapis `savePlanEdit` (packages/sync, `user_locked`), test na bazie: edycje wracają z `pull_changes` bez rozjazdu. **2.11.2026:** przeciąganie (HTML5 drag & drop, uchwyt ⠿): przed punkt w dniu, na koniec dnia (też innego), do puli i z puli — `dropItem` w `plan-edits.ts`, w obrębie dnia punkt zostaje w bloku; strzałki i „przenieś…” zostają dla klawiatury i dotyku. Mapa MapLibre GL JS obok dni (`components/plan-map.tsx`, kafle OpenFreeMap, napisy `name:pl`): wybrany dzień, pinezki z numerami kolejności z silnika (`dayMap` w `plan-info.ts`; kilka punktów w jednym miejscu = jedna pinezka „4 · 5 · 12–18”), linia prosta między kolejnymi miejscami, baza dnia, szare kropki z puli; numer przy punkcie ↔ pinezka (wyróżnienie, przewinięcie listy). Własna pinezka: „+ Dodaj punkt na mapie” → kliknięcie mapy → nazwa, rodzaj, czas → nowe miejsce `provider: 'user'` i punkt na końcu wybranego dnia (`addItemAtPin`); własne pinezki przeciąga się myszą (`movePlace`, miejsc z OSM/Geoapify nie). `savePlanEdit` zapisuje miejsca przed punktem (test na bazie). Linia trasy: „Przelicz przejazdy” i „Zaplanuj z AI” (z `route`) zapisują linię z ORS w `leg.geometry` — polilinia Google, precyzja 5, uproszczona Douglasem–Peuckerem (auto 25 m, pieszo 5 m; Agadir → Marakesz ≈ 1,4 KB). `leg` to jsonb, więc bez migracji. `dayMap` zwraca `lines` (ciągła po drogach / przerywana prosto); trasa, której końce nie pasują do sąsiednich miejsc (punkt przestawiony po przeliczeniu), ustępuje prostej. **Warianty i ograniczenia w edytorze** (`packages/core/src/plan-rules.ts`, `components/day-rules.tsx`, zapis `saveRulesEdit`): plan B dnia (grupa z dwoma wariantami, punkty zostają w obu), edycja grupy — tytuł, warunek i jego opis, termin decyzji (godzina dnia), uzasadnienie, wybrany wariant (`chosenRef`), etykiety, jeden rekomendowany, nowy wariant, usunięcie wariantu (punkty tylko z niego → pula) i całej grupy z wyborem planu, który zostaje (reszta → pula; zadanie-decyzja blokuje); przy punkcie „we wszystkich wariantach / tylko: X” (czyta też `excludesRefs` z planów wzorcowych). Ograniczenia dnia i punktu: lista z wagą i naruszeniem z silnika, dodanie, zmiana, usunięcie; ograniczenie całego wyjazdu (bez dnia i punktu, np. „bez jazdy po zmroku” w Maroku) silnik sprawdza teraz w każdym dniu — wcześniej nigdzie. **Rezerwacje, budżet, kontakty i zadania** (strona logistyki, `logistics-actions.ts`, `logistics-editors.tsx`): nowa rezerwacja i pełna edycja — rodzaj, status, dostawca, kod, początek i koniec z osobnymi strefami, cena (od–do, za całość / osobę / noc / dobę, szacunek), zapłata, kiedy i czym płatne, zwrotność, darmowe odwołanie, skład zgłoszony u operatora, co w cenie, szczegóły lotu (nr, lotniska, bagaż), auta (klasa, limit km, godziny biura), noclegu (zameldowanie od / wymeldowanie do, pokoje, śniadanie); „punkty w pakiecie” (punkt wskazuje rezerwację, płatność „w cenie”); kontakty (telefon jako link, przy rezerwacji albo wyjeździe). Budżet: podział na kategorie, kursy walut z datą (`trip.fx`, z ostrzeżeniem o walutach bez kursu), „Ceny z planu bez pozycji w budżecie” (`budget-suggest.ts`: rezerwacja za noc × noce, bilet za osobę × uczestnicy z progami wieku; dodaje się pojedynczo). Zadania: termin „do dnia”, N dni przed wyjazdem albo punktem, przed rezerwacją, w trakcie (dzień, godzina), osoby, powiązanie z rezerwacją, punktem i decyzją (grupa wariantów). **Sejf dokumentów** (`/trips/[id]/documents`, `components/vault.tsx`, migracja `*_documents_vault`): prywatny bucket `documents` (PDF i zdjęcia do 20 MB), pliki pod `<wyjazd>/<dokument>/<nazwa>`; kto widzi plik, decyduje wiersz `documents` (`can_see_document`: wszyscy / wybrane osoby / organizator), a wiersz w jednym wyjeździe nie otworzy pliku z innego (pgTAP `documents_vault.test.sql`). Na webie: dokumenty przy rezerwacjach i punktach, wgrywanie z odczytem kodu w przeglądarce (QR, Aztec, PDF417, DataMatrix, kody kreskowe — `zxing-wasm`, PDF przez `pdfjs-dist`, pliki .wasm i worker z aplikacji), treść kodu do poprawienia ręcznie, „Pokaż kod” na pełnym ekranie (bwip-js, czarne na białym), kod rezerwacji dużym tekstem, plik przez podpisany URL (2 min). Na telefonie (zakładka Info, na górze): dokumenty „offline” pobierane do katalogu aplikacji przy synchronizacji (nazwa z sha256), kod rysowany z treści bez sieci i bez modułów natywnych (`codeCanvas` w core: kontekst bwip-js → raster), ekran nie gaśnie przy kodzie (`expo-keep-awake`), PDF przez „Otwórz w…”, zdjęcie na pełnym ekranie. Zostało: maksymalna jasność ekranu przy kodzie (`expo-brightness` = nowy APK), kod QR wyciągany z pliku na telefonie (bez wgrywania z telefonu), Realtime.

**Kryterium odbioru:** plan Maroka z `fixtures/plans/` da się w edytorze odtworzyć i edytować: wariant A/B dnia 4, „bez jazdy po zmroku” i lista cięć dnia 2, pakiet Agafay z punktami „w pakiecie”, budżet 7 519 zł zapłacone / ~3 915–5 555 zł do wydania, 8 zadań przed wyjazdem. Przestawienie punktu przelicza godziny i zapas natychmiast, bez przeładowania strony.

### MVP-4 — Pocket Guide offline (Android) (≈ 6–9 dni)
- `offline-manifest` + „Pobierz wyjazd offline”: dane (z pulą, wariantami, notatkami, kontaktami, zadaniami), kafle (wariant z PoC-2), transkrypcje audio, dokumenty `offline`. Postęp, wznawianie, sha256, plakietka „jest nowsza wersja planu”.
- „Tu i teraz”: karty trwa / następny / przejście (z instrukcją i linią), zachód słońca, „Prowadź” (deep link), „Zostajemy dłużej” / „Pomiń” / „Zrobione” / „Wybierz wariant” / „Z puli w pobliżu” jako `schedule_events` w outboxie. Po opóźnieniu, które łamie ograniczenie: propozycja cięć.
- Oś dnia, mapa dnia z pozycją, karta punktu z audio (`expo-speech`), ceną dla grupy, płatnością i dokumentami (QR na pełnym ekranie, max jasność). Karta rezerwacji z kodem i kontaktem.
- Lista zadań z odhaczaniem offline.
- Lokalne powiadomienia z osi dnia i terminów decyzji, przeplanowane po każdym opóźnieniu i po restarcie.
- Transkrypcje audio: Edge Function `ai-audio` (Wikipedia/Wikivoyage + AI, atrybucja), generowane przy akceptacji planu, wspólne per `place_id`.

**Stan (3.11.2026):** zrobione w kodzie, do sprawdzenia testem w terenie. Pakiet offline: jeden przycisk „Pobierz wyjazd offline” na karcie wyjazdu (plan z synchronizacją, dokumenty „offline” z sejfu, zdjęcia przewodnika, kafle mapy; postęp, wznawianie od braków, sha256 przy plikach) i plakietka na liście wyjazdów („✓ offline” / „⬇ nowsza wersja planu”, gdy plan zmienił się od pełnego pobrania i pakietowi czegoś brakuje) — `features/trip/offline-download.ts`. „Tu i teraz”: „+15 / +30 min”, „Pomiń”, „✓ Zrobione” (punkt kończy się w chwili odhaczenia), wybór wariantu (`choose_variant`, widz tylko podgląda), „Z puli w pobliżu” przy ≥ 30 min wolnego (pozycja na żądanie, dojście pieszo, „Wstaw” = `pull_from_pool`, `core/pool-nearby.ts`) — wszystko jako zdarzenia dnia w outboxie z cofnięciem; propozycja cięć przy ujemnym zapasie. Karta punktu (`core/item-facts.ts`): cena dla grupy z progami wieku, płatność, rezerwacja z kodem i kontaktami („Zadzwoń”), dokumenty punktu/rezerwacji z kodem na pełnym ekranie (bez gaśnięcia, pełna jasność — `expo-brightness`, APK 0.3.0); telefon do gospodarza na karcie noclegu dnia. Zadania: zakładka „Zadania” z odhaczaniem offline (outbox `tasks` = sama zmiana statusu; widz — tylko przypisane do siebie). Powiadomienia z osi dnia i terminów decyzji (`dayAlerts`, kanał „Plan dnia”), przeliczane po każdym zdarzeniu; po restarcie telefonu przywraca je moduł powiadomień. **Odstępstwo:** zamiast Edge Function `ai-audio` przewodnik powstaje akcją na webie z artykułu Wikipedii/Wikivoyage (dopasowanie nazwą i współrzędnymi, opcjonalna wskazówka organizatora), a telefon czyta go syntezatorem mowy (`expo-speech`, offline). Web: plan dnia liczy godziny z tymi zdarzeniami i pokazuje ramkę „📱 W terenie (z telefonu)” — wybrane warianty, pominięte punkty, opóźnienia, „zrobione” z godziną, punkty z puli — oraz znaczniki przy punktach (`core/field-log.ts`). Przed testem: telefon gospodarza w kontaktach, bilety z QR w sejfie jako „offline”, „Pobierz wyjazd offline”.

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

**Stan:** jest link publiczny (`/p/[token]` z przeglądem, `/p/[token]/plan`, RPC `public_trip`, ukrywanie kosztów, imion i adresu noclegu, unieważnianie), rola edytora w UI, dziennik aktywności (`activity_log`) w postaci „Co nowego od ostatniej wizyty” (RPC `trip_news`, karta na `/trips/[id]` i baner na telefonie), punkty dla części grupy (`items.participant_ids`). Jest też głosowanie grupy (`/trips/[id]/votes`: warianty, kandydaci noclegu, ankieta terminu z kalendarzem dostępności; na telefonie głos w oknie wariantu). Nie ma: Realtime Presence, nazwanych wersji planu (`plan_snapshots` bez interfejsu), cofania z dziennika.

**Odbiór:** dwie osoby edytują ten sam dzień na dwóch laptopach i żadna zmiana nie ginie bez ostrzeżenia. Link publiczny nie ujawnia kosztów, sejfu, kodów rezerwacji ani kontaktów (test).

### Etap 6 — AI: czat, logistyka, informacje praktyczne, importy (≈ 7–9 dni)
- Etap 3: czat → łatka operacji (z wariantami i powrotem do puli) → diff → akceptacja; `ai_messages`.
- Etap 4: kandydaci do porównania (noclegi per baza, klasy aut, pakiety ubezpieczeń, karnety) z atrybutami, warunkami, plusami, minusami, rekomendacją i deep linkami. Wybór kandydata = status `to_book`.
- Etap 5: notatki praktyczne, kontakty alarmowe, lista pakowania, TODO z terminami, źródła.
- Import rezerwacji przez AI: PDF, zrzut ekranu, wklejony mail → `bookings` + dokument w sejfie.
- Import istniejącego planu DOCX/PDF (z PoC-0) w UI: podgląd per sekcja, akceptacja.
- Kontrole automatyczne: alert przed końcem darmowego odwołania, skład osobowy u operatora vs wiek uczestników, limit km vs trasa, godzina zwrotu vs godziny biura → zadania z `source = check`.

**Stan:** etapy AI 3–5 są (patrz Stan w MVP-2: `/tune`, logistyka, `/practical`). Import planu DOCX/PDF działa tylko jako CLI (`tools/import-plan`), w UI jest „Importuj z pliku” dla JSON (`/trips/[id]/brief`). Import rezerwacji jest na „Rezerwacje i budżet” („Importuj z potwierdzenia”: PDF, zrzut ekranu albo wklejony mail → szkic Gemini → podgląd pole po polu → nowa albo wskazana rezerwacja, plik do sejfu przy niej z kodem z pliku).

**Odbiór:** „Zmień obiad w dniu 2 na wegański” i „Dzień 3 jest za męczący” dają poprawne łatki, które nie ruszają punktów zablokowanych. Potwierdzenie z Booking (PDF) zamienia się w kartę noclegu z kodem i terminem darmowego odwołania. Dla Gruzji Etap 4 daje porównanie 2–3 noclegów w Mestii w układzie zbliżonym do ręcznego planu. Import `Plan - Chatka Sylwestrowa` daje wyjazd z uczestnikami, harmonogramem, wariantami awaryjnymi, pakowaniem i TODO.

### Etap 7 — Pakowanie, ślady GPX, eksport dokumentu (≈ 5–7 dni)
- Lista pakowania: osobista / wspólna, „kto bierze co”, odhaczanie per osoba offline (rodzic za dziecko), kopiowanie z poprzedniego wyjazdu.
- Ślady GPX: import, statystyki (długość, przewyższenie, czas), mapa offline z własną pozycją i odległością od śladu.
- Eksport DOCX/PDF według `wzór.docx`, eksport ICS.

**Stan:** jest sprzęt (`/trips/[id]/gear`, zakładka „Sprzęt” na telefonie, wiersze `packing_carriers`), ślady GPX (`core/gpx.ts`, `saveTrack`, karta śladu na telefonie offline), eksport ICS (`/trips/[id]/calendar`), wydruk (`/trips/[id]/print`) i eksport planu do JSON (`/trips/[id]/export`). Nie ma eksportu DOCX/PDF według `wzór.docx`.

**Odbiór:** eksport planu Chatki do DOCX ma te same sekcje co oryginał. Ślad do chatki widać w trybie samolotowym razem z pozycją telefonu.

### Etap 8 — Audioprzewodnik pełny (≈ 4–6 dni, zakres zależny od PoC-3)
**Stan:** częściowo: przewodniki z Wikipedii, Wikivoyage i źródeł podanych przez użytkownika (`/trips/[id]/guides`), czytanie na głos `expo-speech`, spacer z przewodnikiem w tle (`features/walk/guide-walk.ts`). Nie ma TTS w chmurze ani odtwarzacza z kontrolkami w powiadomieniu.

- Odtwarzacz w tle z kontrolkami w powiadomieniu, kolejka nagrań dnia.
- Geofencing punktów dnia (100–150 m) → powiadomienie „Jesteś przy X”. „Tryb spaceru” z autoodtwarzaniem.
- Wersja transkrypcji dla dzieci. Opcjonalnie TTS w chmurze (MP3 do pakietu offline), wybór głosu, cache per `place_id` + język.

### Etap 9 — Portfel (≈ 4–5 dni)
**Stan:** zrobione w kodzie: portfel na telefonie (`features/trip/wallet-view.tsx`, outbox, „Dodaj wydatek”, usuwanie), rozliczenie (`core/settle.ts`, `settle-view.tsx`), kursy, budżet vs wydatki dzień po dniu (`core/budget-pace.ts`), paragon ze zdjęcia przez web (`/api/receipt`).

- Wydatki offline (outbox), podział po równo / udziały / kwoty / na rodziny, kursy z dnia, saldo i minimalne przelewy (`packages/core/settle` z testami), rozliczenia.
- Budżet planowany vs rzeczywisty, per kategoria i dzień. Paragon ze zdjęcia (opcjonalnie AI).

**Odbiór:** 4 osoby, 3 waluty, 30 wydatków, część dodana offline → saldo zgodne z ręcznym przeliczeniem, każda osoba ma tę samą liczbę na swoim telefonie. Zrzutka „150 zł na rodzinę” (Chatka) rozlicza się per rodzina.

### Etap 10 — Pogoda, alerty, push (≈ 3–4 dni)
**Stan:** pogoda i alerty są (Open-Meteo w `core/weather.ts`, `core/weather-alerts.ts` go/no-go, lokalne przypomnienia na telefonie: `features/trip/reminders.ts`, `features/home/weather-alerts.tsx`). Nie ma zdalnego pushu Expo (w kodzie nie ma rejestracji tokenu ani wysyłki), więc zmiany innych widać dopiero po otwarciu aplikacji.

- Open-Meteo dla dni wyjazdu, alert „deszcz → przełączyć wariant?”, zadanie „go / no-go 2 dni przed” z prognozą, alerty czasowe (zamknięcie, ostatni kurs).
- Push zdalny (Expo Push) o zmianach od innych, zadaniach z terminem i alertach.

### Etap 11 — Planowanie komfortowe (≈ 3–5 dni)
- Widok kalendarza tygodniowego z drag & drop, przeciąganie pinezek na mapie.

### Etap 12 — Stabilizacja i wydanie (≈ 4–6 dni)
**Stan:** niezrobione. Nie ma testów E2E (ani Playwright, ani Maestro), polityki prywatności ani usuwania konta; są testy jednostkowe, integracyjne (`npm run test:sync`) i pgTAP (`npm run test:db`).

- E2E: Playwright (kreator → akceptacja → edycja), Maestro (pobranie offline → dzień w trybie samolotowym).
- Regresja AI na 5 briefach z `examples/` przy każdej zmianie poleceń lub modelu.
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
| 0 | Przygotowanie, monorepo, `packages/ai`, briefy z `examples/` | — | 2–3 | — |
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
