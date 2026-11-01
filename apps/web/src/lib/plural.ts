/** Polska odmiana po liczbie: `plural(2, ["zmianę", "zmiany", "zmian"])` → „2 zmiany”. Formy: 1, 2–4, 5+ (12–14 jak 5+). */
export function plural(count: number, [one, few, many]: [string, string, string]): string {
  const form = count === 1 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;
  return `${count} ${form}`;
}
