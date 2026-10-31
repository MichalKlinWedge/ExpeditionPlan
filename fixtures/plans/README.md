# Plany referencyjne

Pięć prawdziwych planów z [`exaples/`](../../exaples/) w postaci danych. Służą jako:

- **wejście AI** (`brief.json`) — to, co mogło trafić do kreatora przed planowaniem: założenia, daty, uczestnicy, to, co już było kupione. Bez rzeczy, które są *wynikiem* planowania (noclegi wybrane później, harmonogram, budżet);
- **wzorzec do porównania** (PoC-1) — czy AI widzi te same ryzyka i proponuje podobne warianty jak ręczny plan;
- **test schematu** (PoC-0) — `plan.json` (powstanie w PoC-0) zawiera cały dokument po imporcie.

| Katalog | Źródło | Co sprawdza |
|---|---|---|
| `barcelona/` | `Barcelona 5–7 grudnia – plan wyjazdu.docx` | miasto, komunikacja z instrukcjami, godziny przybliżone, mecz jako stały punkt, punkty warunkowe, święto |
| `gruzja/` | `Gruzja_2027_plan_v4.pdf` | 12 dni, 3 bazy, dni bez godzin, porównanie kandydatów noclegów, dwie strefy czasowe lotów |
| `maroko/` | `Maroko-plan-26-30-grudnia-2026.pdf` | objazd autem, warianty układu nocy, audyt zapasu czasu, pula atrakcji, progi wiekowe cen, budżet zapłacone / do wydania |
| `chatka/` | `Plan - Chatka Sylwestrowa 24-25.10.2026.docx` | 11 osób w rodzinach, nocleg bez rezerwacji, termin decyzji, podział grupy, pakowanie, zmiana czasu w nocy |
| `dinara/` | `wzór.docx` | szablon dokumentu, godziny względne od „godziny zero”, ferraty, linki do tras |

Luki i niespójności znalezione w dokumentach zostają w polach `notes` — to też dane testowe (import ma je wyłapać, a nie zgubić).

Współrzędne miejsc (`provider: osm`) pochodzą z OpenStreetMap przez Nominatim (`tools/geocode`) — dane © autorzy OpenStreetMap, licencja ODbL. Miejsca prywatne (noclegi u znajomych, „kwatera w okolicy”) celowo nie mają współrzędnych.

Każdy `brief.json` jest walidowany schematem `TripBrief` z `@expeditionplan/core` (`npm test`).
