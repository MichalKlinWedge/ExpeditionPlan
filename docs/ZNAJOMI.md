# Aplikacja dla znajomych (kanał `friends`)

Znajomi dostają **osobny APK** na kanale `friends`. Aktualizacje (OTA) wysyłane na `preview`
trafiają tylko do telefonu właściciela; do znajomych idzie wersja sprawdzona — osobnym poleceniem.
Web jest wspólny: https://expedition-plan.vercel.app.

## Właściciel

1. **APK dla znajomych** (raz, i ponownie tylko przy zmianach natywnych — nowy moduł, uprawnienia,
   `app.json`; wtedy też podbić `version`):

   ```bash
   cd apps/mobile
   npx eas-cli@latest build --platform android --profile friends
   ```

   Po buildzie EAS podaje link instalacyjny (strona z kodem QR) — ten link wysyłasz znajomym.
   Pierwszy build zakłada kanał `friends` w EAS.

2. **Zaproszenie do wyjazdu**: na webie, strona wyjazdu → „Kto ma dostęp” → rola **widz** (podgląd)
   albo **edytor**, „Ile osób” (domyślnie 1) → „Utwórz link” → „Kopiuj link”. Link `…/join/<token>` jest ważny
   14 dni i pokazuje się tylko raz (w bazie zostaje sam skrót).

3. **Zaproszenie imienne** (zamiast ogólnego linku): strona wyjazdu → „Uczestnicy i dostęp” → „Zaproś” przy osobie bez konta. Link jest jednorazowy i po przyjęciu łączy konto z tą osobą na liście uczestników; strona daje gotową wiadomość do skopiowania, a „Wyślij e-mailem” wysyła ją z serwisu (potrzebne `SMTP_*` i `MAIL_FROM`, też w Vercel; bez nich zostaje kopiowanie). Jeśli ustawisz `FRIENDS_APK_URL` (link instalacyjny EAS z kroku 1, zmienna serwera, też w Vercel), wiadomość zawiera link do APK.

4. **Aktualizacja u znajomych** — po sprawdzeniu zmiany u siebie (`npm run ota --workspace apps/mobile`):

   ```bash
   npm run ota:friends --workspace apps/mobile
   ```

   Publikuje bieżący kod z repo, więc wysyłaj z tego samego commita, który sprawdziłeś na `preview`.

Konta: nowe konto powstaje tylko z linku zaproszenia (web, link e-mail) — pilnuje tego hook
`before_user_created` w Supabase (Authentication → Hooks). Zakładać wyjazdy i używać AI może
tylko właściciel (`trip_creator`, `AI_ALLOWED_EMAILS`) — znajomi oglądają i, jako edytorzy,
poprawiają zaproszone plany.

## Znajomy

1. **Otwórz link zaproszenia** (najlepiej na telefonie) i zaloguj się **linkiem z maila** — tak
   powstaje konto (z samego Google nowe konto się nie założy). Po zalogowaniu kliknij „Dołącz do
   wyjazdu”. Wyjazd jest teraz na Twoim koncie; później możesz logować się też przez Google, jeśli
   to ten sam adres.
2. **Zainstaluj aplikację** z linku do APK:
   - otwórz link **bezpośrednio w Chrome na telefonie** i instaluj z „Pobranych” — plik
     skopiowany przez Dysk Google czy menedżer plików bywa niepełny i kończy się komunikatem
     „Aplikacja nie została zainstalowana”;
   - Android zapyta o zgodę na instalację z tego źródła (Chrome → „Zezwalaj z tego źródła”) —
     to normalne dla aplikacji spoza Sklepu Play;
   - **Google Play Protect** może pokazać „Aplikacja została zablokowana, aby chronić urządzenie”
     (nie zna dewelopera) — wybierz **„Zainstaluj mimo to”** nad przyciskiem OK, nie samo OK;
   - nowa wersja instaluje się na starą — plany, wydatki i dziennik zostają.
3. **Zaloguj się w aplikacji „Expedition Planner”** tym samym kontem (Google albo ten sam e-mail).
   Wyjazd pojawi się w zakładce „Wyjazdy”.
4. **Przed wyjazdem otwórz plan raz z internetem** (najlepiej „Pobierz wyjazd offline” na karcie wyjazdu) — od tej chwili działa offline: plan dnia,
   mapa, informacje praktyczne (numery alarmowe), wydatki. Wydatki dodane bez zasięgu wyślą się same,
   gdy wróci internet.
5. **Aktualizacje** przychodzą same: aplikacja pokaże znaczek aktualizacji i zaproponuje restart.

Jeśli link zaproszenia otworzysz w przeglądarce na telefonie z zainstalowaną aplikacją, możesz
też wybrać „otwórz w aplikacji” — dołączenie nastąpi po zalogowaniu w aplikacji.
