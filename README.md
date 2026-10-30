# ExpeditionPlan

Planowanie wyjazdów z pomocą AI na dużym ekranie (**Planner Hub**, web) i przewodnik offline w podróży (**Pocket Guide**, Android).

- [SPECYFIKACJA.md](SPECYFIKACJA.md) — specyfikacja (v0.2)
- [PLAN_ETAPOWY.md](PLAN_ETAPOWY.md) — etapy realizacji: Etap 0 → PoC → MVP → v1.0
- [docs/USLUGI.md](docs/USLUGI.md) — usługi zewnętrzne: warunki, limity, werdykty (stan na 30.10.2026)
- [fixtures/plans/](fixtures/plans/) — pięć własnych planów z `exaples/` jako dane referencyjne

## Struktura

| Katalog | Co to |
|---|---|
| `apps/web` | Next.js 16 — Planner Hub i strona linku publicznego |
| `apps/mobile` | Expo SDK 58 — Pocket Guide (tylko Android) |
| `packages/core` | czysty TS: schematy Zod domeny, później silnik harmonogramu i ograniczeń |
| `packages/ai` | dostawcy LLM (Claude, Gemini, OpenAI) za jednym klientem, odpowiedzi walidowane schematem |
| `supabase/` | konfiguracja, migracje, Edge Functions, testy RLS |
| `fixtures/plans/` | plany referencyjne (`brief.json`, później `plan.json`) |

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

Aplikacja mobilna potrzebuje **development build** (natywne moduły, później MapLibre) — Expo Go nie wystarczy:

```bash
npx eas-cli@latest build -p android --profile development
```

Sekrety: skopiuj `.env.example` do `.env.local` i uzupełnij.

## Kontrola jakości

```bash
npm run check
```

To samo co `typecheck`, `lint` i `test` po kolei we wszystkich pakietach.

## Status

- [x] Etap 0 (część w repo) — monorepo, szkielety aplikacji, `packages/ai` przeniesiony z FormaSync, schematy `TripBrief` i `Price`, 5 briefów referencyjnych, weryfikacja usług zewnętrznych
- [ ] Etap 0 (konta) — Supabase, EAS (`eas init`), Vercel, klucze AI, Geoapify, ORS, Resend z domeną
- [ ] PoC-0 … PoC-5
