import { Suspense } from "react";

import { JoinButton } from "@/components/forms";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

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
  const { email } = await requireUser(`/join/${token}`);
  return (
    <div className="flex flex-col gap-4">
      <p>Dołączysz jako {email}. Szczegóły wyjazdu zobaczysz po dołączeniu.</p>
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
