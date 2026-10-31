import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiError, type AiClient, type AiUsage } from '@expeditionplan/ai';

/**
 * Model przez Claude Code w trybie nieinteraktywnym (`claude -p`) — na abonamencie użytkownika
 * zamiast kredytów API. Tylko do narzędzi deweloperskich (PoC-1): produkcja (Edge Functions)
 * potrzebuje klucza API, abonament Claude Code jej nie zasili.
 *
 * Bez narzędzi, bez zapisu sesji, bez MCP, bez CLAUDE.md użytkownika (`--safe-mode` — globalne
 * instrukcje dokładały np. stopkę do odpowiedzi i mogłyby zmieniać plan); zmienne środowiska sesji-rodzica są usuwane, żeby CLI
 * użyło logowania użytkownika (`claude auth login`), a nie tokenu aplikacji, w której działa.
 */

type CliResult = {
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
};

const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CLAUDE|ANTHROPIC)/.test(name) && name !== 'CLAUDECODE'));

/**
 * `effort` steruje myśleniem modelu w Claude Code; domyślne myślenie mnoży tokeny wyjścia i czas
 * (PoC-1: 73 tys. tokenów na dwudniowy plan). Plan to wypełnianie schematu, nie łamigłówka.
 */
export function claudeCodeClient(model: string, effort: 'low' | 'medium' | 'high' = 'low'): AiClient {
  return {
    defaultProvider: 'CLAUDE',
    async listModels() {
      return [{ id: model, label: model }];
    },
    async ask(prompt, request = {}) {
      try {
        return await askOnce(prompt, request);
      } catch (error) {
        // Przejściowe awarie CLI (np. „unrecognized_model” przy działającym modelu) — jedno ponowienie.
        if (!(error instanceof AiError) || !error.retryable) throw error;
        return askOnce(prompt, request);
      }
    },
  };

  async function askOnce(prompt: string, request: Parameters<AiClient['ask']>[1] = {}): ReturnType<AiClient['ask']> {
    const dir = mkdtempSync(join(tmpdir(), 'plan-ai-'));
    // Model jest z listy dozwolonych (pricing.ts), ścieżka — z mkdtemp; nic z zewnątrz nie trafia do powłoki.
    const args = ['claude', '-p', '--model', model, '--tools', '""', '--effort', effort, '--safe-mode', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'];
    if (request.system) {
      writeFileSync(join(dir, 'system.txt'), request.system);
      args.push('--system-prompt-file', `"${join(dir, 'system.txt')}"`);
    }
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        // Na Windows `claude` to skrypt npm (.cmd) — wymaga powłoki; argumenty są stałe albo w cudzysłowie.
        // Limit długości odpowiedzi Claude Code ustawia zmienną środowiska, nie flagą (import planu to dziesiątki tysięcy tokenów).
        const env = { ...cleanEnv(), ...(request.maxTokens ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxTokens) } : {}) };
        const child = spawn(args.join(' '), { cwd: dir, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        // Na Windows `kill()` zabija tylko powłokę, a `claude` trzyma potoki i proces wisi bez końca.
        const killTree = () =>
          process.platform === 'win32' && child.pid !== undefined
            ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
            : child.kill('SIGKILL');
        const timer = setTimeout(killTree, request.timeoutMs ?? 600_000);
        child.stdout.on('data', (chunk) => (out += String(chunk)));
        child.stderr.on('data', (chunk) => (err += String(chunk)));
        child.on('error', reject);
        child.on('close', () => {
          clearTimeout(timer);
          out.trim() === '' ? reject(new AiError(`claude -p bez odpowiedzi: ${err.slice(0, 300)}`, { retryable: true })) : resolve(out);
        });
        child.stdin.end(prompt);
      });
      const parsed = JSON.parse(stdout.slice(stdout.indexOf('{'))) as CliResult;
      if (parsed.is_error || typeof parsed.result !== 'string') {
        throw new AiError(`Claude Code: ${parsed.result ?? 'błąd bez opisu'}`);
      }
      const usage: AiUsage = {
        inputTokens:
          (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.cache_creation_input_tokens ?? 0) + (parsed.usage?.cache_read_input_tokens ?? 0),
        outputTokens: parsed.usage?.output_tokens ?? 0,
      };
      request.onUsage?.(usage);
      return { text: parsed.result, provider: 'CLAUDE', model };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
