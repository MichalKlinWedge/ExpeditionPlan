import { BOOKING_KIND, dayLabelShort, dayMap, dayMonth, formatKm, pluralForm, tripOverview } from "@expeditionplan/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { GuideFigure } from "@/components/guide-article";
import { MemoriesMap } from "@/components/memories-map";
import { PublicTripHeader } from "@/components/public-trip-header";
import { Loading, Shell } from "@/components/shell";
import { Stat } from "@/components/stat";
import { EXPIRED_LINK, loadPublicTrip } from "@/lib/public-trip";
import { publicShowOn } from "@/lib/trip-show";

/**
 * Wejście z publicznego linku: najważniejsze informacje o wyprawie na jednej stronie, zebrane z planu (`tripOverview`),
 * bez AI i zawsze aktualne. Plan dzień po dniu jest pod `/plan`. Dane prywatne odfiltrowuje baza, a ręcznie wpisany
 * tekst `tripOverview`. Wszystko renderuje serwer: do przeglądarki idzie tylko to, co widać.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Opis wyprawy — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicOverviewPage(props: PageProps<"/p/[token]">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <Overview params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Overview({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const base = `/p/${encodeURIComponent(token)}`;
  // Stare linki do dnia planu (`?day=`) prowadzą dalej do planu.
  const { day: oldDay } = await searchParams;
  if (typeof oldDay === "string") redirect(`${base}/plan?day=${encodeURIComponent(oldDay)}`);

  const loaded = await loadPublicTrip(token);
  if (loaded === null) return <p className="card p-5 text-zinc-600 dark:text-zinc-400">{EXPIRED_LINK}</p>;
  const { state, guideOf, hide, tentative } = loaded;
  const { doc, inputs } = state;
  const guideByRef = new Map(doc.items.flatMap((item) => {
    const guide = guideOf(item);
    return guide === null ? [] : [[item.ref, guide] as const];
  }));
  // Najważniejsze punkty mają opis i zdjęcie; ten sam artykuł albo to samo zdjęcie to powtórka.
  const guided = new Map([...guideByRef].flatMap(([ref, guide]) => {
    const image = guide.images[0];
    return image === undefined ? [] : [[ref, [guide.article.url, image.url]] as const];
  }));
  const overview = tripOverview(doc, { activeVariants: inputs.activeVariants, pulled: inputs.pulled, guided, hide, tentative });
  const { stats } = overview;
  const map = dayMap(doc, stats.routeRefs);
  const foot = overview.footMax ?? { km: stats.footKm, ascentM: stats.ascentM };
  const hasVariants = doc.variantGroups.length > 0;

  return (
    <>
      <PublicTripHeader token={token} trip={doc.trip} active="overview" show={await publicShowOn(token)} />

      {(overview.subtitle || overview.goal || overview.summary || overview.route.length > 0 || overview.names.length > 0) && (
        <section className="flex flex-col gap-2">
          {overview.subtitle && <p className="text-lg font-medium">{overview.subtitle}</p>}
          {overview.goal && <p className="whitespace-pre-line">{overview.goal}</p>}
          {overview.summary && <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">{overview.summary}</p>}
          {overview.route.length > 0 && (
            <p className="text-sm">
              <span className="font-semibold">Trasa:</span> {overview.route.join(" → ")}
            </p>
          )}
          {overview.names.length > 0 && (
            <p className="text-sm">
              <span className="font-semibold">{overview.tentative > 0 ? "Osoby:" : "Jadą:"}</span> {overview.names.join(", ")}
            </p>
          )}
        </section>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={String(stats.days)} label={pluralForm(stats.days, ["dzień", "dni", "dni"])} />
        {overview.nights > 0 && <Stat value={String(overview.nights)} label={pluralForm(overview.nights, ["noc", "noce", "nocy"])} />}
        {overview.people + overview.tentative > 0 && (
          <Stat
            value={String(overview.people)}
            label={`${pluralForm(overview.people, ["osoba", "osoby", "osób"])}${overview.tentative > 0 ? ` (${overview.tentative} ${pluralForm(overview.tentative, ["się waha", "się wahają", "się waha"])})` : ""}`}
          />
        )}
        <Stat value={String(stats.planned)} label={pluralForm(stats.planned, ["punkt w planie", "punkty w planie", "punktów w planie"])} />
        {foot.km > 0 && <Stat value={`${overview.footMax ? "do " : ""}${formatKm(foot.km)}`} label={`pieszo${foot.ascentM > 0 ? ` · ↑ ${foot.ascentM.toLocaleString("pl-PL")} m` : ""}${overview.footMax ? " · najdłuższy wariant" : ""}`} />}
        {stats.driveKm > 0 && <Stat value={formatKm(stats.driveKm)} label="autem" />}
        {stats.transitKm > 0 && <Stat value={formatKm(stats.transitKm)} label="komunikacją" />}
        {stats.flightKm > 0 && <Stat value={formatKm(stats.flightKm)} label="samolotem" />}
      </section>

      {map.pins.length > 0 && (
        <Section title="Mapa wyprawy">
          <MemoriesMap map={map} banner />
        </Section>
      )}

      {overview.highlights.length > 0 && (
        <Section title="Najważniejsze punkty">
          <ul className="grid gap-3 sm:grid-cols-2">
            {overview.highlights.map((highlight) => {
              const guide = guideByRef.get(highlight.ref);
              const image = guide?.images[0];
              return (
                <li key={highlight.ref} className="card flex gap-3 p-3 text-sm">
                  {image !== undefined && (
                    <div className="w-2/5 shrink-0">
                      <GuideFigure image={image} />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Link href={`${base}/item/${encodeURIComponent(highlight.ref)}`} className="font-medium text-sea underline decoration-sea/40 underline-offset-2 hover:decoration-sea">
                      {highlight.title}
                    </Link>
                    <span className="text-xs text-zinc-500">Dzień {highlight.dayNo}</span>
                    {guide !== undefined && <p className="line-clamp-5 text-zinc-600 dark:text-zinc-400">{guide.summary}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Dzień po dniu">
        <ol className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {overview.days.map((day) => (
            <li key={day.ref} className="flex flex-col gap-1 p-3 text-sm">
              <Link href={`${base}/plan?day=${encodeURIComponent(day.ref)}`} className="font-medium hover:text-sea">
                Dzień {day.no} · {dayLabelShort(day.date)}
                {day.title ? ` — ${day.title}` : ""}
              </Link>
              {day.summary && <p className="text-zinc-600 dark:text-zinc-400">{day.summary}</p>}
              {day.points.length > 0 && (
                <p className="text-zinc-600 dark:text-zinc-400">
                  {day.points.slice(0, 5).join(" · ")}
                  {day.points.length > 5 && ` · i ${day.points.length - 5} więcej`}
                </p>
              )}
              {day.lodging && <p className="text-xs text-zinc-500">⌂ {day.lodging}</p>}
            </li>
          ))}
        </ol>
        {hasVariants && <p className="text-xs text-zinc-500">Tam, gdzie plan ma warianty, opis pokazuje wybrany albo polecany. Pozostałe są w planie dzień po dniu.</p>}
      </Section>

      {overview.stays.length > 0 && (
        <Section title="Noclegi">
          <ul className="flex flex-col gap-1 text-sm">
            {overview.stays.map((stay) => (
              <li key={`${stay.from}:${stay.name}`}>
                <span className="font-medium">{stay.name}</span>
                <span className="text-zinc-500">
                  {" "}
                  · {dayMonth(stay.from)} – {dayMonth(stay.to)} · {stay.nights} {pluralForm(stay.nights, ["noc", "noce", "nocy"])}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview.transport.length > 0 && (
        <Section title="Przejazdy">
          <ul className="flex flex-col gap-1 text-sm">
            {overview.transport.map((each) => (
              <li key={each.ref}>
                <span className="font-medium">{each.title}</span>
                <span className="text-zinc-500">
                  {" "}
                  · {BOOKING_KIND[each.kind] ?? each.kind}
                  {each.date ? ` · ${dayMonth(each.date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview.choices.length > 0 && (
        <Section title="Jeszcze do wyboru">
          <ul className="flex flex-col gap-1 text-sm">
            {overview.choices.map((choice) => (
              <li key={choice.ref}>
                <span className="font-medium">{choice.title}:</span> {choice.options.join(" albo ")}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview.notes.length > 0 && (
        <Section title="Warto wiedzieć">
          <ul className="flex flex-col gap-2 text-sm">
            {overview.notes.map((note, index) => (
              <li key={index}>
                {note.title && <span className="font-medium">{note.title}: </span>}
                {note.body}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Link href={`${base}/plan`} className="btn-primary self-start">
        Zobacz cały plan dzień po dniu
      </Link>
    </>
  );
}
