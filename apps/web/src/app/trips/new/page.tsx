import { ImportTripForm, NewTripForm } from "@/components/forms";
import { Shell } from "@/components/shell";

export default function NewTripPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Nowy wyjazd</h1>
      <NewTripForm />
      <section className="mt-8 flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">…albo z pliku</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Plan pobrany przyciskiem „Pobierz JSON” na stronie wyjazdu (np. z lokalnej bazy) trafi tu jako nowy wyjazd.</p>
        <ImportTripForm />
      </section>
    </Shell>
  );
}
