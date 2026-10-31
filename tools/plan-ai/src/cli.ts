/**
 * PoC-1: łańcuch AI z ugruntowaniem na briefach z `fixtures/plans/`.
 *
 *   npm run plan-ai -- [--plans maroko,chatka] [--models claude-sonnet-5-5,claude-haiku-5-5] [--backend claude-code|api]
 *   npm run plan-ai -- --rescore tools/plan-ai/out/<znacznik>   (miary od nowa, bez AI)
 *
 * `claude-code` (domyślnie): przez `claude -p` na abonamencie Claude Code (wymaga `claude auth login`
 * w terminalu); koszt w raporcie to równowartość według cennika API. `api`: ANTHROPIC_API_KEY.
 *
 * brief → etap 1 (warianty) → bazy w OSM + fakty dni (słońce, święta, zmiana czasu) → etap 2
 * (dni, punkty, pula, ograniczenia) → ugruntowanie miejsc (OSM, godziny otwarcia) → silnik
 * harmonogramu → miary i raport. Wyniki: tools/plan-ai/out/<znacznik>/ (poza git).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AiUsage, askStructured, createAiClient } from '@expeditionplan/ai';
import { type StagePlan, TripBrief, TripDocument, TripSkeleton } from '@expeditionplan/core';
import { cachedLookup, groundPlaces, searchPhoton, withCoordinates } from '@expeditionplan/geocode';

import { claudeCodeClient } from './claude-code.ts';
import { assemble, chunksFor, stagePlanSchema, tripContext, tripDates } from './assemble.ts';
import { COUNTRY_TZ, dayFact, holidays } from './facts.ts';
import { applyPins, detectRisks, evaluate, type PlanMetrics } from './metrics.ts';
import { assertAllowed, costUsd, DEFAULT_RUN_MODELS } from './pricing.ts';
import { stage1Prompt, stage2Prompt, SYSTEM } from './prompts.ts';

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
const key = process.env.ANTHROPIC_API_KEY;
if (backend === 'api' && !key) throw new Error('Brak ANTHROPIC_API_KEY w .env.local');
const clientFor = (model: string) =>
  backend === 'api' ? createAiClient({ keys: { CLAUDE: key }, models: { CLAUDE: model } }) : claudeCodeClient(model);

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
    if (brief.dates.kind !== 'fixed') throw new Error('brief bez stałych dat');
    const country = brief.location.countries[0]!;
    const tz = COUNTRY_TZ[country];
    if (tz === undefined) throw new Error(`brak strefy dla ${country}`);
    const client = clientFor(model);
    const ask = { system: SYSTEM, timeoutMs: 300_000, onUsage };

    const started = performance.now();
    const skeleton = await askStructured(client, TripSkeleton, stage1Prompt(brief), { ...ask, maxTokens: 12_000, label: `${slug} etap 1` });
    save('stage1.json', skeleton.data);
    const variant = skeleton.data.variants.find((each) => each.recommended)!;
    row.variants = skeleton.data.variants.map((each) => `${each.recommended ? '★ ' : ''}${each.label}`);
    let aiMs = performance.now() - started;

    // Fakty dni: bazy w OSM → słońce; święta; zmiana czasu.
    const groundStart = performance.now();
    const bases = skeleton.data.bases.map((base, i) => ({ ref: `base-${i}`, name: base.name, searchName: base.searchName, category: 'town' }));
    const baseHits = await groundPlaces(bases, { countries: brief.location.countries, kind: brief.location.kind, lookup });
    const baseCoords = new Map(
      bases.flatMap((base, i) => {
        const hit = baseHits[i]!;
        return hit.status === 'found' ? [[base.name, { lat: hit.hit.lat, lng: hit.hit.lng }] as const] : [];
      }),
    );
    const dates = tripDates(brief.dates.start, brief.dates.end);
    const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
    const allHolidays = (await Promise.all(years.map((year) => holidays(country, year, join(here, '.cache/holidays.json'))))).flat();
    const facts = dates.map((date) => {
      const day = variant.days.find((each) => each.date === date) ?? { date, base: variant.days.at(-1)!.base };
      return dayFact(day, tz, baseCoords.get(day.base), allHolidays.filter((holiday) => holiday.date === date));
    });
    save('facts.json', facts);
    let groundMs = performance.now() - groundStart;

    const context = tripContext(brief, tz);
    const chunks = chunksFor(dates, chunkDays);
    const stage2Start = performance.now();
    const answers = await Promise.all(
      chunks.map((chunk) =>
        askStructured(
          client,
          stagePlanSchema(context, chunk),
          stage2Prompt(brief, variant, chunk, facts.filter((fact) => chunk.dates.includes(fact.date)), dates.length),
          { ...ask, maxTokens: 32_000, label: `${slug} etap 2 część ${chunk.index + 1}` },
        ),
      ),
    );
    aiMs += performance.now() - stage2Start;
    const stagePlans: StagePlan[] = answers.map((answer) => answer.data);
    save('stage2.json', stagePlans);
    row.repairs = (skeleton.attempts - 1) + answers.reduce((sum, answer) => sum + answer.attempts - 1, 0);

    // Ugruntowanie miejsc z etapu 2 (współrzędne + godziny otwarcia z OSM).
    const placesStart = performance.now();
    // Pinezki z briefu mają pierwszeństwo; geokoder uzupełnia resztę (środek obszaru liczy ze wszystkich).
    let doc = applyPins(assemble(context, stagePlans), brief.location.pins);
    const results = await groundPlaces(doc.places, { countries: brief.location.countries, kind: brief.location.kind, lookup, fallback });
    doc = TripDocument.parse({
      ...doc,
      places: doc.places.map((place, i) => {
        const result = results[i]!;
        return result.status === 'found' && place.lat === undefined ? withCoordinates(place, result.hit, { openingHours: true }) : place;
      }),
    });
    groundMs += performance.now() - placesStart;
    save('plan.json', doc);
    save('grounding.json', results);

    row.days = doc.days.length;
    row.aiSeconds = Math.round(aiMs / 100) / 10;
    row.groundSeconds = Math.round(groundMs / 100) / 10;
    row.metrics = evaluate(doc);
    row.risks = detectRisks(slug, JSON.stringify({ skeleton: skeleton.data, plans: stagePlans }));
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
