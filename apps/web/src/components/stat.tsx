/** Liczba z podpisem w kafelku: pamiątka z wyjazdu i opis wyprawy. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
      <span className="font-display text-xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}
