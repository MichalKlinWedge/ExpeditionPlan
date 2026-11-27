import "server-only";

import { PlannerTaskResult, type PlannerTaskInput } from "@expeditionplan/core";

/**
 * Klient `inbound-api` Task Plannera (`docs/INTEGRACJA_TP.md`). Adres i token tylko z env serwera:
 * `TASKPLANNER_API_URL` (…/functions/v1/inbound-api), `TASKPLANNER_TOKEN` (token osobisty z Ustawień TP),
 * `TASKPLANNER_EMAILS` (konta EP, które mogą wysyłać — po przecinku; zadania trafiają do jednego konta TP).
 */

export type PlannerConfig = { url: string; token: string };

/** Konfiguracja dla tego konta albo powód, dla którego wysyłki nie ma (`null` = ukryć całkiem). */
export function plannerConfig(email: string | undefined): { config: PlannerConfig } | { off: string | null } {
  const url = process.env.TASKPLANNER_API_URL?.trim();
  const token = process.env.TASKPLANNER_TOKEN?.trim();
  const allowed = (process.env.TASKPLANNER_EMAILS ?? "").split(",").map((each) => each.trim().toLowerCase()).filter(Boolean);
  if (email === undefined || !allowed.includes(email.toLowerCase())) return { off: null };
  if (!url || !token) return { off: "Brak adresu albo tokenu Task Plannera na serwerze (TASKPLANNER_API_URL, TASKPLANNER_TOKEN)." };
  return { config: { url: url.replace(/\/+$/, ""), token } };
}

export class PlannerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

const STATUS_TEXT: Record<number, string> = {
  401: "Task Planner nie przyjął tokenu — utwórz nowy w Ustawieniach TP i podmień TASKPLANNER_TOKEN.",
  403: "Konto Task Plannera nie może już zmieniać listy docelowej tokenu.",
  413: "Zadanie jest za duże dla Task Plannera.",
  429: "Task Planner prosi o chwilę przerwy — spróbuj za moment.",
};

async function put(config: PlannerConfig, key: string, body: PlannerTaskInput): Promise<PlannerTaskResult> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/tasks/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${config.token}`, "user-agent": "ExpeditionPlan/1.0", "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new PlannerError(`Brak połączenia z Task Plannerem: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const own = typeof json === "object" && json !== null && "error" in json && typeof json.error === "string" ? json.error : undefined;
    const retry = Number(response.headers.get("retry-after"));
    throw new PlannerError(STATUS_TEXT[response.status] ?? own ?? `Task Planner odpowiedział błędem ${response.status}.`, response.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  const parsed = PlannerTaskResult.safeParse(json);
  if (!parsed.success) throw new PlannerError("Task Planner zwrócił odpowiedź w nieznanym kształcie.", response.status);
  return parsed.data;
}

/** `PUT /tasks/{key}`: utwórz albo zaktualizuj; przy 429 jedno ponowienie po `Retry-After` (≤ 10 s). */
export async function putPlannerTask(config: PlannerConfig, key: string, body: PlannerTaskInput): Promise<PlannerTaskResult> {
  try {
    return await put(config, key, body);
  } catch (e) {
    if (!(e instanceof PlannerError) || e.status !== 429 || (e.retryAfterSec ?? 1) > 10) throw e;
    await new Promise((resolve) => setTimeout(resolve, (e.retryAfterSec ?? 1) * 1000));
    return await put(config, key, body);
  }
}
