/**
 * Import wszystkich planów z `examples/` przez AI i porównanie z wzorcami (`fixtures/plans/`).
 * Domknięcie PoC-0: czy AI odtwarza Twoje dokumenty tak, jak wzorce przygotowane ręcznie.
 *
 *   npm run batch --workspace tools/import-plan -- [--models claude-haiku-5-5,claude-sonnet-5-5] [--plans maroko,…]
 *
 * Przez `claude -p` (abonament Claude Code, tylko tanie modele). Wyniki z anonimizacją, ale
 * pochodzą z prywatnych dokumentów — zostają w tools/import-plan/out/ (poza git).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AiUsage, AiValidationError, askStructured } from '@expeditionplan/ai';
import { scheduleDay, TripDocument } from '@expeditionplan/core';
import { claudeCodeClient } from '@expeditionplan/plan-ai/claude-code';
import { assertAllowed, costUsd } from '@expeditionplan/plan-ai/pricing';

import { compareDocuments, formatComparison } from './compare.ts';
import { extractText } from './extract.ts';
import { importPrompt, SYSTEM } from './prompt.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const here = fileURLToPath(new URL('../', import.meta.url));

/** Dokument źródłowy → plan wzorcowy. */
const SOURCES: Record<string, string> = {
  barcelona: 'Barcelona 5–7 grudnia – plan wyjazdu.docx',
  gruzja: 'Gruzja_2027_plan_v4.pdf',
  maroko: 'Maroko-plan-26-30-grudnia-2026.pdf',
  chatka: 'Plan - Chatka Sylwestrowa 24-25.10.2026.docx',
  dinara: 'wzór.docx',
};

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1]?.split(',');
};
const models = arg('models') ?? ['claude-haiku-5-5', 'claude-sonnet-5-5'];
models.forEach(assertAllowed);
const plans = arg('plans') ?? Object.keys(SOURCES);

const sourceDir = ['examples', 'exaples'].map((dir) => join(root, dir)).find((dir) => existsSync(dir));
if (sourceDir === undefined) throw new Error('Brak katalogu examples/ z dokumentami planów.');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(here, 'out', stamp);
mkdirSync(outDir, { recursive: true });

/** Silnik na imporcie: twarde ostrzeżenia i największy rozjazd godzin (bramka PoC-5 dla wzorców: ≤ 15 min, 0 twardych). */
function engineCheck(doc: TripDocument) {
  let hard = 0;
  let maxDrift = 0;
  for (const day of doc.days) {
    const schedule = scheduleDay(doc, day.ref);
    hard += schedule.warnings.filter((warning) => warning.severity === 'hard').length;
    maxDrift = Math.max(maxDrift, ...schedule.items.map((item) => item.driftMin));
  }
  return { hard, maxDrift };
}

const summary: string[] = [
  `# Import planów przez AI — ${stamp}`,
  '',
  '| Plan | Model | Wynik | Punkty odnalezione | Brakujące rezerwacje | Silnik: twarde / max rozjazd | Czas [s] | Naprawy | Tokeny we/wy | Koszt wg API |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
const details: string[] = [];

for (const model of models) {
  for (const slug of plans) {
    const file = join(sourceDir, SOURCES[slug]!);
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    const started = performance.now();
    const label = `${slug} · ${model}`;
    try {
      const text = await extractText(file);
      const answer = await askStructured(claudeCodeClient(model), TripDocument, importPrompt(text, { anonymize: true, fileName: SOURCES[slug] }), {
        system: SYSTEM,
        maxTokens: 64_000,
        timeoutMs: 20 * 60_000,
        label,
        onUsage: (each) => {
          usage.inputTokens += each.inputTokens;
          usage.outputTokens += each.outputTokens;
        },
      });
      const seconds = Math.round((performance.now() - started) / 1000);
      writeFileSync(join(outDir, `${slug}-${model}.json`), `${JSON.stringify(answer.data, null, 2)}\n`);
      const gold = TripDocument.parse(JSON.parse(await readFile(join(root, 'fixtures/plans', slug, 'plan.json'), 'utf8')));
      const comparison = compareDocuments(gold, answer.data);
      const engine = engineCheck(answer.data);
      summary.push(
        `| ${slug} | ${model} | ✓ | ${Math.round(comparison.itemRecall * 100)}% | ${comparison.missingBookings.length} | ${engine.hard} / ${engine.maxDrift} min | ${seconds} | ${answer.attempts - 1} | ${usage.inputTokens}/${usage.outputTokens} | $${costUsd(model, usage).toFixed(3)} |`,
      );
      details.push('', `## ${label}`, '', '```', formatComparison(comparison), '```');
      console.log(`${label}: ${Math.round(comparison.itemRecall * 100)}% punktów, ${seconds} s`);
    } catch (error) {
      const seconds = Math.round((performance.now() - started) / 1000);
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AiValidationError) {
        writeFileSync(join(outDir, `${slug}-${model}.invalid.json`), JSON.stringify({ issues: error.issues, raw: error.raw }, null, 2));
      }
      summary.push(`| ${slug} | ${model} | ✗ ${message.slice(0, 100)} |||| ${seconds} || ${usage.inputTokens}/${usage.outputTokens} | $${costUsd(model, usage).toFixed(3)} |`);
      console.log(`${label}: ✗ ${message}`);
    }
  }
}

writeFileSync(join(outDir, 'report.md'), [...summary, ...details].join('\n') + '\n');
console.log(`\nRaport: ${join(outDir, 'report.md')}`);
