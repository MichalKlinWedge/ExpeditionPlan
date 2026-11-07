# Usługi, od których zależy projekt (stan na 7.11.2026)

Schemat pokazuje usługi, których kod faktycznie używa. Warunki, limity i werdykty każdej z nich są w [`USLUGI.md`](USLUGI.md); tu tylko to, kto z czego korzysta i co się stanie, gdy usługi zabraknie.

## 1. Architektura

```mermaid
flowchart LR
  subgraph LUDZIE["Użytkownicy"]
    ORG["Organizator<br/>(przeglądarka)"]
    UCZ["Uczestnicy<br/>(telefon z Androidem)"]
    PUB["Odbiorca linku publicznego"]
  end

  subgraph NASZE["Nasz kod"]
    WEB["Planner Hub<br/>apps/web · Next.js"]
    APP["Expedition Planner<br/>apps/mobile · Expo, offline"]
    PKG["packages/*<br/>core · planner · ai · sync"]
  end

  subgraph INFRA["Infrastruktura"]
    VER["Vercel<br/>hosting webu"]
    SUP["Supabase<br/>Postgres + RLS · Auth · Storage · Realtime"]
    EAS["Expo EAS<br/>build APK · OTA"]
    SMTP["Serwer SMTP<br/>magic link · zaproszenia"]
  end

  subgraph AI["AI"]
    GEM["Gemini API<br/>(produkcja)"]
  end

  subgraph DANE["Dane zewnętrzne (API)"]
    GEO["Geoapify<br/>miejsca, geokodowanie"]
    ORS["OpenRouteService<br/>czasy przejazdów"]
    OFM["OpenFreeMap<br/>kafle mapy"]
    WIKI["Wikipedia · Wikidata<br/>Wikivoyage · Commons"]
    MET["Open-Meteo<br/>pogoda"]
    FX["Frankfurter<br/>kursy walut"]
    NAG["Nager.Date<br/>święta"]
  end

  subgraph LINKI["Tylko linki, bez API"]
    LNK["Google Maps · mapy.com<br/>Booking.com (wyszukiwanie)"]
  end

  ORG --> WEB
  PUB --> WEB
  UCZ --> APP
  WEB --- PKG
  APP --- PKG
  VER -. hostuje .-> WEB
  EAS -. dostarcza .-> APP

  WEB --> SUP
  APP <-->|"sync + outbox"| SUP
  APP -->|"paragon ze zdjęcia"| WEB
  SUP --> SMTP
  WEB --> SMTP

  WEB --> GEM
  WEB --> GEO
  WEB --> ORS
  WEB --> WIKI
  WEB --> NAG
  WEB --> FX
  APP --> FX
  APP --> MET
  WEB --> OFM
  APP -->|"paczki offline"| OFM
  WEB -.-> LNK
  APP -.-> LNK
```

Zasady widoczne na schemacie:

- **Telefon rozmawia tylko z Supabase** (i z darmowymi API bez klucza: kafle, pogoda, kursy). Wszystko, co wymaga klucza (Gemini, Geoapify, ORS), idzie przez serwer webu; klucze nigdy nie trafiają do APK ani przeglądarki.
- **Telefon działa bez sieci**: plan, przewodniki i mapa są w pamięci telefonu, zapisy czekają w outboxie.
- **Linki do Google Maps, mapy.com i Booking.com** to zwykłe adresy otwierane przez użytkownika. Kod nie pobiera z tych serwisów żadnych danych, bo ich warunki zabraniają zapisywania wyników (`USLUGI.md` §3, §5, §13).

Tylko przy pracy deweloperskiej (`tools/*`, poza schematem): `claude -p` na subskrypcji właściciela (import, plan AI), Nominatim i Photon (współrzędne fixture'ów), Docker z lokalnym Supabase.

## 2. Biznes: co zależy od czego

```mermaid
flowchart TB
  subgraph K["Krytyczne: bez nich aplikacja nie działa"]
    SUP2["Supabase<br/>konta, dane, synchronizacja"]
    VER2["Vercel<br/>planowanie w przeglądarce"]
    EAS2["Expo EAS<br/>instalacja i aktualizacje telefonu"]
  end

  subgraph W["Ważne: wyłączają jedną funkcję"]
    GEM2["Gemini<br/>Zaplanuj z AI, paragony,<br/>wklejone połączenia i obiekty"]
    SMTP2["SMTP<br/>logowanie linkiem, zaproszenia"]
    GEO2["Geoapify<br/>szukanie i przypinanie miejsc"]
    WIKI2["Wikipedia/Commons<br/>przewodniki po punktach"]
  end

  subgraph P["Pomocnicze: łagodna degradacja"]
    ORS2["ORS<br/>Przelicz przejazdy"]
    OFM2["OpenFreeMap<br/>mapa (bez niej lista punktów)"]
    MET2["Open-Meteo<br/>ostrzeżenia pogodowe"]
    FX2["Frankfurter<br/>przeliczenie walut"]
    NAG2["Nager.Date<br/>święta w planie AI"]
  end

  K --> W --> P
```

| Usługa | Funkcja dla użytkownika | Koszt dziś | Co przy komercjalizacji |
|---|---|---|---|
| Supabase | wszystko: konta, plan, wydatki, pliki | Free; Pro 25 USD/mies. przed realnym wyjazdem (Free pauzuje po 7 dniach) | bez zmian (Pro) |
| Vercel | Planner Hub w przeglądarce | darmowy plan | plan płatny dla użytku komercyjnego |
| Expo EAS | APK dla znajomych, aktualizacje OTA | darmowy plan | bez zmian przy małej skali |
| Gemini | AI w produkcji | w EOG tylko płatne rozliczenie (Paid Services) | bez zmian, rośnie z ruchem |
| SMTP | magic link, e-mail z zaproszeniem | darmowy limit dostawcy | bez zmian |
| Geoapify | miejsca i geokodowanie | Free, 3000 kredytów/dzień | płatny plan przy ruchu |
| Wikipedia/Commons | przewodniki | darmowe | bez zmian (atrybucja CC BY-SA) |
| OpenRouteService | czasy przejazdów | Free, 2000 tras/dzień | do sprawdzenia |
| OpenFreeMap | mapa na webie i offline | darmowe | bez zmian; większe paczki offline → Protomaps |
| Open-Meteo | pogoda | darmowe, **tylko niekomercyjnie** | wymiana albo płatny plan |
| Frankfurter | kursy walut | darmowe, także komercyjnie | bez zmian |
| Nager.Date | święta | darmowe, **komercyjnie tylko ze sponsoringiem**; brak świąt islamskich | sponsoring albo inne źródło |

Założenie biznesowe (D1 w `SPECYFIKACJA.md`): projekt „ja + znajomi”, APK poza Google Play, bez przychodów. Zmiana tego założenia wymaga przejrzenia wierszy oznaczonych pogrubieniem i werdyktów „OK z warunkiem” w `USLUGI.md`.
