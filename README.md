# ExpeditionPlan

Planowanie wyjazdów z pomocą AI na dużym ekranie (**Planner Hub**, web) i przewodnik offline w podróży (**Pocket Guide**, Android).

- [SPECYFIKACJA.md](SPECYFIKACJA.md) — specyfikacja (v0.4)
- [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md) — etapy realizacji: Etap 0 → PoC → MVP → v1.0
- [docs/USLUGI.md](docs/USLUGI.md) — usługi zewnętrzne: warunki, limity, werdykty
- [POC_WYNIKI.md](POC_WYNIKI.md) — wyniki i werdykty PoC
- [docs/ZNAJOMI.md](docs/ZNAJOMI.md), [docs/PROBA-OFFLINE.md](docs/PROBA-OFFLINE.md) — aplikacja dla znajomych, próba offline przed wyjazdem
- [fixtures/plans/](fixtures/plans/) — pięć własnych planów z `examples/` jako dane referencyjne

## Struktura

| Katalog | Co to |
|---|---|
| `apps/web` | Next.js 16 — Planner Hub i strona linku publicznego |
| `apps/mobile` | Expo SDK 58 — Pocket Guide (tylko Android) |
| `packages/core` | czysty TS: schematy Zod domeny, silnik harmonogramu i ograniczeń, rozliczenia, formatowanie i etykiety |
| `packages/ai` | dostawcy LLM (Claude, Gemini, OpenAI) za jednym klientem, odpowiedzi walidowane schematem |
| `packages/planner` | łańcuch „Zaplanuj z AI”, opisy miejsc, paragony, wyszukiwanie miejsc i tras |
| `packages/sync` | synchronizacja telefon ↔ Supabase (outbox), mapowanie dokumentu wyjazdu na wiersze |
| `packages/db` | typy wygenerowane z bazy Supabase |
| `tools/import-plan` | CLI: import planu DOCX/PDF przez AI do `TripDocument` i porównanie ze wzorcem |
| `tools/plan-ai` | CLI: łańcuch planowania na briefach referencyjnych, metryki i koszty |
| `tools/geocode`, `tools/seed-dev` | współrzędne planów wzorcowych; dane testowe do lokalnej bazy |
| `scripts/` | `sync-env.mjs`: jeden `.env.local` → pliki env aplikacji |
| `supabase/` | konfiguracja, migracje (schemat, RLS, RPC), testy pgTAP; bez Edge Functions |
| `docs/` | usługi zewnętrzne, próba offline, instrukcja dla znajomych |
| `examples/` | oryginalne dokumenty planów (DOCX/PDF) |
| `fixtures/plans/` | plany referencyjne (`brief.json`, `plan.json`) |

## Uruchomienie

```bash
npm install
```

```bash
npm run web
```

```bash
npm run mobile
```

Aplikacja mobilna potrzebuje **development build** (natywne moduły, m.in. MapLibre) — Expo Go nie wystarczy:

```bash
npx eas-cli@latest build -p android --profile development
```

Sekrety: skopiuj `.env.example` do `.env.local` i uzupełnij. `npm run web` i `npm run mobile` uruchamiają `scripts/sync-env.mjs`, który przepisuje zmienne do `apps/web/.env.local` (razem z kluczami serwerowymi: AI, Geoapify, ORS, SMTP, `FRIENDS_APK_URL`) i `apps/mobile/.env.local` (tylko `EXPO_PUBLIC_*`). Na produkcji te same zmienne serwerowe są w projekcie Vercel; do aplikacji i przeglądarki nie trafia żaden klucz.

Import istniejącego planu przez AI (potrzebny klucz w `.env.local`):

```bash
npm run import-plan -- "examples/Plan - Chatka Sylwestrowa 24-25.10.2026.docx" --out plan.json --compare fixtures/plans/chatka/plan.json
```

Sam tekst wyciągnięty z dokumentu, bez AI: dodaj `--text-only`.

## Kontrola jakości

```bash
npm run check
```

To samo co `typecheck`, `lint` i `test` po kolei we wszystkich pakietach.

## Status

Aktualny stan etapów (co zrobione, czego nie ma) jest w [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md) przy każdym etapie, a werdykty PoC w [POC_WYNIKI.md](POC_WYNIKI.md). Etap 0, PoC-0, PoC-1, PoC-4, PoC-5 i MVP-1…4 mają kod; testy w terenie PoC-2 i PoC-3 oraz Etap 12 (E2E, prywatność) czekają.
