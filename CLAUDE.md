# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ExpeditionPlan: AI trip planner. Web **Planner Hub** (`apps/web`, Next.js) for planning, Android **Pocket Guide** (`apps/mobile`, Expo) for the trip itself, offline-first. Backend will be Supabase (Postgres + RLS + Realtime + Storage + Edge Functions). Built by one developer on the experience of FormaSync (`D:\AI\Kardio`).

Read before larger work:
- `SPECYFIKACJA.md` — the spec. §5 is the data model, §7 the schedule/constraint engine, §4 the AI pipeline, §0.2 why the model looks the way it does (it was derived from the user's real plans in `exaples/`).
- `PLAN_ETAPOWY.md` — stages (Etap 0 → PoC-0…5 → MVP-1…4 → v1.0). Each stage has an acceptance criterion; work toward it.
- `docs/USLUGI.md` — verified terms/limits of external services. Don't introduce a service it marks NIE (Google Places, MapTiler offline, tile.openstreetmap.org bulk).

All docs, UI strings and code comments are in **Polish**; identifiers in English.

## Commands

```bash
npm install                 # root; npm workspaces (apps/*, packages/*, tools/*)
npm run check               # typecheck + lint + test in every workspace
npm run typecheck           # web runs `next typegen` first (LayoutProps etc. are generated)
npm test                    # vitest in packages/*
npm run web                 # next dev against the cloud project (root .env.local → apps/*/.env.local via scripts/sync-env.mjs)
npm run web:local           # next dev against LOCAL Supabase (magic links land in Mailpit http://127.0.0.1:54324)
npm run mobile              # expo start (needs a development build, not Expo Go)
npm run ota --workspace apps/mobile   # OTA update (JS only) to the `preview` channel; the app checks on start/foreground and offers a restart. Native changes (new module, app.json plugins/permissions) need a new APK: `npx eas-cli@latest build --platform android --profile preview`
npm run supabase -- start   # local Supabase via pinned CLI (needs Docker)
npm run test:db             # pgTAP tests in supabase/tests (RLS, row versions) — needs local Supabase
npm run test:sync           # packages/sync against local Supabase (PoC-4 scenarios + MVP-1 acceptance); not part of `check`
npm run seed:dev            # 5 fixture plans into the LOCAL db as organizator@/widz@expeditionplan.test (viewer joins via invite); idempotent
npm run geocode -- [slug…] [--write]   # OSM/Nominatim coords for fixtures/plans (1 req/1.1 s, cached in tools/geocode/.cache.json)
npm run plan-ai -- [--plans maroko,…] [--models claude-haiku-5-5,claude-sonnet-5-5] [--chunk-days 2] [--backend claude-code|api|gemini] [--route]   # PoC-1 chain (packages/planner); --route = ORS travel times (OPENROUTESERVICE_API_KEY); claude-code = `claude -p` on the owner's subscription; gemini = GEMINI_API_KEY (e.g. --models gemini-3.5-flash-lite)
npm run plan-ai -- --rescore tools/plan-ai/out/<stamp>   # recompute metrics without AI
npm run batch --workspace tools/import-plan -- [--models …] [--plans …]   # AI import of all examples/ docs via claude -p, compared with fixtures (out/ is git-ignored)
npm run import-plan -- <file.docx|pdf> [--provider CLAUDE] [--out x.json] [--compare fixtures/plans/<p>/plan.json] [--anonymize] [--text-only]
```

Single test: `npx vitest run src/__tests__/structured.test.ts` (or `-t "nazwa testu"`) inside `packages/ai` or `packages/core`.

Mobile: always `npx expo install <pkg>` inside `apps/mobile` (SDK-compatible versions). Follow `apps/mobile/AGENTS.md` — check Expo SDK 58 docs, don't trust memory. Web: `apps/web/AGENTS.md` — read `node_modules/next/dist/docs/` before using Next APIs.

## Architecture rules

- **Domain logic lives in `packages/core`** and must run identically in the browser, on the phone (offline) and in Supabase Edge Functions (Deno). Keep it pure TS: no Node/Expo/Next imports outside tests.
- Packages are consumed as **TypeScript source** (`main: src/index.ts`), with **explicit `.ts` extensions in relative imports** — required by Deno. `allowImportingTsExtensions` is on everywhere; Next transpiles them via `transpilePackages`.
- **Zod schemas are the single source of truth** for form input, AI output, and `jsonb` columns. jsonb content is camelCase (Zod); table columns are snake_case.
- Time in plans = **local date/time + IANA zone** (`LocalDateTime` + `TimeZone`), never UTC instants. Real events (expenses, delays) use timestamptz. Money = integer minor units + ISO currency; plan prices use the `Price` schema (ranges, "from", age tiers).
- `packages/planner`: the „Zaplanuj z AI” chain (`planTrip`: stage 1 → day facts → stage 2 chunks → pins → place grounding → ORS travel times when `route` is given), pure TS with injected AI client, place lookup (`geoapifyLookup` in the app, cached Nominatim/Photon in tools) and holidays. Used by the web server action `planWithAi` (Gemini, D8) and by `tools/plan-ai`. The result is a NEW trip „Szkic AI: …” via `import_trip`; the user moves points into the real plan on `/trips/[id]/compare?draft=…` (`packages/core/src/plan-merge.ts` + `saveMergeEdit`; copied items are `source: 'ai'`, not `user_locked`). Server keys `GEMINI_API_KEY`, `GEOAPIFY_API_KEY`, `OPENROUTESERVICE_API_KEY` reach `apps/web/.env.local` through `scripts/sync-env.mjs` (no `NEXT_PUBLIC_` prefix → never in the browser).
- `packages/ai`: one client (`createAiClient`) over Claude/Gemini/OpenAI; keys come from config/env (server-side only — never in the browser or APK). Use `askStructured(client, schema, prompt)` for anything that becomes data: it validates with Zod and gets exactly one repair attempt. Model names are never guessed — `listModels()` is the source.
- AI produces **drafts and patches, never silent overwrites**; user-edited items are `user_locked`.
- `packages/sync` (PoC-4): phone ↔ Supabase sync. Every write in a trip bumps `trips.sync_version` and stamps the row's `row_version` (trigger, serialized by the trip row lock); clients pull `row_version > last` via the `pull_changes` RPC (one snapshot). Phone writes (`schedule_events` append-only, `expenses`) go through a SQLite outbox: local row + outbox entry in one transaction, idempotent upsert with client UUIDv7. No hard deletes — `deleted_at`. `LocalDb` is a sync interface (expo-sqlite in the app, `node:sqlite` in tests); the phone keeps server rows generically in one `rows (tbl, id, data)` table.
- **Schema (MVP-1)**: `supabase/migrations/*_mvp1_*.sql` = full §5 model (deviations in SPECYFIKACJA §5 „Odstępstwa w MVP-1”). Every `TripDocument` collection has a table with a `ref` column; common columns, version triggers, `activity_log` and RLS are added by loops in `mvp1_access.sql` — a new trip table goes into those arrays and into `synced_tables()`. `packages/sync/src/document.ts` (`SPECS`) is the only TripDocument ↔ rows mapping; a new document field needs a column there too (round-trip test over the 5 fixtures guards it). Whole documents are written via the `import_trip` RPC (one transaction, deferred FKs). Invites: `create_invite` / `accept_invite` (token hash only). Creating trips requires `app_metadata.trip_creator` (set only with the service key; `can_create_trips()` in RLS) — other accounts only see trips they were invited to; web AI/Geoapify/ORS actions additionally need the e-mail in `AI_ALLOWED_EMAILS`. Single-element writes outside the day plan (AI drafts stage 4/5, logistics editor) go through `saveElements` in `packages/sync/src/plan-save.ts`. After a migration: `npm run gen --workspace packages/db` (types), `npm run test:db` (pgTAP permission matrix).
- **AI cost rule:** only cheap models (Sonnet 5.5, Haiku 5.5) — `tools/plan-ai/src/pricing.ts` refuses others (Opus, Fable). The owner has no API credits; dev AI runs go through `claude -p` (`--backend claude-code`).
- `packages/core/src/engine/`: the schedule engine (§7) — `scheduleDay`, `proposeCuts`, `checkCarKmLimit`, `priceForGroup`, sun/moon, zoned time via `Intl` (no date libs). Computes on UTC instants, displays local time. Plan times are "not earlier than"; `relative` + `from: previous` counts from the START of the previous item. The `bramka PoC-5` test keeps all five fixture plans within ±15 min — keep it green.

## Reference data

`fixtures/plans/<slug>/brief.json` are the user's five real trips as `TripBrief`; `plan.json` is the full hand-checked `TripDocument` (gold standard for AI import) and `GAPS.md` lists what the schema could not hold. `packages/core/src/__tests__/fixtures.test.ts` validates them — a schema change that breaks them is a regression. Gaps/inconsistencies found in the source docs are kept in `notes` on purpose.

## Conventions

- New files use LF (`.gitattributes` enforces `eol=lf`); never rewrite an existing file's line endings.
- Mobile is Android-only: don't add `*.web.tsx` variants.
- Distribution follows FormaSync: EAS channels `preview` (own phone) / `friends`, OTA with `runtimeVersion: appVersion` — bump `version` only together with a new APK.
