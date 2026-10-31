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
npm run web                 # next dev
npm run mobile              # expo start (needs a development build, not Expo Go)
npm run supabase -- start   # local Supabase via pinned CLI (needs Docker)
npm run import-plan -- <file.docx|pdf> [--provider CLAUDE] [--out x.json] [--compare fixtures/plans/<p>/plan.json] [--anonymize] [--text-only]
```

Single test: `npx vitest run src/__tests__/structured.test.ts` (or `-t "nazwa testu"`) inside `packages/ai` or `packages/core`.

Mobile: always `npx expo install <pkg>` inside `apps/mobile` (SDK-compatible versions). Follow `apps/mobile/AGENTS.md` — check Expo SDK 58 docs, don't trust memory. Web: `apps/web/AGENTS.md` — read `node_modules/next/dist/docs/` before using Next APIs.

## Architecture rules

- **Domain logic lives in `packages/core`** and must run identically in the browser, on the phone (offline) and in Supabase Edge Functions (Deno). Keep it pure TS: no Node/Expo/Next imports outside tests.
- Packages are consumed as **TypeScript source** (`main: src/index.ts`), with **explicit `.ts` extensions in relative imports** — required by Deno. `allowImportingTsExtensions` is on everywhere; Next transpiles them via `transpilePackages`.
- **Zod schemas are the single source of truth** for form input, AI output, and `jsonb` columns. jsonb content is camelCase (Zod); table columns are snake_case.
- Time in plans = **local date/time + IANA zone** (`LocalDateTime` + `TimeZone`), never UTC instants. Real events (expenses, delays) use timestamptz. Money = integer minor units + ISO currency; plan prices use the `Price` schema (ranges, "from", age tiers).
- `packages/ai`: one client (`createAiClient`) over Claude/Gemini/OpenAI; keys come from config/env (server-side only — never in the browser or APK). Use `askStructured(client, schema, prompt)` for anything that becomes data: it validates with Zod and gets exactly one repair attempt. Model names are never guessed — `listModels()` is the source.
- AI produces **drafts and patches, never silent overwrites**; user-edited items are `user_locked`.
- `packages/core/src/engine/`: the schedule engine (§7) — `scheduleDay`, `proposeCuts`, `checkCarKmLimit`, `priceForGroup`, sun/moon, zoned time via `Intl` (no date libs). Computes on UTC instants, displays local time. Plan times are "not earlier than"; `relative` + `from: previous` counts from the START of the previous item. The `bramka PoC-5` test keeps all five fixture plans within ±15 min — keep it green.

## Reference data

`fixtures/plans/<slug>/brief.json` are the user's five real trips as `TripBrief`; `plan.json` is the full hand-checked `TripDocument` (gold standard for AI import) and `GAPS.md` lists what the schema could not hold. `packages/core/src/__tests__/fixtures.test.ts` validates them — a schema change that breaks them is a regression. Gaps/inconsistencies found in the source docs are kept in `notes` on purpose.

## Conventions

- New files use LF (`.gitattributes` enforces `eol=lf`); never rewrite an existing file's line endings.
- Mobile is Android-only: don't add `*.web.tsx` variants.
- Distribution follows FormaSync: EAS channels `preview` (own phone) / `friends`, OTA with `runtimeVersion: appVersion` — bump `version` only together with a new APK.
