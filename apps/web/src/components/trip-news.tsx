import { NEWS_ACTION, type NewsLine, type NewsSummary } from "@expeditionplan/sync";
import Link from "next/link";

import { ago } from "@/components/member-stats";
import { NewsSeenButton } from "@/components/news-seen-button";

/**
 * „Co nowego od ostatniej wizyty” na stronie wyjazdu: zmiany innych osób (punkty, rezerwacje,
 * wydatki…) z linkiem do miejsca, gdzie je widać, i „Przejrzane”. Pusta lista — karty nie ma.
 */

/** Ile linii widać od razu; reszta pod „pokaż wszystkie”. */
const SHOWN = 8;

function hrefOf(tripId: string, line: NewsLine): string {
  const base = `/trips/${tripId}`;
  switch (line.entity) {
    case "items":
      return line.action === "removed" ? `${base}/plan` : `${base}/item/${encodeURIComponent(line.ref)}`;
    case "bookings":
    case "budget_lines":
    case "expenses":
    case "settlements":
    case "vehicles":
      return `${base}/logistics`;
    case "tasks":
      return `${base}/tasks`;
    case "packing_items":
      return `${base}/shopping`;
    case "contacts":
      return `${base}/contacts`;
    case "documents":
      return `${base}/documents`;
    case "travelers":
      return `${base}/people`;
    case "trip_brief":
      return `${base}/brief`;
    case "notes":
    case "sources":
      return `${base}/practical`;
    default:
      return `${base}/plan`;
  }
}

function Line({ tripId, line, now }: { tripId: string; line: NewsLine; now: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={line.action === "removed" ? "text-red-700 dark:text-red-400" : line.action === "added" ? "text-emerald-700 dark:text-emerald-400" : ""}>{NEWS_ACTION[line.action]}</span>
      <span className="text-zinc-500">{line.kind}</span>
      <Link href={hrefOf(tripId, line)} className="font-medium underline-offset-2 hover:text-sea hover:underline">
        {line.title ? `„${line.title}”` : "(bez nazwy)"}
      </Link>
      {line.fields.length > 0 && <span className="text-zinc-500">— {line.fields.join(", ")}</span>}
      <span className="text-xs text-zinc-500">
        · {line.actors.join(", ")} · {ago(line.at, now)}
      </span>
    </li>
  );
}

export function TripNews({ tripId, news, now }: { tripId: string; news: NewsSummary; now: number }) {
  if (news.lines.length === 0 && news.reordered === 0) return null;
  const first = news.lines.slice(0, SHOWN);
  const rest = news.lines.slice(SHOWN);
  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Co nowego <span className="font-normal text-zinc-500">od Twojej ostatniej wizyty ({ago(news.since, now)})</span>
        </h2>
        <NewsSeenButton tripId={tripId} />
      </div>
      <ul className="flex flex-col gap-1">
        {first.map((line) => (
          <Line key={`${line.entity}:${line.id}`} tripId={tripId} line={line} now={now} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-zinc-500">pokaż wszystkie ({news.lines.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {rest.map((line) => (
              <Line key={`${line.entity}:${line.id}`} tripId={tripId} line={line} now={now} />
            ))}
          </ul>
        </details>
      )}
      {news.reordered > 0 && <p className="text-xs text-zinc-500">Zmieniona kolejność w planie: {news.reordered} pkt.</p>}
    </section>
  );
}
