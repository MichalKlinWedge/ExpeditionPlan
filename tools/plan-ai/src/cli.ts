/**
 * PoC-1: łańcuch AI z ugruntowaniem na briefach z `fixtures/plans/`.
 *
 *   npm run plan-ai -- [--plans maroko,chatka] [--models claude-sonnet-5-5,claude-haiku-5-5] [--backend claude-code|api]
 *   npm run plan-ai -- --rescore tools/plan-ai/out/<znacznik>   (miary od nowa, bez AI)
 *
 * `claude-code` (domyślnie): przez `claude -p` na abonamencie Claude Code (wymaga `claude auth login`
 * w terminalu); koszt w raporcie to równowartość według cennika API. `api`: ANTHROPIC_API_KEY.
 * `gemini`: GEMINI_API_KEY, np. `--backend gemini --models gemini-3.8-flash,gemini-3.5-flash-lite`.
 *
 * brief → etap 1 (warianty) → bazy w OSM + fakty dni (słońce, święta, zmiana czasu) → etap 2
 * (dni, punkty, pula, ograniczenia) → ugruntowanie miejsc (OSM, godziny otwarcia) → silnik
 * harmonogramu → miary i raport. Wyniki: tools/plan-ai/out/<znacznik>/ (poza git).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AiUsage, createAiClient } from '@expeditionplan/ai';
import { TripBrief, TripDocument } from '@expeditionplan/core';
import { cachedLookup, searchPhoton } from '@expeditionplan/geocode';
import { applyPins, orsRoute, planTrip } from '@expeditionplan/planner';

import { claudeCodeClient } from './claude-code.ts';
import { holidays } from './facts.ts';
import { detectRisks, evaluate, type PlanMetrics } from './metrics.ts';
import { assertAllowed, costUsd, DEFAULT_RUN_MODELS } from './pricing.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const here = fileURLToPath(new URL('../', import.meta.url));
const lookup = cachedLookup(join(here, '.cache/nominatim.json'));
const fallback = cachedLookup(join(here, '.cache/photon.json'), searchPhoton);

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1]?.split(',');
};
const plans = arg('plans') ?? ['maroko', 'chatka', 'dinara', 'barcelona', 'gruzja'];
const models = arg('models') ?? DEFAULT_RUN_MODELS;
models.forEach(assertAllowed);

const backend = arg('backend')?.[0] ?? 'claude-code';
/** Dni na jedno zapytanie etapu 2 (części idą równolegle — krótsze odpowiedzi, krótszy czas). */
const chunkDays = Number(arg('chunk-days')?.[0] ?? 2);
/** Plany po kolei (domyślnie) — czas jednego planu nie zależy od obciążenia innymi. */
const parallelPlans = process.argv.includes('--parallel');
/** Przejazdy z OpenRouteService (klucz OPENROUTESERVICE_API_KEY); bez flagi zostają czasy z AI. */
const orsKey = process.env.OPENROUTESERVICE_API_KEY;
if (process.argv.includes('--route') && !orsKey) throw new Error('Brak OPENROUTESERVICE_API_KEY w .env.local');
const route = process.argv.includes('--route') && orsKey ? orsRoute(orsKey) : undefined;
const key = process.env.ANTHROPIC_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (backend === 'api' && !key) throw new Error('Brak ANTHROPIC_API_KEY w .env.local');
if (backend === 'gemini' && !geminiKey) throw new Error('Brak GEMINI_API_KEY w .env.local');
const clientFor = (model: string) => {
  if (backend === 'api') return createAiClient({ keys: { CLAUDE: key }, models: { CLAUDE: model } });
  if (backend === 'gemini') return createAiClient({ keys: { GEMINI: geminiKey }, models: { GEMINI: model }, defaultProvider: 'GEMINI' });
  return claudeCodeClient(model);
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

type Row = {
  slug: string;
  model: string;
  error?: string;
  days?: number;
  aiSeconds?: number;
  groundSeconds?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  repairs?: number;
  variants?: string[];
  metrics?: PlanMetrics;
  risks?: ReturnType<typeof detectRisks>;
};

async function run(slug: string, model: string, outDir: string): Promise<Row> {
  const row: Row = { slug, model };
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
  const onUsage = (each: AiUsage) => {
    usage.inputTokens += each.inputTokens;
    usage.outputTokens += each.outputTokens;
  };
  const dir = join(outDir, `${slug}-${model}`);
  mkdirSync(dir, { recursive: true });
  const save = (file: string, data: unknown) => writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n');

  try {
    const brief = TripBrief.parse(JSON.parse(readFileSync(join(root, 'fixtures/plans', slug, 'brief.json'), 'utf8')));
    const result = await planTrip(brief, {
      client: clientFor(model),
      lookup,
      fallback,
      holidays: (country, year) => holidays(country, year, join(here, '.cache/holidays.json')),
      chunkDays,
      timeoutMs: 300_000,
      onUsage,
      ...(route ? { route } : {}),
    });
    save('stage1.json', result.skeleton);
    save('facts.json', result.facts);
    save('stage2.json', result.stagePlans);
    save('plan.json', result.doc);
    if (route) save('routing.json', result.routing);
    save('grounding.json', result.grounding);

    row.variants = result.skeleton.variants.map((each) => `${each.recommended ? '★ ' : ''}${each.label}`);
    row.repairs = result.repairs;
    row.days = result.doc.days.length;
    row.aiSeconds = Math.round(result.aiMs / 100) / 10;
    row.groundSeconds = Math.round(result.groundMs / 100) / 10;
    row.metrics = evaluate(result.doc);
    row.risks = detectRisks(slug, JSON.stringify({ skeleton: result.skeleton, plans: result.stagePlans }));
  } catch (error) {
    row.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (error instanceof Error && 'issues' in error) save('error.json', { issues: (error as { issues: unknown }).issues, raw: (error as { raw?: unknown }).raw });
  }
  row.tokensIn = usage.inputTokens;
  row.tokensOut = usage.outputTokens;
  row.costUsd = Math.round(costUsd(model, usage) * 1000) / 1000;
  save('row.json', row);
  console.log(`${slug} · ${model}: ${row.error ?? `${row.aiSeconds} s AI, $${row.costUsd}`}`);
  return row;
}

const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((100 * part) / whole)}%`);

function writeReport(rows: Row[], dir: string, title: string) {
  const lines = [
    `# PoC-1 — ${title}`,
    '',
    backend === 'claude-code' ? 'Koszt = równowartość według cennika API (przebieg szedł na abonamencie Claude Code).' : '',
    '',
    '| Plan | Model | Dni | AI [s] | Ugrunt. konkretne (wszystkie) | Godz. otwarcia (poza) | Dni realizowalne | Twarde ostrz. | Rozjazdy > 15 min | Posiłki o dziwnej porze | Niemożliwe przejazdy | Ryzyka (spoza briefu) | Naprawy | Tokeny we/wy | Koszt |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => {
      if (row.error) return `| ${row.slug} | ${row.model} | ✗ ${row.error.slice(0, 120)} ||||||||||| ${row.tokensIn}/${row.tokensOut} | $${row.costUsd} |`;
      const m = row.metrics!;
      const risks = row.risks!;
      const outside = risks.filter((risk) => !risk.inBrief);
      return `| ${row.slug} | ${row.model} | ${row.days} | ${row.aiSeconds} | ${pct(m.specificGrounded, m.specific)} (${m.specificGrounded}/${m.specific}; ${m.grounded}/${m.places}) | ${m.withHours} (${m.closed}) | ${pct(m.realizableDays, m.days)} | ${m.hardWarnings} | ${m.drift15} | ${m.oddMeals.length} | ${m.implausibleLegs.length} | ${risks.filter((r) => r.found).length}/${risks.length} (${outside.filter((r) => r.found).length}/${outside.length}) | ${row.repairs} | ${row.tokensIn}/${row.tokensOut} | $${row.costUsd} |`;
    }),
    '',
    '## Szczegóły',
    ...rows.flatMap((row) => [
      '',
      `### ${row.slug} · ${row.model}`,
      row.error ? `Błąd: ${row.error}` : '',
      ...(row.variants ?? []).map((variant) => `- wariant: ${variant}`),
      ...(row.metrics
        ? [
            `- ostrzeżenia: ${JSON.stringify(row.metrics.warnings)}`,
            ...row.metrics.implausibleLegs.map((leg) => `- niemożliwy przejazd: ${leg}`),
            ...row.metrics.oddMeals.map((meal) => `- posiłek o dziwnej porze: ${meal}`),
          ]
        : []),
      ...(row.risks ?? []).map((risk) => `- ryzyko ${risk.found ? '✓' : '✗'} ${risk.risk}${risk.inBrief ? ' (w briefie)' : ''}`),
    ]),
  ];
  writeFileSync(join(dir, 'report.md'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(`\nRaport: ${join(dir, 'report.md')}`);
}

/** Miary od nowa na zapisanych wynikach (bez wołania AI): `--rescore out/<znacznik>`. */
function rescore(dir: string) {
  const rows = (JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) as Row[]).map((row) => {
    if (row.error) return row;
    const sub = join(dir, `${row.slug}-${row.model}`);
    const brief = TripBrief.parse(JSON.parse(readFileSync(join(root, 'fixtures/plans', row.slug, 'brief.json'), 'utf8')));
    const doc = applyPins(TripDocument.parse(JSON.parse(readFileSync(join(sub, 'plan.json'), 'utf8'))), brief.location.pins);
    const text = JSON.stringify({ skeleton: JSON.parse(readFileSync(join(sub, 'stage1.json'), 'utf8')), plans: JSON.parse(readFileSync(join(sub, 'stage2.json'), 'utf8')) });
    return { ...row, metrics: evaluate(doc), risks: detectRisks(row.slug, text) };
  });
  writeReport(rows, dir, `przeliczenie ${dir}`);
}

const again = arg('rescore')?.[0];
if (again !== undefined) {
  rescore(again);
} else {
  const outDir = join(here, 'out', stamp);
  mkdirSync(outDir, { recursive: true });
  const rows: Row[] = [];
  for (const model of models) {
    if (parallelPlans) rows.push(...(await Promise.all(plans.map((slug) => run(slug, model, outDir)))));
    else for (const slug of plans) rows.push(await run(slug, model, outDir));
  }
  writeReport(rows, outDir, `przebieg ${stamp} (${backend}, etap 2 po ${chunkDays} dni)`);
}
