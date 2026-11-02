import { Suspense } from "react";

import { JoinButton } from "@/components/forms";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE, tripDates } from "@/lib/labels";

/**
 * Dołączenie z linku zaproszenia. Dołącza przycisk (akcja), nie samo otwarcie strony — podgląd
 * linku w komunikatorze nie może zużyć jednorazowego zaproszenia.
 */
export default function JoinPage(props: PageProps<"/join/[token]">) {
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Zaproszenie do wyjazdu</h1>
      <Suspense fallback={<Loading />}>
        <Join params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { email, supabase } = await requireUser(`/join/${token}`);
  const { data } = await supabase.rpc("invite_preview", { p_token: token });
  const invite = data?.[0];
  if (!invite) return <p className="card p-5 text-zinc-600 dark:text-zinc-400">To zaproszenie wygasło, zostało już wykorzystane albo jest nieprawidłowe. Poproś organizatora o nowy link.</p>;
  return (
    <div className="flex flex-col gap-4">
      <section className="topo flex flex-col gap-2 rounded-2xl px-6 py-6 shadow-md">
        <h2 className="text-2xl font-bold text-white">{invite.title}</h2>
        <p className="text-zinc-200">
          {tripDates(invite.start_date, invite.end_date)} · rola: <strong className="text-white">{ROLE[invite.role] ?? invite.role}</strong>
          {invite.invited_by ? ` · zaprasza ${invite.invited_by}` : ""}
        </p>
      </section>
      <p>Dołączysz jako {email}.</p>
      <JoinButton token={token} />
      <p className="text-sm text-zinc-500">
        Na telefonie z aplikacją ExpeditionPlan:{" "}
        <a href={`expeditionplan://join/${token}`} className="underline">
          otwórz w aplikacji
        </a>
        .
      </p>
    </div>
  );
}
