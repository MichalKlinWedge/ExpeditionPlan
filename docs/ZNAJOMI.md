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
   albo **edytor** → „Utwórz link”. Link `…/join/<token>` jest jednorazowy i ważny 14 dni — każdy znajomy dostaje własny.

3. **Aktualizacja u znajomych** — po sprawdzeniu zmiany u siebie (`npm run ota --workspace apps/mobile`):

   ```bash
   npm run ota:friends --workspace apps/mobile
   ```

   Publikuje bieżący kod z repo, więc wysyłaj z tego samego commita, który sprawdziłeś na `preview`.

Konta: nowe konto powstaje tylko z linku zaproszenia (web). Zakładać wyjazdy i używać AI może
tylko właściciel (`trip_creator`, `AI_ALLOWED_EMAILS`) — znajomi oglądają i, jako edytorzy,
poprawiają zaproszone plany.

## Znajomy

1. **Otwórz link zaproszenia** (najlepiej na telefonie) i zaloguj się — przez Google albo linkiem
   z maila. Po zalogowaniu kliknij „Dołącz do wyjazdu”. Wyjazd jest teraz na Twoim koncie.
2. **Zainstaluj aplikację** z linku do APK. Android zapyta o zgodę na instalację z tego źródła
   (przeglądarka → „Zezwalaj z tego źródła”) — to normalne dla aplikacji spoza Sklepu Play.
3. **Zaloguj się w aplikacji „Expedition Planer”** tym samym kontem (Google albo ten sam e-mail).
   Wyjazd pojawi się w zakładce „Wyjazdy”.
4. **Przed wyjazdem otwórz plan raz z internetem** — od tej chwili działa offline: plan dnia,
   mapa, informacje praktyczne (numery alarmowe), wydatki. Wydatki dodane bez zasięgu wyślą się same,
   gdy wróci internet.
5. **Aktualizacje** przychodzą same: aplikacja pokaże znaczek aktualizacji i zaproponuje restart.

Jeśli link zaproszenia otworzysz w przeglądarce na telefonie z zainstalowaną aplikacją, możesz
też wybrać „otwórz w aplikacji” — dołączenie nastąpi po zalogowaniu w aplikacji.
