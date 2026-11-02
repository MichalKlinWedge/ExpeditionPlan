import { Suspense } from "react";

import { CompassIcon, PeakIcon, RouteIcon, SparkIcon } from "@/components/icons";
import { LoginForm } from "@/components/login-form";
import { Shell } from "@/components/shell";
import { ROLE, tripDates } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

/**
 * Logowanie — pierwsza strona, którą widzi zaproszony znajomy. Przy linku `/join/<token>` pokazuje,
 * do jakiego wyjazdu i w jakiej roli prowadzi zaproszenie (`invite_preview`, bez logowania).
 */
export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Shell>
      <Suspense fallback={<Hero invite={null} />}>
        <InviteHero searchParams={props.searchParams} />
      </Suspense>
      <section className="card flex flex-col gap-4 p-6">
        <h2 className="text-xl font-semibold">Zaloguj się</h2>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </Shell>
  );
}

type Invite = { title: string; start_date: string; end_date: string; role: string; invited_by: string | null };

async function InviteHero({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  const token = typeof next === "string" ? /^\/join\/([A-Za-z0-9_-]+)/.exec(next)?.[1] : undefined;
  let invite: Invite | null = null;
  if (token) {
    const { data } = await (await createClient()).rpc("invite_preview", { p_token: token });
    invite = (data?.[0] as Invite | undefined) ?? null;
  }
  return <Hero invite={invite} />;
}

function Hero({ invite }: { invite: Invite | null }) {
  return (
    <section className="topo relative overflow-hidden rounded-2xl px-6 py-8 shadow-md sm:px-8">
      {invite ? (
        <div className="flex flex-col gap-3">
          <span className="chip self-start bg-signal! text-white!">Zaproszenie</span>
          <h1 className="text-3xl font-bold text-white">{invite.title}</h1>
          <p className="text-zinc-200">
            {tripDates(invite.start_date, invite.end_date)} · dołączysz jako <strong className="text-white">{ROLE[invite.role] ?? invite.role}</strong>
            {invite.invited_by ? ` · zaprasza ${invite.invited_by}` : ""}
          </p>
          <p className="text-sm text-zinc-300">Zaloguj się, a potem kliknij „Dołącz do wyjazdu”. Nowe konto zakłada link z maila.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl leading-tight font-bold text-white sm:text-4xl">
            Planuj wyprawy razem.
            <br />
            <span className="text-signal">Prowadź je offline.</span>
          </h1>
          <ul className="grid gap-3 text-sm text-zinc-200 sm:grid-cols-3">
            <Feature icon={<RouteIcon className="size-5" />} text="Plan dnia z godzinami, trasami i zachodem słońca" />
            <Feature icon={<CompassIcon className="size-5" />} text="Mapa, numery alarmowe i wydatki bez internetu" />
            <Feature icon={<SparkIcon className="size-5" />} text="AI układa szkic i plan B — Ty decydujesz" />
          </ul>
        </div>
      )}
      <PeakIcon className="pointer-events-none absolute -right-6 -bottom-8 size-40 text-white/5" />
    </section>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-signal">{icon}</span>
      <span>{text}</span>
    </li>
  );
}
