import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { AiError, AiValidationError, askStructured, createAiClient, type Provider, providers } from '@expeditionplan/ai';
import { TripDocument } from '@expeditionplan/core';

import { compareDocuments, formatComparison } from './compare.ts';
import { extractText } from './extract.ts';
import { importPrompt, SYSTEM } from './prompt.ts';

/**
 * Import planu przez AI (PoC-0). Użycie:
 *
 *   npm run import-plan -- <plik.docx|pdf> [--provider CLAUDE|GEMINI|OPENAI] [--out plan.json]
 *                          [--anonymize] [--compare fixtures/plans/<plan>/plan.json] [--text-only]
 *
 * Klucze z `.env.local` (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, AI_MODEL_*).
 */

const USAGE =
  'Użycie: npm run import-plan -- <plik> [--provider CLAUDE|GEMINI|OPENAI] [--out plik.json] [--anonymize] [--compare wzorzec.json] [--text-only]';

/** Plan na kilkanaście dni z pulą i budżetem to kilkadziesiąt tysięcy tokenów JSON-a. */
const MAX_TOKENS = 32_000;

/** Skrypt nie ma nad sobą limitu Edge Function — czekamy tyle, ile trzeba na długą odpowiedź. */
const TIMEOUT_MS = 15 * 60_000;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: 'string' },
      out: { type: 'string' },
      anonymize: { type: 'boolean', default: false },
      compare: { type: 'string' },
      'text-only': { type: 'boolean', default: false },
    },
  });

  const file = positionals[0];
  if (file === undefined) {
    console.error(USAGE);
    return 2;
  }

  const text = await extractText(file);
  if (values['text-only']) {
    console.log(text);
    return 0;
  }

  const provider = (values.provider ?? 'CLAUDE').toUpperCase() as Provider;
  if (!providers.includes(provider)) {
    console.error(`Nieznany dostawca „${values.provider}”. Dostępni: ${providers.join(', ')}.`);
    return 2;
  }

  const client = createAiClient({
    keys: {
      CLAUDE: process.env.ANTHROPIC_API_KEY,
      GEMINI: process.env.GEMINI_API_KEY,
      OPENAI: process.env.OPENAI_API_KEY,
    },
    models: {
      CLAUDE: process.env.AI_MODEL_CLAUDE || undefined,
      GEMINI: process.env.AI_MODEL_GEMINI || undefined,
      OPENAI: process.env.AI_MODEL_OPENAI || undefined,
    },
    defaultProvider: provider,
  });

  const prompt = importPrompt(text, { anonymize: values.anonymize, fileName: basename(file) });
  console.error(`Import „${basename(file)}”: ${text.length} znaków tekstu, polecenie ${prompt.length} znaków, ${provider}…`);

  const started = Date.now();
  try {
    const answer = await askStructured(client, TripDocument, prompt, {
      system: SYSTEM,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      label: `import ${basename(file)}`,
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    console.error(`Gotowe: ${answer.provider} ${answer.model}, próby: ${answer.attempts}, ${seconds} s.`);

    const json = `${JSON.stringify(answer.data, null, 2)}\n`;
    if (values.out) {
      await writeFile(values.out, json, 'utf8');
      console.error(`Zapisano ${values.out}.`);
    } else {
      process.stdout.write(json);
    }

    if (values.compare) {
      const gold = TripDocument.parse(JSON.parse(await readFile(values.compare, 'utf8')));
      console.error(`\nPorównanie z ${values.compare}:\n${formatComparison(compareDocuments(gold, answer.data))}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof AiValidationError) {
      console.error(`${error.message}\n${error.issues.slice(0, 40).map((issue) => `- ${issue}`).join('\n')}`);
      if (values.out) await writeFile(`${values.out}.invalid.txt`, error.raw, 'utf8');
      return 1;
    }
    if (error instanceof AiError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
